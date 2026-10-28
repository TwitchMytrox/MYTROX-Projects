"""Misst, wo Jarvis Zeit verliert: Ollama-Modelle, Grafikkarte, Whisper, Stimme."""
import json
import time
from pathlib import Path

import numpy as np
import requests

CFG = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))
URL = CFG["ollama_url"].rstrip("/")
FRAGE = "Wie spät ist es ungefähr, wenn die Sonne untergeht? Antworte in einem Satz."
ergebnis = []


def zeile(name, wert):
    print(f"  {name:<34}{wert}")
    ergebnis.append(f"{name}: {wert}")


print("=" * 60, "\n JARVIS TEMPO-TEST\n", "=" * 60, sep="")

# ---------- 1. Ollama ----------
print("\n[1] Ollama-Modelle")
modelle = [m for m in requests.get(f"{URL}/api/tags", timeout=5).json()["models"]]
for m in modelle:
    name = m["name"]
    print(f"\n  >> {name}  ({m['size'] / 1e9:.1f} GB)")
    t0 = time.time()
    requests.post(f"{URL}/api/generate", json={"model": name, "prompt": "", "keep_alive": "5m"}, timeout=600)
    zeile("Laden", f"{time.time() - t0:.1f} s")

    ps = requests.get(f"{URL}/api/ps", timeout=5).json().get("models", [])
    info = next((p for p in ps if p["name"] == name), None)
    if info:
        anteil = info.get("size_vram", 0) / max(info.get("size", 1), 1) * 100
        zeile("Auf Grafikkarte", f"{anteil:.0f} %" + ("  <-- LANGSAM (CPU)!" if anteil < 90 else ""))

    t0 = time.time(); erstes = None; daten = {}
    r = requests.post(f"{URL}/api/chat", stream=True, timeout=600, json={
        "model": name, "stream": True, "options": {"num_predict": 80},
        "messages": [{"role": "user", "content": FRAGE}]})
    for z in r.iter_lines():
        if not z:
            continue
        d = json.loads(z)
        if erstes is None and d.get("message", {}).get("content"):
            erstes = time.time() - t0
        if d.get("done"):
            daten = d
    zeile("Bis zum ersten Wort", f"{erstes or 0:.2f} s")
    if daten.get("eval_duration"):
        zeile("Tempo", f"{daten['eval_count'] / (daten['eval_duration'] / 1e9):.1f} Tokens/s")
    requests.post(f"{URL}/api/generate", json={"model": name, "prompt": "", "keep_alive": 0}, timeout=60)

# ---------- 2. Whisper ----------
print("\n[2] Whisper (Spracherkennung, 5 s Audio)")
from jarvis import cuda_vorbereiten  # noqa: E402
cuda_vorbereiten()
from faster_whisper import WhisperModel  # noqa: E402
audio = (np.random.randn(16000 * 5) * 0.01).astype(np.float32)
for name in ["base", "small"]:
    for geraet, typ in [("cpu", "int8"), ("cuda", "float16")]:
        try:
            m = WhisperModel(name, device=geraet, compute_type=typ)
            t0 = time.time()
            list(m.transcribe(audio, language="de", beam_size=1)[0])
            zeile(f"{name} auf {geraet}", f"{time.time() - t0:.2f} s")
        except Exception as e:
            zeile(f"{name} auf {geraet}", f"geht nicht ({str(e)[:40]})")

# ---------- 3. Stimme ----------
print("\n[3] Stimme (ein Satz)")
for art in ["edge", "piper"]:
    try:
        import importlib
        mod = importlib.import_module(f"stimme_{art}")
        mod.erzeugen("Test.")
        t0 = time.time()
        mod.erzeugen("Guten Tag, Sir. Alle Systeme laufen einwandfrei.")
        zeile(art, f"{time.time() - t0:.2f} s")
    except Exception as e:
        zeile(art, f"geht nicht ({str(e)[:40]})")

Path(__file__).with_name("tempo_ergebnis.txt").write_text("\n".join(ergebnis), encoding="utf-8")
print("\nFertig! Ergebnis steht auch in tempo_ergebnis.txt")
