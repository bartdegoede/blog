"""Waveform peaks for the audio player.

A peaks file is a JSON object {"peaks": [ints 0-100]} sitting next to its MP3.
The shortcode renders these as bars at build time. Peaks are computed by
decoding the MP3, so the same code covers narrated posts, old posts, and the
A/B before-clip alike.

The file is an object, not a bare array, on purpose: Hugo's transform.Unmarshal
mis-sniffs a bare "[1,2,3]" as CSV. An object is parsed as JSON.
"""

import json
from pathlib import Path

import numpy as np
from pydub import AudioSegment

N_BARS = 200


def compute_peaks(samples, n_bars: int = N_BARS) -> list[int]:
    samples = np.abs(np.asarray(samples, dtype=np.float64).reshape(-1))
    if samples.size == 0:
        return [0] * n_bars
    buckets = np.array_split(samples, n_bars)
    peaks = np.array([b.max() if b.size else 0.0 for b in buckets])
    top = peaks.max()
    if top <= 0:
        return [0] * n_bars
    return [int(round(p / top * 100)) for p in peaks]


def peaks_path(mp3_path) -> Path:
    p = Path(mp3_path)
    return p.with_name(p.stem + ".peaks.json")


def write_peaks(mp3_path, n_bars: int = N_BARS) -> Path:
    seg = AudioSegment.from_file(Path(mp3_path)).set_channels(1)
    samples = np.array(seg.get_array_of_samples())
    out = peaks_path(mp3_path)
    out.write_text(json.dumps({"peaks": compute_peaks(samples, n_bars)}))
    return out
