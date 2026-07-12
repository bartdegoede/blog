# Real waveform audio player — Design

**Date:** 2026-07-12
**Status:** Approved (design)
**Author:** Bart (with Claude)

## Goal

Replace the blog's static decorative waveform image and native `<audio controls>`
with:

1. A **real per-post waveform**, computed at build time from each MP3's samples
   and rendered as inline SVG bars.
2. A **custom, theme-aware player** — play/pause, `MM:SS / MM:SS` time, a
   playback-speed toggle, and click-to-seek on the waveform — driving a headless
   `<audio>` element.

The custom player also fixes a dark-mode bug: the native audio controls render
their shadow-DOM chrome (play button, time, volume, ⋮ menu) with light-ish
defaults that show as pale rounded-rectangle artifacts on the dark theme. Native
audio controls can't be reliably themed, so we drop them and own the controls.

## Decisions (locked)

- **Peaks source:** decode each MP3 (standalone), so one mechanism covers
  narrated posts, old posts, and the Google A/B before-clip uniformly.
- **Rendering:** build-time inline SVG (Hugo reads the peaks JSON at build; no
  runtime fetch; the waveform is present before JS runs).
- **Interaction:** click-to-seek on the waveform.
- **Controls:** custom play/pause + time + speed toggle (1× / 1.5× / 2×);
  headless `<audio>`.

## Architecture

```
generate:  static/audio/<stem>.mp3  --pydub decode-->  static/audio/<stem>.peaks.json  (~200 ints)
build:     audio.html shortcode reads the peaks JSON  -->  inline <svg> bars + custom controls
runtime:   one small site-wide script drives each headless <audio>:
             timeupdate -> grow the "played" clip + update time text
             click on waveform -> seek;  speed button -> cycle playbackRate
```

Peaks are a pure function of an MP3, so generation is decoupled from synthesis.

## Components

### 1. Peaks generation — `scripts/tts/peaks.py`

```python
def compute_peaks(samples: np.ndarray, n_bars: int = 200) -> list[int]:
    """Bucket samples into n_bars groups, take peak |amplitude| per bucket, and
    normalize so the loudest bar is 100. Silence -> all zeros (no divide-by-zero)."""

def peaks_path(mp3_path: Path) -> Path:
    """<stem>.peaks.json next to the MP3."""

def write_peaks(mp3_path, n_bars: int = 200) -> Path:
    """Decode the MP3 (pydub), mono-ize, compute_peaks, write the JSON int array."""
```

Wiring in `scripts/tts/cli.py`:
- `render_post` calls `write_peaks(out)` after `stitch`, so narration keeps peaks
  in sync automatically.
- A new `--peaks` flag backfills peaks for **every** `static/audio/*.mp3` without
  re-synthesizing — how old posts and the Google clip get waveforms before the
  pending re-render.

### 2. Shortcode — `layouts/shortcodes/audio.html`

At build time:
- Derive the peaks path from `src` (`/audio/foo.mp3` → `static/audio/foo.peaks.json`).
- If it exists (`os.FileExists`), read (`os.ReadFile`) and `unmarshal` the int
  array, and emit an inline `<svg preserveAspectRatio="none" viewBox="0 0 N 100">`:
  - a **base** bar group (muted color) — one centered `<rect>` per peak, height ∝ value;
  - a **played** bar group (accent color), identical bars, clipped by a
    `<rect>` whose width JS grows with playback.
- If the peaks file is missing, fall back to the current static waveform image as
  the scrubber visual (same controls/JS still apply).
- Emit the custom control row (play/pause `<button>`, time `<span>`, speed
  `<button>`) and a **headless** `<audio>` (no `controls` attribute) with the
  `src` and optional `backup_src` `<source>` elements (keeps ogg backups working).
- Give each instance a unique id derived from `src`, so the three players on the
  narration post (its own audio + the A/B pair) don't collide.

Existing shortcode params to preserve: `src`, `type`, `backup_src`, `backup_type`,
`preload`, `title`.

### 3. Player script + styles

- **Script:** one small **classic** script (not an ES module — avoids the
  Rocket-Loader/module issue entirely), loaded site-wide via
  `layouts/partials/extend_footer.html`, tagged `data-cf-async="false"`. On
  `DOMContentLoaded` it wires every `.tts-player`:
  - play/pause toggle (swaps the button icon; `ended` resets to play);
  - `loadedmetadata` / `timeupdate` → update `MM:SS / MM:SS` and set the played
    clip width to `currentTime / duration * N`;
  - click on the waveform → `currentTime = offsetX / width * duration`;
  - speed button cycles 1 → 1.5 → 2 → 1 via `playbackRate`, updating its label.
  - No-ops on pages without a `.tts-player`.
- **Styles:** in `assets/css/extended/custom.css`, using PaperMod theme variables
  (`--primary`, `--secondary`, `--content`, `--entry`) so light and dark both look
  right. Played bars use the accent color, unplayed a muted color; the control row
  matches the card. This is what removes the dark-mode artifacts.

## Backfill & data

- Run `uv run python scripts/text_to_speech.py --peaks` once to generate
  `static/audio/*.peaks.json` for all current audio (incl. the Google before-clip),
  and commit them (~1 KB each). The pending post re-render refreshes them
  automatically thereafter.

## Testing

- **`compute_peaks`** (pure): returns `n_bars` ints in `[0, 100]`; a silent signal
  → all zeros; a louder bucket → a taller bar than a quiet one; the loudest bar is
  exactly 100.
- **`write_peaks`** round-trip: stitch a tone to MP3, `write_peaks`, assert the
  JSON exists, has `n_bars` entries, all in range.
- **Build:** `hugo` renders the inline `<svg>` bars for a post with peaks, and the
  static-image fallback for one without.
- **Browser (Playwright, light):** on a post, the played clip width increases
  after playback advances; clicking the waveform seeks; the speed button changes
  `audio.playbackRate`; all three players on the narration post operate
  independently.

## Out of scope

- Volume slider and download/⋮ menu (system volume covers volume; narration
  doesn't need download).
- Per-post or configurable bar colors; hand-editing bar shapes.
- Keyboard shortcuts.
- Storing peaks anywhere but next to the MP3.
