# Real Waveform Audio Player — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static waveform image and native `<audio controls>` with a real per-post waveform (computed at build from each MP3) and a custom, theme-aware player (play/pause, time, speed, click-to-seek), fixing the dark-mode control artifacts.

**Architecture:** A `scripts/tts/peaks.py` module decodes an MP3 into a `{"peaks":[…]}` JSON file next to it. The `audio.html` shortcode reads that JSON at build time and emits inline SVG bars plus a headless `<audio>` and custom controls. One small site-wide classic script drives playback (progress fill, time, seek, speed).

**Tech Stack:** Python (`pydub`, `numpy`) for peaks; Hugo `os.ReadFile`/`transform.Unmarshal` for build-time reads; vanilla JS + CSS (PaperMod theme variables) for the player.

**Reference:** design spec `docs/superpowers/specs/2026-07-12-waveform-player-design.md`.

**Verified build facts (do not re-litigate):**
- Peaks must be a JSON **object** `{"peaks":[…]}`. A bare JSON array is mis-sniffed by `transform.Unmarshal` as CSV (`[][]string`); an object is correctly parsed to a map whose `.peaks` is `[]interface{}`.
- `os.FileExists`/`os.ReadFile` resolve `static/audio/<stem>.peaks.json` from a shortcode (path relative to project root).

---

## File Structure

- `scripts/tts/peaks.py` — CREATE: `compute_peaks`, `peaks_path`, `write_peaks`.
- `scripts/tts/cli.py` — MODIFY: write peaks after each render; add `--peaks` backfill flag.
- `tests/tts/test_peaks.py` — CREATE.
- `tests/tts/test_cli.py` — MODIFY: assert render writes peaks; test `--peaks`.
- `layouts/shortcodes/audio.html` — REPLACE: inline SVG waveform + custom controls + headless audio + fallback.
- `assets/css/extended/custom.css` — MODIFY: migrate `#player`→`.tts-player`, drop native-control hacks, add waveform/controls styles.
- `layouts/partials/extend_footer.html` — MODIFY: add the site-wide player script.
- `static/audio/*.peaks.json` — GENERATED (Task 5 backfill; committed).

**Run Python tests:** `uv run pytest tests/tts -m "not slow"`.

---

## Task 1: `peaks.py` — compute and write waveform peaks

**Files:**
- Create: `scripts/tts/peaks.py`
- Test: `tests/tts/test_peaks.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/tts/test_peaks.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_peaks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tts.peaks'`.

- [ ] **Step 3: Implement `peaks.py`**

Create `scripts/tts/peaks.py`:
```python
"""Waveform peaks for the audio player.

A peaks file is a JSON object {"peaks": [ints 0-100]} sitting next to its MP3.
The shortcode renders these as bars at build time. Peaks are computed by
decoding the MP3, so the same code covers narrated posts, old posts, and the
A/B before-clip alike.

The file is an object, not a bare array, on purpose: Hugo's transform.Unmarshal
mis-sniffs a bare "[1,2,3]" as CSV. An object is parsed as JSON.
"""

import json
from pathlib import Path

import numpy as np
from pydub import AudioSegment

N_BARS = 200


def compute_peaks(samples, n_bars: int = N_BARS) -> list[int]:
    samples = np.abs(np.asarray(samples, dtype=np.float64).reshape(-1))
    if samples.size == 0:
        return [0] * n_bars
    buckets = np.array_split(samples, n_bars)
    peaks = np.array([b.max() if b.size else 0.0 for b in buckets])
    top = peaks.max()
    if top <= 0:
        return [0] * n_bars
    return [int(round(p / top * 100)) for p in peaks]


def peaks_path(mp3_path) -> Path:
    p = Path(mp3_path)
    return p.with_name(p.stem + ".peaks.json")


def write_peaks(mp3_path, n_bars: int = N_BARS) -> Path:
    seg = AudioSegment.from_file(Path(mp3_path)).set_channels(1)
    samples = np.array(seg.get_array_of_samples())
    out = peaks_path(mp3_path)
    out.write_text(json.dumps({"peaks": compute_peaks(samples, n_bars)}))
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_peaks.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/tts/peaks.py tests/tts/test_peaks.py
git commit -m "Add waveform peaks generation"
```

---

## Task 2: CLI — write peaks on render and a `--peaks` backfill

**Files:**
- Modify: `scripts/tts/cli.py`
- Test: `tests/tts/test_cli.py`

- [ ] **Step 1: Write the failing tests (append to `tests/tts/test_cli.py`)**

Add these tests (the file already imports `numpy as np`, `AudioSegment`, `cli`, `render_post`, `backup_existing_audio`, and `CliRunner`):
```python
def test_render_post_also_writes_peaks(tmp_path):
    md = tmp_path / "2020-01-01-hello.md"
    md.write_text("One. Two. Three.")
    out_dir = tmp_path / "audio"

    def real_ish_synth(text, voice="af_heart", speed=1.0):
        return np.full(2400, 0.2, dtype=np.float32)

    out = render_post(md, "af_heart", 1.0, {}, real_ish_synth, audio_dir=out_dir)
    assert (out_dir / "2020-01-01-hello.peaks.json").exists()


def test_peaks_flag_backfills_all_mp3s(tmp_path, monkeypatch):
    from tts.stitch import stitch_to_mp3

    audio = tmp_path / "audio"
    audio.mkdir()
    for name in ("a.mp3", "b.mp3"):
        stitch_to_mp3([np.full(2400, 0.3, dtype=np.float32)], audio / name, sample_rate=24000)
    monkeypatch.setattr(cli, "AUDIO_DIR", audio)

    result = CliRunner().invoke(cli.main, ["--peaks"])
    assert result.exit_code == 0
    assert (audio / "a.peaks.json").exists()
    assert (audio / "b.peaks.json").exists()
    assert "2" in result.output
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/tts/test_cli.py -v -k "peaks"`
Expected: FAIL (`render_post` doesn't write peaks; `--peaks` is not an option).

- [ ] **Step 3: Wire peaks into `cli.py`**

In `scripts/tts/cli.py`, add the import near the other `tts` imports:
```python
from tts.peaks import write_peaks
```

In `render_post`, write peaks right after stitching:
```python
    out = Path(audio_dir) / (md_path.stem + ".mp3")
    stitch_to_mp3(segments, out, sample_rate=SAMPLE_RATE)
    write_peaks(out)
    return out
```

Add the `--peaks` flag to `main` (new option) and handle it before anything that needs the model:
```python
@click.command()
@click.argument("filename", required=False, type=click.Path(exists=True, path_type=Path))
@click.option("--all", "all_posts", is_flag=True, help="Re-render every post in content/post.")
@click.option("--peaks", "peaks_only", is_flag=True, help="(Re)generate waveform peaks for every MP3 in static/audio, without synthesizing.")
@click.option("--voice", default="af_heart", show_default=True, help="Kokoro voice preset.")
@click.option("--speed", default=1.0, show_default=True, type=float)
def main(filename, all_posts, peaks_only, voice, speed):
    if peaks_only:
        mp3s = sorted(AUDIO_DIR.glob("*.mp3"))
        for mp3 in tqdm(mp3s, desc="Peaks", unit="file"):
            write_peaks(mp3)
        click.echo(f"wrote peaks for {len(mp3s)} files")
        return

    from tts.synth import preload, synth as synth_fn
    ...  # rest unchanged
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/tts/test_cli.py -v`
Expected: all pass (the two new tests included).

- [ ] **Step 5: Run the full fast suite**

Run: `uv run pytest tests/tts -m "not slow"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/tts/cli.py tests/tts/test_cli.py
git commit -m "Generate peaks on render and add --peaks backfill"
```

---

## Task 3: `audio.html` shortcode — inline waveform + custom player

**Files:**
- Replace: `layouts/shortcodes/audio.html`

- [ ] **Step 1: Replace the shortcode**

Replace the entire contents of `layouts/shortcodes/audio.html` with:
```go-html-template
{{- $src := .Get "src" -}}
{{- $uid := $src | anchorize -}}
{{- $peaksFile := "" -}}
{{- if $src }}{{ $peaksFile = printf "static%s" (replace $src ".mp3" ".peaks.json") }}{{ end -}}
<div class="tts-player" id="player-{{ $uid }}">
    <div class="listen">Listen to this article instead</div>
    <div class="tts-waveform" aria-hidden="true">
        {{- if and $peaksFile (os.FileExists $peaksFile) -}}
            {{- $data := os.ReadFile $peaksFile | transform.Unmarshal -}}
            {{- $peaks := $data.peaks -}}
            {{- $n := len $peaks -}}
            <svg class="wf" viewBox="0 0 {{ $n }} 100" preserveAspectRatio="none">
                <defs><clipPath id="clip-{{ $uid }}"><rect class="wf-clip" x="0" y="0" width="0" height="100"/></clipPath></defs>
                <g class="wf-base">{{ range $i, $p := $peaks }}<rect x="{{ $i }}" y="{{ div (sub 100.0 $p) 2.0 }}" width="0.6" height="{{ $p }}"/>{{ end }}</g>
                <g class="wf-played" clip-path="url(#clip-{{ $uid }})">{{ range $i, $p := $peaks }}<rect x="{{ $i }}" y="{{ div (sub 100.0 $p) 2.0 }}" width="0.6" height="{{ $p }}"/>{{ end }}</g>
            </svg>
        {{- else -}}
            {{ $img := resources.Get "img/waveform.svg" | minify }}<img class="wf-fallback" src="{{ $img.Permalink }}" alt="waveform">
        {{- end -}}
    </div>
    <div class="tts-controls">
        <button type="button" class="tts-play" aria-label="Play">&#9654;</button>
        <span class="tts-time">0:00 / 0:00</span>
        <button type="button" class="tts-speed" aria-label="Playback speed">1&times;</button>
    </div>
    <audio class="tts-audio" preload="metadata" {{ with .Get "title" }}data-info-title="{{ . }}"{{ end }}>
        {{ with $src }}<source src="{{ . }}"{{ with $.Get "type" }} type="audio/{{ . }}"{{ end }}>{{ end }}
        {{ with .Get "backup_src" }}<source src="{{ . }}"{{ with $.Get "backup_type" }} type="audio/{{ . }}"{{ end }}>{{ end }}
        Your browser does not support the audio element
    </audio>
</div>
```

- [ ] **Step 2: Build and verify the SVG renders for a post with peaks**

First generate one peaks file so the branch is exercised (the real backfill is Task 5):
```bash
uv run python -c "from pathlib import Path; import sys; sys.path.insert(0,'scripts'); from tts.peaks import write_peaks; print(write_peaks('static/audio/2026-07-10-semantic-search-in-your-browser.mp3'))"
hugo --quiet --destination /tmp/wf_build
grep -o '<svg class=wf[^>]*>' /tmp/wf_build/semantic-search-in-your-browser/index.html | head -1
grep -c 'class=wf-played' /tmp/wf_build/semantic-search-in-your-browser/index.html
```
Expected: an `<svg class=wf …>` tag prints, and the `wf-played` group count is ≥1.

- [ ] **Step 3: Verify the fallback for a post without peaks**

Pick any post whose `.peaks.json` does not exist yet and confirm the build emits `wf-fallback`:
```bash
grep -c 'wf-fallback' /tmp/wf_build/bloom-filters-and-bitcoin/index.html
```
Expected: `1` (no peaks for that post yet → static image fallback).

- [ ] **Step 4: Clean up the probe peaks file and commit the shortcode**

```bash
rm -f static/audio/2026-07-10-semantic-search-in-your-browser.peaks.json
git add layouts/shortcodes/audio.html
git commit -m "Render inline waveform and custom player in audio shortcode"
```

---

## Task 4: Player CSS and JS

**Files:**
- Modify: `assets/css/extended/custom.css`
- Modify: `layouts/partials/extend_footer.html`

- [ ] **Step 1: Migrate and extend the player CSS**

In `assets/css/extended/custom.css`, replace the existing player block (the `#player { … }` rule through the `#player audio { … }` rule and the `audio::-webkit-media-controls-*` rules that follow it) with:
```css
.tts-player {
    padding: 1.5rem;
    margin: 2rem 0;
    border-radius: 8px;
    background: var(--entry);
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.theme-dark .tts-player {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.tts-player .listen {
    color: var(--primary);
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
    font-weight: 500;
}

.tts-waveform {
    height: 64px;
    margin-bottom: 1rem;
    cursor: pointer;
}

.tts-waveform svg.wf {
    width: 100%;
    height: 100%;
    display: block;
}

.tts-waveform .wf-base rect {
    fill: var(--secondary);
    opacity: 0.35;
}

.tts-waveform .wf-played rect {
    fill: var(--primary);
}

.tts-waveform .wf-fallback {
    width: 100%;
    height: auto;
    border-radius: 4px;
    opacity: 0.8;
}

.tts-audio {
    display: none;
}

.tts-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.tts-play,
.tts-speed {
    background: var(--tertiary);
    color: var(--primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
}

.tts-play:hover,
.tts-speed:hover {
    background: var(--border);
}

.tts-play {
    min-width: 2.2rem;
}

.tts-speed {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
}

.tts-time {
    color: var(--secondary);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 2: Update the remaining `#player` references in the same file**

Elsewhere in `assets/css/extended/custom.css`, rename the leftover selectors so the styles still apply:
- `.post-content img:not(#waveform img)` → `.post-content img:not(.tts-waveform img)` (2 occurrences: the rule and its `.theme-dark` variant).
- `.post-content #player` → `.post-content .tts-player`.
- In the responsive `@media` block, `#player { … }` → `.tts-player { … }` and `#player .listen { … }` → `.tts-player .listen { … }`.

- [ ] **Step 3: Add the player script site-wide**

At the very end of `layouts/partials/extend_footer.html` (after the closing `{{- end }}` of the `.IsHome` block), append:
```html
<script data-cf-async="false">
document.addEventListener('DOMContentLoaded', function () {
    var SPEEDS = [0.75, 1, 1.25, 1.5, 2];
    function fmt(t) {
        if (!isFinite(t)) t = 0;
        var m = Math.floor(t / 60), s = Math.floor(t % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }
    document.querySelectorAll('.tts-player').forEach(function (player) {
        var audio = player.querySelector('.tts-audio');
        var playBtn = player.querySelector('.tts-play');
        var timeEl = player.querySelector('.tts-time');
        var speedBtn = player.querySelector('.tts-speed');
        var wave = player.querySelector('.tts-waveform');
        var clip = player.querySelector('.wf-clip');
        var svg = player.querySelector('svg.wf');
        var n = svg ? svg.viewBox.baseVal.width : 0;
        var si = 1;
        function update() {
            timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
            if (clip && n && audio.duration) {
                clip.setAttribute('width', (audio.currentTime / audio.duration) * n);
            }
        }
        playBtn.addEventListener('click', function () {
            if (audio.paused) { audio.play(); } else { audio.pause(); }
        });
        audio.addEventListener('play', function () { playBtn.innerHTML = '&#10074;&#10074;'; playBtn.setAttribute('aria-label', 'Pause'); });
        audio.addEventListener('pause', function () { playBtn.innerHTML = '&#9654;'; playBtn.setAttribute('aria-label', 'Play'); });
        audio.addEventListener('ended', function () { playBtn.innerHTML = '&#9654;'; });
        audio.addEventListener('timeupdate', update);
        audio.addEventListener('loadedmetadata', update);
        wave.addEventListener('click', function (e) {
            if (!audio.duration) { return; }
            var r = wave.getBoundingClientRect();
            var f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            audio.currentTime = f * audio.duration;
        });
        speedBtn.addEventListener('click', function () {
            si = (si + 1) % SPEEDS.length;
            audio.playbackRate = SPEEDS[si];
            speedBtn.textContent = SPEEDS[si] + '×';
        });
        update();
    });
});
</script>
```

- [ ] **Step 4: Build and verify markup + styles compile**

```bash
hugo --quiet --destination /tmp/wf_build2
grep -c 'tts-player' /tmp/wf_build2/semantic-search-in-your-browser/index.html
grep -o 'tts-play\|tts-speed\|tts-time' /tmp/wf_build2/semantic-search-in-your-browser/index.html | sort -u
```
Expected: `tts-player` present; the three control classes present. No Hugo build errors.

- [ ] **Step 5: Commit**

```bash
git add assets/css/extended/custom.css layouts/partials/extend_footer.html
git commit -m "Add custom audio player styles and script"
```

---

## Task 5: Backfill peaks and verify in the browser

**Files:**
- Generated (committed): `static/audio/*.peaks.json`

- [ ] **Step 1: Backfill peaks for every existing MP3**

```bash
uv run python scripts/text_to_speech.py --peaks
ls static/audio/*.peaks.json | wc -l
```
Expected: `wrote peaks for N files`; a `.peaks.json` for each `.mp3` (including the `-google.mp3` A/B clip).

- [ ] **Step 2: Verify the narration post now renders three real waveforms**

```bash
hugo --quiet --destination /tmp/wf_final
grep -c 'class=wf ' /tmp/wf_final/narrating-my-blog-with-a-local-model/index.html
grep -c 'wf-fallback' /tmp/wf_final/narrating-my-blog-with-a-local-model/index.html
```
Expected: three `class=wf ` SVGs (its own audio + the A/B pair), zero `wf-fallback`.

- [ ] **Step 3: Browser check with Playwright (progress, seek, speed, three independent players)**

Serve the site and drive it. Run `hugo server -p 1313 &` (or `hugo server` in another shell), then:
```bash
cat > /tmp/wf_check.mjs <<'EOF'
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:1313/narrating-my-blog-with-a-local-model/', { waitUntil: 'networkidle' });
const players = await p.$$('.tts-player');
console.log('players', players.length);
// wait for the first audio's metadata, then seek to the middle and check the clip grows
const res = await p.evaluate(async () => {
  const player = document.querySelector('.tts-player');
  const audio = player.querySelector('.tts-audio');
  const clip = player.querySelector('.wf-clip');
  const speedBtn = player.querySelector('.tts-speed');
  await new Promise(r => { if (isFinite(audio.duration) && audio.duration) r(); else audio.addEventListener('loadedmetadata', r, { once: true }); });
  audio.currentTime = audio.duration / 2;
  await new Promise(r => audio.addEventListener('timeupdate', r, { once: true }));
  const w = parseFloat(clip.getAttribute('width'));
  speedBtn.click();
  return { duration: audio.duration, clipWidth: w, rate: audio.playbackRate, speedLabel: speedBtn.textContent };
});
console.log(JSON.stringify(res));
await b.close();
EOF
node /tmp/wf_check.mjs
```
Expected: `players 3`; `duration` finite; `clipWidth` roughly half of 200 (≈100); `rate` `1.25`; `speedLabel` `1.25×`. Stop `hugo server` afterward.

- [ ] **Step 4: Commit the peaks**

```bash
git add static/audio
git commit -m "Backfill waveform peaks for all audio"
```

---

## Final review

- [ ] `uv run pytest tests/tts -m "not slow"` — all green (peaks + cli tests included).
- [ ] `DRY_RUN=1 ./deploy.sh` — existing guards still pass (search index, anchors, JS tests).
- [ ] On `hugo server`: the player looks right in **both** light and dark mode (no native-control pills), the waveform fills as it plays, clicking seeks, and the speed button cycles `0.75× → 1× → 1.25× → 1.5× → 2×`.
- [ ] The three players on the narration post work independently.

Deployment remains the user's call. Note: the pending post re-render (separate, already-planned work) will regenerate peaks automatically via `render_post`.
```
