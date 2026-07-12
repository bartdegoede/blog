import numpy as np
from pydub import AudioSegment

from tts.stitch import stitch_to_mp3


def _tone(seconds, sample_rate=24000, freq=220.0):
    t = np.linspace(0, seconds, int(seconds * sample_rate), endpoint=False)
    return (0.2 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_stitches_segments_into_one_mp3(tmp_path):
    out = tmp_path / "out.mp3"
    segments = [_tone(0.5), _tone(0.5), _tone(0.5)]
    stitch_to_mp3(segments, out, sample_rate=24000)
    assert out.exists()
    dur = AudioSegment.from_mp3(out).duration_seconds
    assert abs(dur - 1.5) < 0.2  # ~sum of segment durations, mp3 padding aside


def test_single_segment(tmp_path):
    out = tmp_path / "one.mp3"
    stitch_to_mp3([_tone(1.0)], out, sample_rate=24000)
    dur = AudioSegment.from_mp3(out).duration_seconds
    assert abs(dur - 1.0) < 0.2


def test_clips_out_of_range_samples(tmp_path):
    # values outside [-1, 1] must not wrap/overflow when converted to int16
    out = tmp_path / "loud.mp3"
    loud = np.array([5.0, -5.0] * 12000, dtype=np.float32)
    stitch_to_mp3([loud], out, sample_rate=24000)
    assert out.exists()
