"""Offline-Stimme mit XTTS v2 (sehr realistisch, kann Stimmen klonen).
- Liegen WAV-Clips im Ordner 'stimme', klont er diese Stimme (nur privat nutzen!).
- Sonst nimmt er einen eingebauten Sprecher aus config.json ("xtts_sprecher").
Installation (groß, ca. 2-4 GB): venv\\Scripts\\pip install coqui-tts
Lizenz: Coqui Public Model License, nur nicht-kommerziell."""
import json
import os
from pathlib import Path

import numpy as np
import sounddevice as sd

os.environ.setdefault("COQUI_TOS_AGREED", "1")
from TTS.api import TTS  # noqa: E402

ORDNER = Path(__file__).parent
CFG = json.loads((ORDNER / "config.json").read_text(encoding="utf-8"))
CLIPS = [str(p) for p in (ORDNER / "stimme").glob("*.wav")]

_tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
try:
    import torch
    if torch.cuda.is_available():
        _tts.to("cuda")
except Exception:
    pass


def erzeugen(text):
    if CLIPS:
        wav = _tts.tts(text=text, speaker_wav=CLIPS, language="de")
    else:
        wav = _tts.tts(text=text, speaker=CFG.get("xtts_sprecher", "Damien Black"), language="de")
    return np.asarray(wav, dtype=np.float32), 24000


def sprechen(text):
    sd.play(*erzeugen(text))
    sd.wait()
