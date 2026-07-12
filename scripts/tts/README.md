# Blog narration (local Kokoro TTS)

Generates the MP3 audio versions of blog posts locally with **Kokoro-82M** via
`mlx-audio` on Apple Silicon. No cloud, no API key, no cost. Roughly 8× real
time on an M1 (about 15 minutes to re-narrate the whole blog).

## One-time setup

```bash
uv sync                      # install Python deps into .venv
brew install espeak-ng ffmpeg   # Kokoro's phonemizer + MP3 encoding
```

Everything runs through `uv run` (uses `.venv`; ignore the `VIRTUAL_ENV`
mismatch warning).

## Narrating posts

```bash
# One post -> static/audio/<same-filename-stem>.mp3
uv run python scripts/text_to_speech.py content/post/2026-07-11-my-post.md

# The whole catalogue (backs up existing audio first, shows a progress bar)
uv run python scripts/text_to_speech.py --all
```

Options: `--voice af_heart` (Kokoro has 54 voices; `af_bella`, `af_nova` are
also good for narration), `--speed 1.0`.

The output filename is always the **markdown filename** with `.mp3`, so it
matches what the `{{< audio >}}` shortcode in the post expects.

## `--all` is safe

Before rendering, it copies every existing `static/audio/*.mp3` and `.ogg` into
`backups/audio-google-2026-07/` (gitignored). It **never deletes** anything and
never overwrites an existing backup, so re-running keeps the first snapshot.

## Fixing pronunciation

Kokoro mangles jargon. Two ways to fix it, both in `scripts/tts/`:

1. **`tts_lexicon.yaml`** — a `surface form: spoken form` map for individual
   terms. Case-sensitive, whole-word. Add a line and re-render:
   ```yaml
   Kubernetes: "koober netes"
   "±": " approximately "     # symbols map to space-padded words
   ```
2. **`lexicon.py` rules** — for patterns, not single words. Already handles
   `<name>.js` → "name J S" and `~123` → "approximately". Add more there.

To hear whether a change worked without re-rendering everything, narrate one
post and listen, or dump the text a post will speak:

```bash
PYTHONPATH=scripts uv run python -c \
  "from tts.extract import to_narration; from tts.lexicon import *; \
   from pathlib import Path; \
   lex=load_lexicon('scripts/tts_lexicon.yaml'); \
   print(apply_pronunciation_rules(apply_lexicon(to_narration(Path('content/post/POST.md').read_text()), lex)))"
```

## How it works

`text_to_speech.py` is a shim into the `scripts/tts/` package:
`extract` (markdown → prose) → `lexicon` (pronunciation) → `chunk` (sentences)
→ `synth` (Kokoro) → `stitch` (MP3). See `../../CLAUDE.md` for the per-file
breakdown.

## Tests

```bash
uv run pytest tests/tts -m "not slow"    # fast, no model
uv run pytest tests/tts -m slow          # actually renders with Kokoro
```
