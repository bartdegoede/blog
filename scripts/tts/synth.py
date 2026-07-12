"""Kokoro-82M query/text synthesis via mlx-audio on Apple Silicon.

Returns a 1-D float32 numpy array of 24 kHz mono samples. The model is loaded
once and cached. This is the only module that depends on mlx-audio, so the rest
of the pipeline can be tested with a stand-in callable.
"""

import numpy as np

SAMPLE_RATE = 24000
_MODEL_REPO = "mlx-community/Kokoro-82M-bf16"
_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from mlx_audio.tts.utils import load_model
        except ImportError as exc:  # pragma: no cover - environment guard
            raise RuntimeError(
                "mlx-audio is not installed. Run `uv sync`. Kokoro also needs "
                "`brew install espeak-ng`."
            ) from exc
        _model = load_model(_MODEL_REPO)
    return _model


def preload() -> None:
    """Eagerly load the model so a load failure surfaces once, up front, rather
    than once per post in the middle of a batch run."""
    _get_model()


def synth(text: str, voice: str = "af_heart", speed: float = 1.0) -> np.ndarray:
    text = text.strip()
    if not text:
        return np.zeros(0, dtype=np.float32)
    model = _get_model()
    pieces = []
    for result in model.generate(text=text, voice=voice, speed=speed, lang_code="a"):
        pieces.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
    if not pieces:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(pieces)
