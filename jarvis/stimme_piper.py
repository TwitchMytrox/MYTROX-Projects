"""Realistische Offline-Stimme mit Piper. Das Stimmmodell wird beim ersten Start
automatisch von Hugging Face in den Ordner 'stimmen' geladen."""
import json
from pathlib import Path

import numpy as np
import sounddevice as sd
from huggingface_hub import hf_hub_download
from piper import PiperVoice, SynthesisConfig

ORDNER = Path(__file__).parent
CFG = json.loads((ORDNER / "config.json").read_text(encoding="utf-8"))
NAME = CFG.get("piper_stimme", "de_DE-thorsten-high")  # z.B. de_DE-thorsten-high
SPRACHE, SPRECHER, QUALI = NAME.split("-")
UNTERORDNER = f"{SPRACHE.split('_')[0]}/{SPRACHE}/{SPRECHER}/{QUALI}"
ZIEL = ORDNER / "stimmen"

def _lade(datei):
    lokal = ZIEL / UNTERORDNER / datei
    if lokal.exists():
        return str(lokal)
    print(f"Lade Stimme {datei} ...")
    return hf_hub_download("rhasspy/piper-voices", f"{UNTERORDNER}/{datei}", local_dir=ZIEL)

_modell = _lade(f"{NAME}.onnx")
_lade(f"{NAME}.onnx.json")
VOICE = PiperVoice.load(_modell)
_syn = SynthesisConfig(length_scale=1.0 / float(CFG.get("piper_tempo", 1.0)))

def erzeugen(text):
    audio = [c.audio_int16_array for c in VOICE.synthesize(text, syn_config=_syn)]
    sr = VOICE.config.sample_rate
    return (np.concatenate(audio) if audio else np.zeros(1, dtype=np.int16)), sr


def sprechen(text):
    sd.play(*erzeugen(text))
    sd.wait()
