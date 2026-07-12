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
    # A tone at amplitude 5.0 must clip to full-scale, not wrap to garbage when
    # cast to int16. Without the clip, (5.0 * 32767) overflows int16 and the
    # decoded tone would be quiet noise; with it, the tone survives near full-scale.
    out = tmp_path / "loud.mp3"
    stitch_to_mp3([_tone(0.5, freq=440.0) * 25.0], out, sample_rate=24000)
    assert out.exists()
    samples = np.array(AudioSegment.from_mp3(out).get_array_of_samples())
    assert samples.min() >= -32768 and samples.max() <= 32767  # no wrap
    assert samples.max() > 10000 and samples.min() < -10000  # clipped loud, not garbage
