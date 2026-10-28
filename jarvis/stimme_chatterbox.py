"""Sehr realistische Offline-Stimme mit Chatterbox Multilingual (Resemble AI).
- Klont die Stimme aus dem ersten WAV-Clip im Ordner 'stimme' (10-20 s, sauber, nur privat nutzen!).
- Ohne Clip nimmt er seine Standardstimme.
- Braucht eine NVIDIA-Grafikkarte, sonst ist es sehr langsam.
Installation: chatterbox_setup.bat"""
import json
from pathlib import Path

import numpy as np
import sounddevice as sd
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

ORDNER = Path(__file__).parent
CFG = json.loads((ORDNER / "config.json").read_text(encoding="utf-8"))
CLIPS = sorted((ORDNER / "stimme").glob("*.wav"))
REFERENZ = str(CLIPS[0]) if CLIPS else None

GERAET = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Chatterbox läuft auf: {'Grafikkarte' if GERAET == 'cuda' else 'CPU (langsam!)'}")
if REFERENZ:
    print(f"Klone Stimme aus: {Path(REFERENZ).name}")

try:
    MODELL = ChatterboxMultilingualTTS.from_pretrained(device=GERAET, t3_model="v3")
except TypeError:  # ältere Version ohne v3
    MODELL = ChatterboxMultilingualTTS.from_pretrained(device=GERAET)

# Ausdrucksstärke: 0.3 = ruhig/butlerhaft, 0.7 = dramatisch
AUSDRUCK = float(CFG.get("chatterbox_ausdruck", 0.4))
# Wie eng er sich an den Clip hält / Tempo-Steuerung (0.3 - 0.7)
CFG_WEIGHT = float(CFG.get("chatterbox_cfg", 0.5))


def erzeugen(text):
    kw = dict(language_id="de", exaggeration=AUSDRUCK, cfg_weight=CFG_WEIGHT)
    if REFERENZ:
        kw["audio_prompt_path"] = REFERENZ
    with torch.inference_mode():
        wav = MODELL.generate(text, **kw)
    return wav.squeeze().cpu().numpy().astype(np.float32), MODELL.sr


def sprechen(text):
    sd.play(*erzeugen(text))
    sd.wait()
