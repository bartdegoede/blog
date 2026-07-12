# Local Kokoro TTS Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blog's Google Cloud TTS pipeline with a local, free Kokoro-82M pipeline running on Apple Silicon via MLX, re-narrate the whole back catalogue, and write the accompanying blog post.

**Architecture:** A focused `scripts/tts/` Python package — `extract` (markdown→narration, reusing `sss_eval.markdown.to_prose`), `lexicon` (pronunciation substitution), `chunk` (sentence splitting), `synth` (Kokoro via mlx-audio, the only model-touching unit), `stitch` (segments→MP3 via pydub) — wired by a click CLI with single-file and `--all` batch modes. Deterministic units are TDD'd; the model backend has one opt-in smoke test.

**Tech Stack:** Python 3.13 (existing `.venv` via uv), `mlx-audio` + `misaki` (Kokoro), `pydub` (+ ffmpeg), `click`, `pyyaml`, `tqdm`, `static-site-search-eval==0.1.0` (for `sss_eval.markdown`). Hugo for the post.

**Reference:** design spec at `docs/superpowers/specs/2026-07-11-local-tts-kokoro-design.md`.

---

## File Structure

- `pyproject.toml` — MODIFY: add TTS deps, drop nothing search-related, add pytest config.
- `requirements.txt` — DELETE (superseded by pyproject/uv).
- `.gitignore` — MODIFY: ignore `backups/`.
- `scripts/tts/__init__.py` — CREATE: empty package marker.
- `scripts/tts/extract.py` — CREATE: `to_narration(md_text) -> str`.
- `scripts/tts/lexicon.py` — CREATE: `load_lexicon(path)`, `apply_lexicon(text, lexicon)`.
- `scripts/tts/chunk.py` — CREATE: `sentence_chunks(prose, max_chars=400)`.
- `scripts/tts/stitch.py` — CREATE: `stitch_to_mp3(segments, out_path, sample_rate=24000)`.
- `scripts/tts/synth.py` — CREATE: `synth(text, voice, speed) -> np.ndarray` (Kokoro).
- `scripts/tts/cli.py` — CREATE: click CLI; `render_post`, `backup_existing_audio`, `main`.
- `scripts/text_to_speech.py` — REPLACE: thin shim delegating to `tts.cli.main` (keeps the documented entrypoint).
- `scripts/tts_lexicon.yaml` — CREATE: shared pronunciation map.
- `tests/tts/test_extract.py`, `test_lexicon.py`, `test_chunk.py`, `test_stitch.py`, `test_cli.py`, `test_synth_slow.py` — CREATE.
- `content/post/2026-07-11-narrating-my-blog-with-a-local-model.md` — CREATE (final task).

**Note on imports/tests:** tests import `from tts.xxx import ...`. Task 1 adds `pythonpath = ["scripts"]` to the pytest config so `scripts/` is importable. The runtime shim (`scripts/text_to_speech.py`) inserts its own dir on `sys.path` before importing `tts.cli`.

**Run tests with:** `uv run pytest tests/tts -v -m "not slow"` (add `-m slow` to run the model smoke test).

---

## Task 1: Environment — pyproject deps, uv sync, retire requirements.txt

**Files:**
- Modify: `pyproject.toml`
- Delete: `requirements.txt`
- Modify: `.gitignore`

- [ ] **Step 1: Install system dependencies (one-time, manual)**

Kokoro's English G2P (misaki) needs espeak-ng; pydub's MP3 export needs ffmpeg.

Run:
```bash
brew install espeak-ng ffmpeg
```
Expected: both install (or "already installed"). Verify:
```bash
which espeak-ng ffmpeg
```
Expected: two paths printed.

- [ ] **Step 2: Rewrite `pyproject.toml`**

Replace the entire file with:
```toml
[project]
name = "blog-tooling"
version = "0.1.0"
description = "Build-time tooling for bart.degoe.de: search index + local TTS narration"
requires-python = ">=3.12"
dependencies = [
    "static-site-search-eval==0.1.0",
    "mlx-audio",
    "misaki",
    "numpy",
    "pydub",
    "click",
    "pyyaml",
    "tqdm",
]

[dependency-groups]
dev = ["pytest>=8.3", "ruff", "black"]

[tool.pytest.ini_options]
pythonpath = ["scripts"]
markers = [
    "slow: tests that download/run the Kokoro model (deselect with -m 'not slow')",
]
```

- [ ] **Step 3: Sync the environment**

Run:
```bash
uv sync
```
Expected: resolves and installs; `.venv` (Python 3.13) updated; `uv.lock` changes.

- [ ] **Step 4: Verify the TTS libraries import**

Run:
```bash
uv run python -c "import mlx_audio, misaki, numpy, pydub, click, yaml, tqdm; print('tts deps ok')"
```
Expected: `tts deps ok`.

- [ ] **Step 5: Delete requirements.txt and ignore backups/**

Run:
```bash
git rm requirements.txt
```
Add `backups/` to `.gitignore` (append a line after the existing entries):
```
backups/
```

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock .gitignore
git commit -m "Add TTS deps to pyproject, retire requirements.txt"
```

---

## Task 2: `extract.py` — markdown → narration

Reuses `sss_eval.markdown.to_prose` (front matter, code, shortcodes, HTML, emphasis) and adds TTS-specific scrubbing of footnote references and table markup, which `to_prose` leaves behind and a narrator would read as garbage.

**Files:**
- Create: `scripts/tts/__init__.py`
- Create: `scripts/tts/extract.py`
- Test: `tests/tts/test_extract.py`

- [ ] **Step 1: Create the package marker**

Create `scripts/tts/__init__.py` (empty file):
```python
```

- [ ] **Step 2: Write the failing tests**

Create `tests/tts/test_extract.py`:
```python
from tts.extract import to_narration


def test_strips_front_matter_and_code():
    md = "---\ntitle: X\n---\n\nHello world.\n\n```python\nprint('no')\n```\n\nBye."
    prose = to_narration(md)
    assert "Hello world." in prose
    assert "Bye." in prose
    assert "print" not in prose
    assert "title" not in prose


def test_removes_footnote_references():
    md = "This matters a lot[^1] to me.\n\n[^1]: because reasons."
    prose = to_narration(md)
    assert "[^1]" not in prose
    assert "caret" not in prose.lower()
    assert "This matters a lot" in prose
    # the definition line should not be narrated either
    assert "because reasons" not in prose


def test_neutralizes_table_markup():
    md = "Compare:\n\n| Model | Size |\n|-------|------|\n| Kokoro | small |\n"
    prose = to_narration(md)
    assert "|" not in prose
    assert "-------" not in prose
    assert "Kokoro" in prose
    assert "small" in prose


def test_preserves_inline_code_as_words():
    md = "Run `hugo server` to preview."
    prose = to_narration(md)
    assert "hugo server" in prose


def test_collapses_whitespace():
    md = "Line one.\n\n\nLine two."
    prose = to_narration(md)
    assert "\n" not in prose
    assert "Line one. Line two." in prose
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_extract.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts.extract'`.

- [ ] **Step 4: Implement `extract.py`**

Create `scripts/tts/extract.py`:
```python
"""Markdown -> narratable prose for text-to-speech.

The heavy lifting (front matter, code blocks, shortcodes, HTML, inline
emphasis) is done by sss_eval.markdown.to_prose, which is already tested in the
search pipeline. This module adds the TTS-specific scrubbing that to_prose does
not do because search does not care about it: footnote references and markdown
table pipes, both of which a narrator would read aloud as noise.
"""

import re

from sss_eval.markdown import to_prose

# A footnote definition line: "[^1]: some text" possibly wrapped. We only need
# to drop the marker + the rest of that line; to_prose has already flattened
# structure, so definitions appear inline. Drop reference markers everywhere,
# and drop the trailing definition text after a "[^id]:" marker.
_FOOTNOTE_DEF = re.compile(r"\[\^[^\]]+\]:\s*[^.]*\.?")
_FOOTNOTE_REF = re.compile(r"\[\^[^\]]+\]")
_TABLE_SEP = re.compile(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?")


def to_narration(md_text: str) -> str:
    prose = to_prose(md_text)
    prose = _FOOTNOTE_DEF.sub(" ", prose)
    prose = _FOOTNOTE_REF.sub("", prose)
    prose = _TABLE_SEP.sub(" ", prose)
    prose = prose.replace("|", " ")
    prose = re.sub(r"\s+", " ", prose).strip()
    return prose
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_extract.py -v`
Expected: 5 passed.

- [ ] **Step 6: Sanity-check against a real tricky post**

Run:
```bash
uv run python -c "from tts.extract import to_narration; from pathlib import Path; p=to_narration(Path('content/post/2026-07-10-semantic-search-in-your-browser.md').read_text()); import re; print('pipes', p.count('|'), 'footnotes', len(re.findall(r'\[\^', p)))"
```
Expected: `pipes 0 footnotes 0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/tts/__init__.py scripts/tts/extract.py tests/tts/test_extract.py
git commit -m "Add TTS markdown extraction (to_narration)"
```

---

## Task 3: `lexicon.py` — pronunciation substitution

**Files:**
- Create: `scripts/tts/lexicon.py`
- Create: `scripts/tts_lexicon.yaml`
- Test: `tests/tts/test_lexicon.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/tts/test_lexicon.py`:
```python
from tts.lexicon import apply_lexicon, load_lexicon


LEX = {"int8": "int eight", "RRF": "R R F", "espeak-ng": "e speak N G", "Goldmark": "Gold mark"}


def test_substitutes_whole_words():
    assert apply_lexicon("we use int8 here", LEX) == "we use int eight here"


def test_does_not_match_substrings_of_larger_words():
    # "RRF" must not fire inside "RRFX" or similar
    assert apply_lexicon("RRFX is not RRF", LEX) == "RRFX is not R R F"


def test_is_case_sensitive():
    # lowercase "rrf" is not the key "RRF"
    assert apply_lexicon("rrf stays", LEX) == "rrf stays"


def test_handles_hyphenated_tokens():
    assert apply_lexicon("the espeak-ng backend", LEX) == "the e speak N G backend"


def test_longest_match_wins():
    lex = {"int": "integer", "int8": "int eight"}
    assert apply_lexicon("int8 and int", lex) == "int eight and integer"


def test_empty_lexicon_is_identity():
    assert apply_lexicon("unchanged text", {}) == "unchanged text"


def test_load_lexicon_reads_yaml(tmp_path):
    f = tmp_path / "lex.yaml"
    f.write_text("int8: int eight\nRRF: R R F\n")
    assert load_lexicon(f) == {"int8": "int eight", "RRF": "R R F"}


def test_load_missing_lexicon_returns_empty(tmp_path):
    assert load_lexicon(tmp_path / "nope.yaml") == {}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_lexicon.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts.lexicon'`.

- [ ] **Step 3: Implement `lexicon.py`**

Create `scripts/tts/lexicon.py`:
```python
"""Pronunciation lexicon: whole-word spoken-form substitution.

Kokoro's grapheme-to-phoneme step mangles technical jargon and rare names. A
shared map of surface form -> spoken form, applied before synthesis, fixes it
without touching the model. Matching is case-sensitive (so "int8" != "INT8"),
whole-token (hyphens and digits count as part of a token, so "int" never fires
inside "int8" or "printf"), and longest-key-first (so "int8" wins over "int").
"""

import re
from pathlib import Path

import yaml


def load_lexicon(path) -> dict[str, str]:
    path = Path(path)
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    return {str(k): str(v) for k, v in data.items()}


def apply_lexicon(text: str, lexicon: dict[str, str]) -> str:
    if not lexicon:
        return text
    keys = sorted(lexicon, key=len, reverse=True)
    # (?<![\w-]) / (?![\w-]) treat a token as bounded by anything that is not a
    # word char or hyphen, so hyphenated and alphanumeric tokens match as units.
    pattern = re.compile(
        r"(?<![\w-])(" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])"
    )
    return pattern.sub(lambda m: lexicon[m.group(1)], text)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_lexicon.py -v`
Expected: 8 passed.

- [ ] **Step 5: Create the initial shared lexicon**

Create `scripts/tts_lexicon.yaml`:
```yaml
# Surface form -> spoken form. Case-sensitive, whole-token, longest-match-first.
# Grow this whenever Kokoro mispronounces a term in a post.
int8: "int eight"
fp32: "F P thirty two"
RRF: "R R F"
Goldmark: "Gold mark"
espeak-ng: "e speak N G"
mlx-audio: "M L X audio"
MLX: "M L X"
Kokoro: "koh koh roh"
tqdm: "T Q D M"
Hugo: "Hugo"
Fuse.js: "fuse J S"
pydub: "pie dub"
WordPiece: "word piece"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/tts/lexicon.py scripts/tts_lexicon.yaml tests/tts/test_lexicon.py
git commit -m "Add TTS pronunciation lexicon"
```

---

## Task 4: `chunk.py` — sentence chunking

**Files:**
- Create: `scripts/tts/chunk.py`
- Test: `tests/tts/test_chunk.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/tts/test_chunk.py`:
```python
from tts.chunk import sentence_chunks


def test_empty_prose_yields_no_chunks():
    assert sentence_chunks("") == []
    assert sentence_chunks("   ") == []


def test_packs_sentences_up_to_max_chars():
    prose = "One two three. Four five six. Seven eight nine."
    chunks = sentence_chunks(prose, max_chars=30)
    # each sentence ~15 chars; two won't fit in 30 with a space, so 1 per chunk
    for c in chunks:
        assert len(c) <= 30
    assert " ".join(chunks).split() == prose.split()


def test_never_splits_mid_sentence():
    prose = "Alpha beta gamma delta epsilon. Zeta."
    chunks = sentence_chunks(prose, max_chars=10)
    # first sentence exceeds max_chars but must stay whole
    assert "Alpha beta gamma delta epsilon." in chunks


def test_combines_short_sentences_into_one_chunk():
    prose = "Hi. Yo. Hey."
    assert sentence_chunks(prose, max_chars=400) == ["Hi. Yo. Hey."]


def test_round_trips_words_in_order():
    prose = "First sentence here. Second one there. Third and final!"
    chunks = sentence_chunks(prose, max_chars=25)
    assert " ".join(chunks).split() == prose.split()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_chunk.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts.chunk'`.

- [ ] **Step 3: Implement `chunk.py`**

Create `scripts/tts/chunk.py`:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_chunk.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/tts/chunk.py tests/tts/test_chunk.py
git commit -m "Add TTS sentence chunker"
```

---

## Task 5: `stitch.py` — segments → MP3

**Files:**
- Create: `scripts/tts/stitch.py`
- Test: `tests/tts/test_stitch.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/tts/test_stitch.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_stitch.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts.stitch'`.

- [ ] **Step 3: Implement `stitch.py`**

Create `scripts/tts/stitch.py`:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_stitch.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/tts/stitch.py tests/tts/test_stitch.py
git commit -m "Add TTS MP3 stitching"
```

---

## Task 6: `synth.py` — Kokoro backend

The only unit that loads the model. Isolated behind `synth(text, voice, speed) -> np.ndarray` so the CLI can inject a fake in tests. Its own test is opt-in (`slow`) because it downloads and runs Kokoro.

**Files:**
- Create: `scripts/tts/synth.py`
- Test: `tests/tts/test_synth_slow.py`

- [ ] **Step 1: Implement `synth.py`**

Create `scripts/tts/synth.py`:
```python
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
```

- [ ] **Step 2: Write the opt-in smoke test**

Create `tests/tts/test_synth_slow.py`:
```python
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
```

- [ ] **Step 3: Run the fast test (model not loaded)**

Run: `uv run pytest tests/tts/test_synth_slow.py -v -m "not slow"`
Expected: 1 passed (`test_empty_text_is_silent_without_loading_model`), 1 deselected.

- [ ] **Step 4: Run the slow test once to confirm Kokoro works end to end**

Run: `uv run pytest tests/tts/test_synth_slow.py -v -m slow`
Expected: PASS. First run downloads the model (~hundreds of MB) from Hugging Face; needs network and `espeak-ng`.

- [ ] **Step 5: Commit**

```bash
git add scripts/tts/synth.py tests/tts/test_synth_slow.py
git commit -m "Add Kokoro synthesis backend"
```

---

## Task 7: `cli.py` + `text_to_speech.py` — orchestration

Wires the pipeline: single-file and `--all` batch (with backup + tqdm). `render_post` takes an injected `synth_fn` and an `audio_dir` so it tests without the model and without writing into the real `static/audio`.

**Files:**
- Create: `scripts/tts/cli.py`
- Replace: `scripts/text_to_speech.py`
- Test: `tests/tts/test_cli.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/tts/test_cli.py`:
```python
import numpy as np
from pydub import AudioSegment

from tts.cli import backup_existing_audio, render_post


def _fake_synth(text, voice="af_heart", speed=1.0):
    # 0.1s of silence per chunk, so duration scales with chunk count
    return np.zeros(2400, dtype=np.float32)


def test_render_post_writes_mp3_named_by_stem(tmp_path):
    md = tmp_path / "2020-01-01-hello.md"
    md.write_text("---\ntitle: Hi\n---\n\nOne. Two. Three.\n")
    out_dir = tmp_path / "audio"
    out = render_post(md, "af_heart", 1.0, {}, _fake_synth, audio_dir=out_dir)
    assert out == out_dir / "2020-01-01-hello.mp3"
    assert out.exists()
    assert AudioSegment.from_mp3(out).duration_seconds > 0.0


def test_render_post_applies_lexicon(tmp_path):
    seen = []

    def spy_synth(text, voice="af_heart", speed=1.0):
        seen.append(text)
        return np.zeros(2400, dtype=np.float32)

    md = tmp_path / "p.md"
    md.write_text("We ship int8 vectors.")
    render_post(md, "af_heart", 1.0, {"int8": "int eight"}, spy_synth, audio_dir=tmp_path)
    assert any("int eight" in t for t in seen)


def test_render_post_skips_empty_prose(tmp_path):
    md = tmp_path / "empty.md"
    md.write_text("---\ntitle: X\n---\n\n```\ncode only\n```\n")
    out = render_post(md, "af_heart", 1.0, {}, _fake_synth, audio_dir=tmp_path)
    assert out is None


def test_backup_copies_without_deleting(tmp_path):
    src = tmp_path / "audio"
    src.mkdir()
    (src / "a.mp3").write_bytes(b"one")
    (src / "a.ogg").write_bytes(b"two")
    backup = tmp_path / "bk"
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    assert (backup / "a.mp3").read_bytes() == b"one"
    assert (backup / "a.ogg").read_bytes() == b"two"
    # originals still present
    assert (src / "a.mp3").exists()
    assert (src / "a.ogg").exists()


def test_backup_is_idempotent(tmp_path):
    src = tmp_path / "audio"
    src.mkdir()
    (src / "a.mp3").write_bytes(b"one")
    backup = tmp_path / "bk"
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    (backup / "a.mp3").write_bytes(b"EDITED")  # a re-run must not clobber
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    assert (backup / "a.mp3").read_bytes() == b"EDITED"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts.cli'`.

- [ ] **Step 3: Implement `cli.py`**

Create `scripts/tts/cli.py`:
```python
"""Command line for local Kokoro narration.

    uv run python scripts/text_to_speech.py content/post/foo.md   # one post
    uv run python scripts/text_to_speech.py --all                 # whole catalogue

Batch mode backs up existing audio first (copy, never move/delete) and shows a
tqdm progress bar. Output MP3s are named by the markdown file stem, matching the
existing static/audio convention.
"""

import logging
from pathlib import Path
import shutil

import click
from tqdm import tqdm

from tts.chunk import sentence_chunks
from tts.extract import to_narration
from tts.lexicon import apply_lexicon, load_lexicon
from tts.stitch import stitch_to_mp3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

AUDIO_DIR = Path("static/audio")
POSTS_DIR = Path("content/post")
BACKUP_DIR = Path("backups/audio-google-2026-07")
LEXICON_PATH = Path(__file__).resolve().parent.parent / "tts_lexicon.yaml"
SAMPLE_RATE = 24000


def render_post(md_path, voice, speed, lexicon, synth_fn, audio_dir=AUDIO_DIR):
    """Render one markdown post to MP3. Returns the output path, or None if the
    post has no narratable prose."""
    md_path = Path(md_path)
    prose = apply_lexicon(to_narration(md_path.read_text()), lexicon)
    chunks = sentence_chunks(prose)
    if not chunks:
        return None
    segments = [synth_fn(c, voice=voice, speed=speed) for c in chunks]
    out = Path(audio_dir) / (md_path.stem + ".mp3")
    stitch_to_mp3(segments, out, sample_rate=SAMPLE_RATE)
    return out


def backup_existing_audio(audio_dir=AUDIO_DIR, backup_dir=BACKUP_DIR):
    """Copy every existing mp3/ogg into the backup dir. Never overwrites an
    existing backup, so re-runs are safe and preserve the first snapshot."""
    audio_dir = Path(audio_dir)
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    for f in sorted(audio_dir.glob("*.mp3")) + sorted(audio_dir.glob("*.ogg")):
        dest = backup_dir / f.name
        if not dest.exists():
            shutil.copy2(f, dest)


@click.command()
@click.argument("filename", required=False, type=click.Path(exists=True, path_type=Path))
@click.option("--all", "all_posts", is_flag=True, help="Re-render every post in content/post.")
@click.option("--voice", default="af_heart", show_default=True, help="Kokoro voice preset.")
@click.option("--speed", default=1.0, show_default=True, type=float)
def main(filename, all_posts, voice, speed):
    from tts.synth import synth as synth_fn

    lexicon = load_lexicon(LEXICON_PATH)

    if all_posts:
        backup_existing_audio()
        posts = sorted(POSTS_DIR.glob("*.md"))
        rendered = skipped = failed = 0
        for post in tqdm(posts, desc="Narrating posts", unit="post"):
            try:
                out = render_post(post, voice, speed, lexicon, synth_fn)
                if out:
                    rendered += 1
                else:
                    skipped += 1
            except Exception as exc:  # keep going; one bad post must not abort
                failed += 1
                logging.error("failed %s: %s", post.name, exc)
        click.echo(f"rendered {rendered}, skipped {skipped}, failed {failed}")
        return

    if filename is None:
        raise click.UsageError("Provide a FILENAME or use --all.")
    out = render_post(filename, voice, speed, lexicon, synth_fn)
    click.echo(f"wrote {out}" if out else "nothing to render (empty prose)")
```

- [ ] **Step 4: Replace `scripts/text_to_speech.py` with a shim**

Replace the entire contents of `scripts/text_to_speech.py` with:
```python
"""Entry point kept for backwards compatibility and docs.

    uv run python scripts/text_to_speech.py content/post/foo.md
    uv run python scripts/text_to_speech.py --all

The implementation lives in scripts/tts/. This shim puts scripts/ on the import
path so `tts` resolves when run as a file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tts.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_cli.py -v`
Expected: 5 passed.

- [ ] **Step 6: Run the full fast suite**

Run: `uv run pytest tests/tts -v -m "not slow"`
Expected: all pass (extract 5, lexicon 8, chunk 5, stitch 3, synth 1, cli 5).

- [ ] **Step 7: Smoke-test the real CLI on one post**

Run:
```bash
uv run python scripts/text_to_speech.py content/post/2019-07-12-use-output-format-for-index-generation.md
```
Expected: log lines, then `wrote static/audio/2019-07-12-use-output-format-for-index-generation.mp3`. Listen to confirm it sounds like Kokoro, not Google. (This overwrites one back-catalogue file; the full backup happens in Task 8 before the batch, and this file will be re-rendered again there — fine.)

- [ ] **Step 8: Commit**

```bash
git add scripts/tts/cli.py scripts/text_to_speech.py tests/tts/test_cli.py
git commit -m "Add TTS CLI with single-file and batch modes"
```

---

## Task 8: Preserve the A/B "before" clip and re-render the catalogue

Execution task: produce all the new audio. No new code.

**Files:**
- Create (committed): `static/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts-google.mp3`
- Modify (committed): every `static/audio/*.mp3`
- Create (gitignored): `backups/audio-google-2026-07/`

- [ ] **Step 1: Preserve the origin post's Google render as the "before" clip**

Do this BEFORE the batch, which will overwrite the original with Kokoro:
```bash
cp "static/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts.mp3" \
   "static/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts-google.mp3"
```
Expected: the `-google.mp3` copy exists.

- [ ] **Step 2: Run the batch re-render**

Run:
```bash
time uv run python scripts/text_to_speech.py --all
```
Expected: backup runs first (copies mp3+ogg into `backups/audio-google-2026-07/`), then a `Narrating posts` tqdm bar advances over every post, ending with `rendered N, skipped M, failed 0`. Note the wall-clock time from `time` — it feeds the post's speed numbers. Investigate any `failed > 0` before continuing.

- [ ] **Step 3: Verify the backup captured the originals**

Run:
```bash
ls backups/audio-google-2026-07/ | wc -l
ls backups/audio-google-2026-07/*.ogg | wc -l
```
Expected: counts matching the pre-existing mp3 and ogg files (non-zero).

- [ ] **Step 4: Spot-check a re-rendered file and the preserved before**

Run:
```bash
uv run python -c "from pydub import AudioSegment as A; print('kokoro', round(A.from_mp3('static/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts.mp3').duration_seconds,1),'s'); print('google', round(A.from_mp3('static/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts-google.mp3').duration_seconds,1),'s')"
```
Expected: two durations printed; both > 0. Listen to both to confirm the A/B contrast.

- [ ] **Step 5: Commit the new audio**

```bash
git add static/audio
git commit -m "Re-render all post audio with local Kokoro; preserve 2019 Google clip for A/B"
```

---

## Task 9: Write the blog post

**Files:**
- Create: `content/post/2026-07-11-narrating-my-blog-with-a-local-model.md`

- [ ] **Step 1: Draft the post**

Create `content/post/2026-07-11-narrating-my-blog-with-a-local-model.md` with this front matter and structure (fill the prose in your voice; keep the shortcodes and the two A/B players exactly as shown):
```markdown
---
title: "Narrating my blog with a model that runs on my laptop"
date: 2026-07-11T12:00:00+02:00
draft: false
slug: "narrating-my-blog-with-a-local-model"
categories: ["machine learning", "hugo"]
keywords: ["text-to-speech", "kokoro", "mlx", "apple silicon", "tts", "local ai"]
description: "Seven years ago I narrated my posts with a cloud API. Now an 82M-parameter model does it locally, for free, faster than real time."
---

{{<audio src="/audio/2026-07-11-narrating-my-blog-with-a-local-model.mp3" type="mp3">}}

<!-- Opening: callback to the 2019 post. -->

## The 2010 sound of 2019

<!-- Set up the A/B. Old Google render first: -->

Here is how a paragraph of that 2019 post sounded, straight from Google's Wavenet:

{{<audio src="/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts-google.mp3" type="mp3">}}

And here is the same post, re-narrated today by Kokoro running locally:

{{<audio src="/audio/2019-10-29-use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts.mp3" type="mp3">}}

## What changed: Kokoro + MLX

<!-- Explain Kokoro-82M (lookup of what it is, Apache-2.0, trained on long-form
narration), and mlx-audio running it natively on Apple Silicon. Cite the real
speed number you measured in Task 8 Step 2 (Nx real time on the M1). -->

## The jargon problem

<!-- The pronunciation-lexicon war story: espeak-ng G2P mangling "int8", "RRF",
"Goldmark"; the shared scripts/tts_lexicon.yaml fix. Show a couple of lexicon
entries. -->

## The pipeline

<!-- extract (reusing the search pipeline's to_prose) -> lexicon -> sentence
chunking -> Kokoro synth -> stitch to MP3, all via a click CLI with an --all
batch mode. Keep it short; link the repo. -->

## Free, local, and yours

<!-- Close on the thesis: the cloud API you needed in 2019 now runs on a laptop
for free, faster than real time. Tie back to the semantic-search post. -->
```

- [ ] **Step 2: Render the post's own audio**

Run:
```bash
uv run python scripts/text_to_speech.py content/post/2026-07-11-narrating-my-blog-with-a-local-model.md
```
Expected: `wrote static/audio/2026-07-11-narrating-my-blog-with-a-local-model.mp3`.

- [ ] **Step 3: Verify it builds and the players render**

Run:
```bash
hugo --quiet --destination /tmp/tts_verify
```
Expected: no errors. Confirm the post page contains three `<audio` players (its own + the two A/B clips):
```bash
grep -c "<audio" /tmp/tts_verify/narrating-my-blog-with-a-local-model/index.html
```
Expected: `3`.

- [ ] **Step 4: Commit**

```bash
git add content/post/2026-07-11-narrating-my-blog-with-a-local-model.md static/audio/2026-07-11-narrating-my-blog-with-a-local-model.mp3
git commit -m "Add post: narrating my blog with a local model"
```

---

## Final review

After all tasks, dispatch a final code review over the whole branch, then verify:

- [ ] `uv run pytest tests/tts -v -m "not slow"` — all green.
- [ ] `uv run pytest tests/tts -v -m slow` — Kokoro smoke test green.
- [ ] `DRY_RUN=1 ./deploy.sh` — existing deploy guards (index rebuild, anchors, node --test) still pass with the new pyproject/env.
- [ ] `grep -rn "google" requirements.txt` returns nothing (file is gone); no `google-cloud-texttospeech` import remains: `rg "texttospeech" scripts/` is empty.
- [ ] The new post plays its own Kokoro audio and the A/B pair on a local `hugo server`.

Deployment (push + `./deploy.sh`) remains the user's call.
```
