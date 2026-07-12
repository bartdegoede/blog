import numpy as np
import pytest

from tts.synth import SAMPLE_RATE, synth


@pytest.mark.slow
def test_kokoro_renders_two_sentences():
    audio = synth("Hello there. This is a local model talking.", voice="af_heart")
    assert isinstance(audio, np.ndarray)
    assert audio.dtype == np.float32
    # at least ~1 second of audio at 24 kHz
    assert audio.shape[0] > SAMPLE_RATE
    assert np.isfinite(audio).all()


def test_empty_text_is_silent_without_loading_model():
    # empty input must short-circuit before touching the model
    assert synth("").shape == (0,)
