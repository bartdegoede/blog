"""Split prose into synth-sized chunks on sentence boundaries.

Kokoro can produce slight artifacts at boundaries in very long single
generations, and per-chunk synthesis keeps memory bounded and lets a progress
bar advance. We split on sentence terminators and greedily pack sentences up to
max_chars, never breaking a sentence in half. A single sentence longer than
max_chars is emitted whole rather than cut.
"""

import re

_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")


def sentence_chunks(prose: str, max_chars: int = 400) -> list[str]:
    prose = re.sub(r"\s+", " ", prose).strip()
    if not prose:
        return []
    sentences = _SENTENCE_BOUNDARY.split(prose)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if not current:
            current = sentence
        elif len(current) + 1 + len(sentence) <= max_chars:
            current += " " + sentence
        else:
            chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks
