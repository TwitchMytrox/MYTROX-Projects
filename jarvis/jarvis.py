"""Jarvis – Sprachassistent: Mikrofon -> Whisper -> Ollama -> Stimme

Ablauf: Er hört zu, bis du eine Pause machst, schreibt mit, fragt das lokale
KI-Modell und spricht die Antwort Satz für Satz, schon während sie entsteht.
"""
import json
import queue
import re
import sys
import threading
import time
from collections import deque
from pathlib import Path

import numpy as np
import requests
import sounddevice as sd

ORDNER = Path(__file__).parent
CFG = json.loads((ORDNER / "config.json").read_text(encoding="utf-8"))
RATE = 16000
BLOCK = 1600  # 0,1 Sekunden pro Audioblock


def rms(a):
    return float(np.sqrt(np.mean(np.square(a)))) if len(a) else 0.0


# ======================= OHREN: Aufnahme ==========================
def kalibrieren():
    """Misst kurz das Grundrauschen, damit Jarvis Stille von Sprache unterscheidet."""
    wert = CFG.get("stille_schwelle", "auto")
    if wert != "auto":
        return float(wert)
    print("Messe Umgebungsgeräusch, bitte 1 Sekunde still sein ...")
    aufnahme = sd.rec(RATE, samplerate=RATE, channels=1, dtype="float32")
    sd.wait()
    schwelle = max(0.008, rms(aufnahme) * 3.0)
    print(f"Lautstärke-Schwelle: {schwelle:.4f}")
    return schwelle


def zuhoeren(schwelle):
    """Nimmt auf, sobald du sprichst, und stoppt nach einer Sprechpause."""
    q = queue.Queue()

    def cb(indata, frames, t, status):
        q.put(indata[:, 0].copy())

    vorlauf = deque(maxlen=4)  # 0,4 s vor dem Sprechbeginn, damit nichts abgeschnitten wird
    teile, gesprochen, stille_seit = [], False, None
    max_bloecke = int(CFG.get("max_aufnahme_sekunden", 30) * RATE / BLOCK)

    print("\n🎤 Ich höre zu ...")
    with sd.InputStream(samplerate=RATE, channels=1, dtype="float32",
                        blocksize=BLOCK, callback=cb):
        while True:
            block = q.get()
            laut = rms(block) > schwelle
            if not gesprochen:
                vorlauf.append(block)
                if laut:
                    gesprochen = True
                    teile.extend(vorlauf)
                continue
            teile.append(block)
            if laut:
                stille_seit = None
            else:
                stille_seit = stille_seit or time.time()
                if time.time() - stille_seit > CFG.get("stille_sekunden", 1.0):
                    break
            if len(teile) >= max_bloecke:
                break
    audio = np.concatenate(teile)
    return audio if len(audio) > RATE * 0.4 else None  # zu kurz = nur ein Geräusch


# ======================= VERSTEHEN: Whisper =======================
def cuda_vorbereiten():
    """Macht die CUDA-Dateien aus den pip-Paketen (gpu_setup.bat) für Whisper auffindbar."""
    import os
    import site
    for basis in site.getsitepackages() + [site.getusersitepackages()]:
        for teil in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc"):
            ordner = Path(basis) / "nvidia" / teil / "bin"
            if ordner.is_dir():
                os.environ["PATH"] = str(ordner) + os.pathsep + os.environ["PATH"]
                if hasattr(os, "add_dll_directory"):
                    os.add_dll_directory(str(ordner))


def lade_whisper():
    """Nimmt die Grafikkarte, wenn sie wirklich funktioniert, sonst den Prozessor."""
    from faster_whisper import WhisperModel
    name = CFG.get("whisper_modell", "small")
    if CFG.get("whisper_geraet", "auto") in ("cuda", "auto"):
        try:
            cuda_vorbereiten()
            m = WhisperModel(name, device="cuda", compute_type="float16")
            list(m.transcribe(np.zeros(RATE, dtype=np.float32), language="de")[0])  # Probelauf
            print("✅ Whisper läuft auf der Grafikkarte.")
            return m
        except Exception as e:
            print(f"ℹ Whisper auf Grafikkarte geht nicht ({str(e)[:80]}).")
            print("  Für NVIDIA-Karten einmal gpu_setup.bat ausführen. Nehme jetzt den Prozessor.")
    return WhisperModel(name, device="cpu", compute_type="int8")


# Whisper "halluziniert" bei Stille gern Untertitel-Floskeln
MUELL = ("untertitel", "amara.org", "vielen dank fürs zuschauen",
         "danke fürs zuschauen", "copyright", "swr 20", "zdf")


def verstehen(whisper, audio):
    segs, _ = whisper.transcribe(audio, language=CFG.get("sprache", "de"),
                                 vad_filter=True, condition_on_previous_text=False,
                                 beam_size=CFG.get("whisper_beam", 1))
    text = " ".join(s.text for s in segs if s.no_speech_prob < 0.6).strip()
    if any(m in text.lower() for m in MUELL):
        return ""
    return text


# ======================= GEHIRN: Ollama ===========================
def pruefe_ollama():
    url = CFG["ollama_url"].rstrip("/")
    try:
        modelle = [m["name"] for m in requests.get(f"{url}/api/tags", timeout=5).json()["models"]]
    except requests.RequestException:
        sys.exit("❌ Ollama läuft nicht. Starte die Ollama-App und versuch es nochmal.")
    if not modelle:
        sys.exit("❌ Kein Modell in Ollama. Lade eins, z. B.: ollama pull llama3.1:8b")
    wunsch = CFG["ollama_modell"]
    if wunsch in modelle or f"{wunsch}:latest" in modelle:
        return wunsch
    print(f"⚠ Modell '{wunsch}' nicht gefunden. Vorhanden: {', '.join(modelle)}")
    print(f"   Nehme '{modelle[0]}'. Ändern kannst du das in config.json.")
    return modelle[0]


def aufwaermen(modell):
    """Lädt das Modell schon beim Start in den Speicher (sonst dauert die 1. Antwort ewig)."""
    try:
        requests.post(f"{CFG['ollama_url'].rstrip('/')}/api/generate",
                      json={"model": modell, "prompt": "", "keep_alive": "60m"}, timeout=300)
    except requests.RequestException:
        pass


def gpu_status(modell):
    """Zeigt, ob Ollama das Modell auf der Grafikkarte hat."""
    try:
        for p in requests.get(f"{CFG['ollama_url'].rstrip('/')}/api/ps", timeout=5).json()["models"]:
            if p["name"].split(":")[0] == modell.split(":")[0]:
                anteil = p.get("size_vram", 0) / max(p.get("size", 1), 1) * 100
                if anteil >= 90:
                    print(f"✅ Gehirn läuft auf der Grafikkarte ({anteil:.0f} %).")
                elif anteil > 0:
                    print(f"⚠ Gehirn nur zu {anteil:.0f} % auf der Grafikkarte, Rest auf CPU (Modell zu groß).")
                else:
                    print("⚠ Gehirn läuft komplett auf der CPU – deshalb langsam.")
    except Exception:
        pass


def _sichtbar(t):
    """Entfernt <think>-Blöcke von Denk-Modellen (qwen3, deepseek-r1 ...)."""
    t = re.sub(r"<think>.*?</think>", "", t, flags=re.S)
    i = t.find("<think>")
    return t if i < 0 else t[:i]


SATZENDE = re.compile(r"[.!?…:;](?=\s)|\n")


def denken(modell, verlauf, text, sprecher):
    """Fragt Ollama mit Streaming und gibt fertige Sätze sofort an die Stimme."""
    verlauf.append({"role": "user", "content": text})
    r = requests.post(f"{CFG['ollama_url'].rstrip('/')}/api/chat",
                      json={"model": modell, "messages": verlauf, "stream": True,
                            "keep_alive": "60m",
                            "options": {"num_predict": CFG.get("max_antwort_tokens", 150),
                                        "num_ctx": 4096}},
                      stream=True, timeout=(5, 300))
    r.raise_for_status()
    voll, pos = "", 0
    print(f"{CFG['name']}: ", end="", flush=True)
    for zeile in r.iter_lines():
        if not zeile:
            continue
        teil = json.loads(zeile)
        if "error" in teil:
            raise RuntimeError(teil["error"])
        voll += teil.get("message", {}).get("content", "")
        sicht = _sichtbar(voll)
        ende = None
        for m in SATZENDE.finditer(sicht, pos):
            if m.end() - pos >= 15:
                ende = m.end()
        if ende:
            satz = sicht[pos:ende]
            print(satz, end="", flush=True)
            sprecher.sag(satz)
            pos = ende
        if teil.get("done"):
            break
    rest = _sichtbar(voll)[pos:]
    print(rest)
    sprecher.sag(rest)
    antwort = _sichtbar(voll).strip()
    verlauf.append({"role": "assistant", "content": antwort})
    del verlauf[1:-20]  # Systemprompt + die letzten 20 Nachrichten behalten
    return antwort


# ======================= STIMME ===================================
def windows_stimme():
    import pyttsx3

    def sprechen(text):
        e = pyttsx3.init()
        for v in e.getProperty("voices"):
            if any(k in (v.name + v.id).lower() for k in ("german", "deutsch", "de-de")):
                e.setProperty("voice", v.id)
                break
        e.say(text)
        e.runAndWait()
        e.stop()
    return sprechen


def lade_stimme():
    art = CFG.get("stimme", "edge")
    try:
        import importlib
        if art in ("edge", "piper", "xtts", "chatterbox"):
            return importlib.import_module(f"stimme_{art}")
        return windows_stimme()
    except Exception as e:
        print(f"⚠ Stimme '{art}' geht nicht ({e}). Nehme die Windows-Stimme.")
        return windows_stimme()


def saeubern(text):
    text = re.sub(r"[*_#`>|~]", " ", text)
    text = re.sub(r"[\U00010000-\U0010FFFF☀-➿]", "", text)  # Emojis
    return re.sub(r"\s+", " ", text).strip()


class Sprecher:
    """Spricht Sätze nacheinander. Hat die Stimme eine erzeugen()-Funktion, wird
    der nächste Satz schon berechnet, während der aktuelle noch abgespielt wird."""

    def __init__(self, stimme):
        self.erzeugen = getattr(stimme, "erzeugen", None)
        self.sprechen = getattr(stimme, "sprechen", stimme)
        self.notfall = None
        self.q = queue.Queue()            # Texte (warte() wartet auf diese Queue)
        self.audio_q = queue.Queue(maxsize=3)
        if self.erzeugen:
            threading.Thread(target=self._erzeuger, daemon=True).start()
            threading.Thread(target=self._abspieler, daemon=True).start()
        else:
            threading.Thread(target=self._einfach, daemon=True).start()

    def _erzeuger(self):
        while True:
            text = self.q.get()
            try:
                self.audio_q.put((text, self.erzeugen(text)))
            except Exception as e:
                self.audio_q.put((text, e))

    def _abspieler(self):
        while True:
            text, ergebnis = self.audio_q.get()
            try:
                if isinstance(ergebnis, Exception):
                    raise ergebnis
                sd.play(*ergebnis)
                sd.wait()
            except Exception as e:
                self._notfall(text, e)
            finally:
                self.q.task_done()

    def _einfach(self):
        while True:
            text = self.q.get()
            try:
                self.sprechen(text)
            except Exception as e:
                self._notfall(text, e)
            finally:
                self.q.task_done()

    def _notfall(self, text, fehler):
        print(f"\n⚠ Stimmfehler: {fehler}")
        try:
            self.notfall = self.notfall or windows_stimme()
            self.notfall(text)
        except Exception:
            pass

    def sag(self, text):
        text = saeubern(text)
        if text:
            self.q.put(text)

    def warte(self):
        self.q.join()


# ======================= HAUPTPROGRAMM ============================
TSCHUESS = ("auf wiedersehen", "beenden", "schlaf jetzt", "tschüss jarvis")


def main():
    modell = pruefe_ollama()
    print(f"Gehirn: {modell}")
    waerm = threading.Thread(target=aufwaermen, args=(modell,), daemon=True)
    waerm.start()
    print("Lade Whisper ... (beim ersten Start wird das Modell heruntergeladen)")
    whisper = lade_whisper()
    print("Lade Stimme ...")
    sprecher = Sprecher(lade_stimme())
    schwelle = kalibrieren()
    waerm.join()
    gpu_status(modell)
    verlauf = [{"role": "system", "content": CFG["system_prompt"]}]

    sprecher.sag("Systeme online. Zu Ihren Diensten, Sir.")
    sprecher.warte()

    while True:
        audio = zuhoeren(schwelle)
        if audio is None:
            continue
        text = verstehen(whisper, audio)
        if not text:
            continue
        print(f"Du: {text}")
        if any(w in text.lower() for w in TSCHUESS):
            sprecher.sag("Sehr wohl, Sir. Bis später.")
            sprecher.warte()
            break
        try:
            denken(modell, verlauf, text, sprecher)
        except Exception as e:
            print(f"\n⚠ Fehler beim Denken: {e}")
            sprecher.sag("Verzeihung, Sir, da ist bei mir etwas schiefgelaufen.")
        sprecher.warte()  # erst wieder zuhören, wenn er fertig gesprochen hat


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nBis später, Sir.")
