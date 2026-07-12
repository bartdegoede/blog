import json

import numpy as np

from tts.peaks import compute_peaks, peaks_path, write_peaks
from tts.stitch import stitch_to_mp3


def test_compute_peaks_returns_n_bars_in_range():
    samples = np.random.default_rng(0).uniform(-1, 1, 48000).astype(np.float32)
    peaks = compute_peaks(samples, n_bars=200)
    assert len(peaks) == 200
    assert all(isinstance(p, int) for p in peaks)
    assert all(0 <= p <= 100 for p in peaks)


def test_compute_peaks_silence_is_all_zero():
    assert compute_peaks(np.zeros(10000, dtype=np.float32), n_bars=50) == [0] * 50


def test_compute_peaks_loudest_bar_is_100():
    # first half quiet, second half loud -> a bar in the loud half hits 100
    samples = np.concatenate([
        np.full(10000, 0.1, dtype=np.float32),
        np.full(10000, 1.0, dtype=np.float32),
    ])
    peaks = compute_peaks(samples, n_bars=20)
    assert max(peaks) == 100
    assert peaks[0] < peaks[-1]


def test_compute_peaks_empty_is_all_zero():
    assert compute_peaks(np.zeros(0, dtype=np.float32), n_bars=8) == [0] * 8


def test_peaks_path_sits_next_to_mp3(tmp_path):
    assert peaks_path(tmp_path / "2020-01-01-x.mp3") == tmp_path / "2020-01-01-x.peaks.json"


def test_write_peaks_round_trips_from_mp3(tmp_path):
    # a 1 s tone -> mp3 -> peaks file
    sr = 24000
    t = np.linspace(0, 1, sr, endpoint=False)
    tone = (0.5 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    mp3 = tmp_path / "tone.mp3"
    stitch_to_mp3([tone], mp3, sample_rate=sr)
    out = write_peaks(mp3, n_bars=100)
    assert out == tmp_path / "tone.peaks.json"
    data = json.loads(out.read_text())
    assert set(data.keys()) == {"peaks"}
    assert len(data["peaks"]) == 100
    assert all(0 <= p <= 100 for p in data["peaks"])
    assert max(data["peaks"]) > 0
