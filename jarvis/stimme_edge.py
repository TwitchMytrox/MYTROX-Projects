"""Sehr natürliche Microsoft-Neural-Stimmen (kostenlos, braucht Internet).
Andere deutsche Stimmen zum Ausprobieren in config.json bei "edge_stimme":
  de-DE-ConradNeural, de-DE-KillianNeural, de-DE-FlorianMultilingualNeural,
  de-AT-JonasNeural, de-CH-JanNeural"""
import asyncio
import json
from pathlib import Path

import edge_tts
import miniaudio
import numpy as np
import sounddevice as sd

CFG = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))
STIMME = CFG.get("edge_stimme", "de-DE-ConradNeural")
TEMPO = CFG.get("edge_tempo", "+0%")
HOEHE = CFG.get("edge_tonhoehe", "+0Hz")
SR = 24000


async def _mp3(text):
    daten = bytearray()
    async for teil in edge_tts.Communicate(text, STIMME, rate=TEMPO, pitch=HOEHE).stream():
        if teil["type"] == "audio":
            daten += teil["data"]
    return bytes(daten)


def erzeugen(text):
    """Text -> (Audio, Samplerate). Wird parallel zum Abspielen aufgerufen."""
    mp3 = asyncio.run(_mp3(text))
    if not mp3:
        return np.zeros(1, dtype=np.int16), SR
    pcm = miniaudio.decode(mp3, output_format=miniaudio.SampleFormat.SIGNED16,
                           nchannels=1, sample_rate=SR)
    return np.array(pcm.samples, dtype=np.int16), SR


def sprechen(text):
    sd.play(*erzeugen(text))
    sd.wait()
