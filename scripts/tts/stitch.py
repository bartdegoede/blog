"""Concatenate float32 audio segments and export a single MP3.

Kokoro emits float32 samples in [-1, 1] at 24 kHz. pydub works on integer PCM,
so we clip, scale to int16, build one mono AudioSegment, and let ffmpeg encode
the MP3.
"""

from pathlib import Path

import numpy as np
from pydub import AudioSegment


def stitch_to_mp3(segments, out_path, sample_rate: int = 24000) -> None:
    if segments:
        audio = np.concatenate([np.asarray(s, dtype=np.float32).reshape(-1) for s in segments])
    else:
        audio = np.zeros(0, dtype=np.float32)
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    segment = AudioSegment(
        pcm16.tobytes(), frame_rate=sample_rate, sample_width=2, channels=1
    )
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    segment.export(out_path, format="mp3")
