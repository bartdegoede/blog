# Local, high-quality blog narration with Kokoro — Design

**Date:** 2026-07-11
**Status:** Approved (design)
**Author:** Bart (with Claude)

## Goal

Replace the blog's 2019-era Google Cloud Text-to-Speech pipeline with a local,
free, higher-quality one built on **Kokoro-82M** running through **MLX** on
Apple Silicon. Re-narrate the entire back catalogue, and write a blog post about
the change whose hook is a side-by-side old-vs-new audio comparison.

This is a sequel to two earlier posts — the 2019 "Use Google Cloud
Text-to-Speech to create an audio version of your blog posts" and the 2026
"Semantic search in your browser" — and shares their thesis: **capability that
needed a cloud API a few years ago now runs locally on a laptop, for free.**

## Context

- Current pipeline: `scripts/text_to_speech.py`, a single click CLI using
  `google-cloud-texttospeech==0.5.0`. It strips Hugo front matter and code
  blocks, converts markdown → HTML → text via BeautifulSoup, chunks to the
  5000-byte API limit, synthesizes each chunk, and stitches to MP3 with pydub.
- Machine: Apple M1, 16 GB. Kokoro-82M is ~82M params (a few hundred MB) and
  runs 12–79× real time across the Apple Silicon lineup via `mlx-audio`.
- Audio output lives in `static/audio/<md-stem>.mp3` — named by the markdown
  file's basename (e.g. `2019-10-29-use-google-...mp3`), **not** the front-matter
  slug — and is embedded with the `{{< audio >}}` shortcode. Legacy `.ogg`
  companions exist from before the MP3-only switch; the new pipeline is MP3-only.

## Decisions (locked)

1. **Full replacement.** Remove `google-cloud-texttospeech` entirely; Kokoro/MLX
   is the only backend. No cloud key, no cost.
2. **Re-render the whole back catalogue**, keeping a backup of every existing
   Google MP3.
3. **Shared pronunciation lexicon** (one repo-level YAML file) to fix Kokoro's
   known weak spot: technical jargon and rare names.
4. **A/B in the post** compares the 2019 origin post re-narrated: its preserved
   Google render vs its new Kokoro render — same text, genuine before/after.
5. **Environment migration.** Retire `requirements.txt` and the
   `~/.virtualenvs/blog` virtualenv; adopt `uv` + `pyproject.toml` + a
   `uv.lock`-managed `.venv` for all the blog's Python (TTS and the existing
   search-index build).

## Architecture

```
post.md
  → extract()     strip front matter, code, footnotes, shortcodes → prose
  → lexicon()     whole-word spoken-form substitution
  → chunk()       split on sentence boundaries into synth-sized pieces
  → synth()       Kokoro via mlx-audio: text → 24 kHz audio array   [per chunk]
  → stitch()      concatenate segments → MP3
  → static/audio/<slug>.mp3
```

The synthesis step is the only piece that loads the model. Everything else is
pure text/audio transformation that unit-tests without the model.

## Components

A small `scripts/tts/` package of focused modules, orchestrated by the existing
`scripts/text_to_speech.py` CLI.

| File | Responsibility | Testable without model |
|------|----------------|:----------------------:|
| `scripts/tts/extract.py` | Markdown → narratable prose. Front matter, fenced/indented code, footnote refs, and shortcodes removed. Fixes the fence/tag regex bugs found in the search project (line-scanner fence termination, newline-bounded tag stripping, inline-code stashing). | ✅ |
| `scripts/tts/lexicon.py` | Load `scripts/tts_lexicon.yaml`; apply whole-word, case-sensitive spoken-form substitution. Longest-match-first so multi-word entries win. | ✅ |
| `scripts/tts/chunk.py` | Split prose into synth-sized chunks on sentence boundaries (target ~1–2 sentences / a few hundred chars) to avoid Kokoro's paragraph-boundary artifacts on long runs. | ✅ |
| `scripts/tts/synth.py` | Wrap `mlx-audio` Kokoro behind `synth(text, voice) -> np.ndarray` at 24 kHz. Lazy-loads the model once. The only unit needing the model. | mocked |
| `scripts/tts/stitch.py` | Concatenate 24 kHz segments and export MP3 via pydub. | ✅ |
| `scripts/text_to_speech.py` | click CLI. Single-file mode (`FILENAME`) and batch mode (`--all`) that backs up existing MP3s, then re-renders every `content/post/*.md`. `--voice` (default `af_heart`), `--speed`. | orchestration |
| `scripts/tts_lexicon.yaml` | Shared pronunciation map, e.g. `int8: "int eight"`, `RRF: "R R F"`, `Goldmark: "Gold mark"`, `espeak-ng: "e speak N G"`. Grows over time. | data |
| `tests/tts/` | pytest units for extract, lexicon, chunk, stitch; one opt-in slow test that renders two sentences and asserts a non-empty 24 kHz WAV. | ✅ |

### Interface sketch

```python
# synth.py — isolated so the rest of the pipeline tests with a fake
def synth(text: str, voice: str = "af_heart", speed: float = 1.0) -> np.ndarray:
    """Return a 1-D float32 array of 24 kHz mono samples for `text`."""

# lexicon.py
def apply_lexicon(text: str, lexicon: dict[str, str]) -> str: ...

# chunk.py
def sentence_chunks(prose: str, max_chars: int = 400) -> list[str]: ...

# stitch.py
def stitch_to_mp3(segments: list[np.ndarray], out_path: Path, sample_rate: int = 24000) -> None: ...
```

## Data flow & batch behaviour

- Output filename is always the markdown basename with a `.mp3` extension
  (`content/post/2019-10-29-foo.md` → `static/audio/2019-10-29-foo.mp3`),
  matching the existing convention so re-renders overwrite the right files.
- **Single file:** `uv run tts content/post/foo.md` → `static/audio/foo.mp3`.
- **Batch (`--all`):**
  1. Copy every existing `static/audio/*.mp3` and `.ogg` →
     `backups/audio-google-2026-07/` (created once; skip if already backed up so
     re-runs are safe).
  2. For each `content/post/*.md` with body text, render and overwrite
     `static/audio/<md-stem>.mp3`.
  3. Continue on per-file errors; print a summary (rendered / skipped / failed).

## Backup strategy

- `backups/` at the repo root, **gitignored** and outside the Hugo publish tree,
  so backups never deploy.
- Exception for the A/B: **before** the batch overwrites it, the 2019 origin
  post's original Google MP3
  (`static/audio/2019-10-29-use-google-...mp3`) is copied to a stable, committed
  "before" file — `static/audio/2019-10-29-use-google-...-google.mp3`. The new
  post embeds this `-google` clip (before) next to the re-rendered Kokoro file
  (after). Both stay on the live site.

## Environment migration (uv + pyproject.toml)

- **Create `pyproject.toml`** declaring all blog Python dependencies:
  runtime — `mlx-audio`, `misaki`, `soundfile`, `numpy`, `pydub`,
  `beautifulsoup4`, `markdown`, `click`, `pyyaml`,
  `static-site-search-eval==0.1.0` (the search-index build);
  dev — `pytest`, `ruff`, `black`.
- **`uv sync`** manages a repo-local `.venv` and a committed `uv.lock`.
- **Retire** `requirements.txt` and stop using `~/.virtualenvs/blog`. Add
  `.venv/` to `.gitignore`.
- **`deploy.sh`**: change the index-rebuild guard from a bare `python` to
  `uv run python scripts/build_search_index.py` so deploys use the locked env.
- **System dependency:** Kokoro's English G2P (misaki) may require `espeak-ng`.
  Document `brew install espeak-ng` as a one-time setup step in the plan; the
  synth module surfaces a clear error if it's missing.

## Error handling

- `mlx-audio` / model unavailable → actionable error naming the install step.
- Empty prose (e.g. a stub post) → skip with a log line, no empty MP3.
- Missing lexicon file → proceed with an empty lexicon and a warning.
- Batch mode isolates per-file failures; one bad post never aborts the run.

## Testing

Kokoro output is not bit-reproducible, so there is **no parity gate** like the
search project. Tests cover the deterministic plumbing:

- `extract`: front matter removed; fenced and indented code dropped; footnote
  refs and shortcodes gone; inline code preserved as words; a known-tricky post
  (the OpenSearch one, `k < 3`, `n > 1000`, `<ShortName>`) survives intact.
- `lexicon`: whole-word only (no substring hits inside larger words);
  longest-match-first; case-sensitive.
- `chunk`: never exceeds `max_chars`; never splits mid-sentence; round-trips to
  the original prose modulo whitespace.
- `stitch`: N segments → one MP3 whose duration ≈ sum of segment durations.
- One opt-in (`@pytest.mark.slow`) end-to-end render of two sentences asserting a
  non-empty 24 kHz WAV.

## The blog post (final task)

New `content/post/2026-07-<dd>-<slug>.md`:

- **Hook:** the A/B — the 2019 origin post in Google's robotic voice vs the new
  Kokoro render, side by side.
- Why the old one sounds dated; what Kokoro/MLX are; why local + free + faster
  than real time matters.
- The pronunciation-lexicon war story (jargon G2P failures and the fix).
- Real M1 speed numbers measured during the batch re-render.
- Its own Kokoro audio via `{{< audio >}}`.
- Ties back to the 2019 and semantic-search posts.

## Out of scope

- Voice cloning, multi-speaker, or non-English narration.
- A public benchmark widget (unlike the search post — not warranted here).
- Streaming / real-time synthesis in the browser.
- Changing the `{{< audio >}}` shortcode or the audio player UI.
