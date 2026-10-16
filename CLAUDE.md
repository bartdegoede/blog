# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal blog built with Hugo, using the PaperMod theme. The blog includes custom client-side search functionality using Fuse.js and a text-to-speech generation script for blog posts. The site is deployed to GitHub Pages at bart.degoe.de.

## Build and Development Commands

### Building the site
```bash
hugo
```
Builds the site and outputs to the `public/` directory.

### Local development server
```bash
hugo server
```
Starts a local development server with live reload. The site will be available at http://localhost:1313.

### Deployment
```bash
./deploy.sh ["optional commit message"]
```
Builds the site, commits the output in the `public/` folder, and pushes to GitHub Pages. The `public/` directory is a separate git repository. The script includes:
- Automatic submodule initialization if needed
- Build verification and error handling
- Change detection (skips deployment if no changes)
- Colored output for better visibility
- Success confirmation with site URL
- IndexNow ping after the push: `scripts/indexnow.py` submits the pages changed by `public/`'s HEAD commit (filtered to `sitemap.xml`) to Bing et al. The key file is `static/1ccacb48aa3c4776ac3c84a0b3db89d7.txt`. Use `--dry-run` to preview or `--all` to submit the whole sitemap. A failed ping only warns.

### Generate audio versions of blog posts
```bash
uv run python scripts/text_to_speech.py content/post/[filename].md   # one post
uv run python scripts/text_to_speech.py --all                        # whole catalogue
```
Converts blog post markdown to an MP3 using a **local** Kokoro-82M model (via
`mlx-audio` on Apple Silicon) — no cloud, no API key, no cost. Details:
- Python dependencies are in `pyproject.toml` / `uv.lock`; run everything with `uv run`.
- Needs `espeak-ng` and `ffmpeg` (Homebrew) for Kokoro's G2P and MP3 encoding.
- Pronunciation of jargon is fixed with the shared lexicon `scripts/tts_lexicon.yaml`.
- **Before every render, run `uv run python scripts/text_to_speech.py --check <post>`**
  and add each word it lists to the lexicon until it prints "no unknown words".
  Kokoro's G2P (misaki) silently drops or garbles words it doesn't know: model
  names (Qwen, Smol), units (MB, tok/s), slang, compounds (shortcode,
  leaderboard) and typos. Plain respellings often aren't known either; use
  misaki's inline phoneme override, e.g. `Qwen3: "[Qwen](/kwˈɛn/) three"`, and
  re-check. Letterless leftovers (`#`, `>`, `[1]`) are dropped and not reported.
- `--all` backs existing audio up to `backups/` (copy, never delete) before re-rendering.
- Outputs to `assets/audio/<markdown-stem>.mp3` (content-hashed into the page by Hugo's `fingerprint` so re-rendered audio busts caches).

## Architecture

**Important:** The `public/` directory is a **git submodule** (registered in `.gitmodules`) that tracks the `master` branch of the GitHub Pages deployment repo (`bartdegoede.github.io`). Its build output is committed and pushed to *that* repo, not to this one's history. The `deploy.sh` script handles committing and pushing within `public/` independently; the parent repo's submodule pointer is intentionally left lagging (`M public` in `git status` is expected — don't feel obliged to bump it).

**Deploy gotchas (learned the hard way — do not repeat):**
- **Never build with `hugo --cleanDestinationDir`.** Because `public/` is a submodule, its `.git` is a gitlink *file*; cleanDestinationDir deletes it (and every committed-but-not-regenerated file), breaking the submodule with `fatal: in unpopulated submodule 'public'`. Recovery: restore the gitlink with `echo "gitdir: ../.git/modules/public" > public/.git` — history survives in `.git/modules/public`.
- **Files that must exist in `public/` but aren't page output — `CNAME`, `BingSiteAuth.xml` — live in `static/`** so a normal build always re-emits them. Anything only committed into `public/` directly is fragile and can be wiped.
- **To retire or rename a slug, add `aliases: ["/old-slug/"]`** to the post's front matter. Hugo regenerates the old URL as a forward-redirect stub (meta-refresh + canonical pointing to the new URL), which preserves inbound links and avoids duplicate-content pages. A plain `hugo` build never deletes orphaned old-slug directories on its own.

**Note on Migration:** This blog was migrated from hyde-x theme to PaperMod in October 2025. Legacy files remain for reference:
- `layouts/partials/search.html`, `search_scripts.html`, `sidebar/footer.html` — old search/sidebar partials
- `assets/css/bart.degoe.de.css` — old theme CSS
- `assets/js/search/search.js`, `assets/js/vendor/lunr.min.js` — old Lunr.js search
- `themes/hyde-x/` — old theme directory

### Key Customizations Over PaperMod

The site extends PaperMod via its extension system rather than forking the theme:

- **`layouts/partials/extend_head.html`**: Dark mode flash prevention (sets `.dark` on `<html>` before paint), OpenSearch integration, and `include_js`/`include_cdn` front matter support
- **`layouts/partials/extend_footer.html`**: Inline Fuse.js search engine (loads index from `/index.json`, fuzzy matching with weighted fields)
- **`layouts/index.html`**: Custom homepage with search bar + paginated post list
- **`layouts/_default/single.html`**: Custom post template with Buy Me a Coffee button
- **`layouts/index.json`**: Generates JSON search index at `/index.json` with title, categories, href, content
- **`assets/css/extended/custom.css`**: Custom styles (PaperMod auto-loads from this path)
- **`assets/css/extended/charts.css`**: Styles for the inline SVG charts (see "Charts" below)

### Charts

Post charts are inline SVG, not images: `{{< svg "name.svg" "caption" >}}`
(`layouts/shortcodes/svg.html`) inlines `assets/svg/<post file stem>/name.svg`, so
the chart can use the page's CSS. The SVGs carry only `viz-*` classes and no
colours. Every colour comes from `assets/css/extended/charts.css`: series colours
`--viz-s1` / `--viz-s2` with dark-mode values, and PaperMod's `--primary`,
`--secondary`, `--border`, `--theme`. That way the charts follow the theme toggle.

- **Generate the SVGs with a script, never by hand.** `scripts/ask_eval/charts.py`
  draws the RAG post's charts from the eval data. The small-rag-finetune repo's
  `small-rag-finetune loss-chart` draws loss curves in the same style.
- **Reuse the existing classes.** Lines `viz-line` (+ `viz-faint`), dots `viz-dot`
  (+ `viz-muted` / `viz-hollow` / `viz-light`), `viz-ring` for a highlighted
  point, `viz-grid` / `viz-baseline` / `viz-sep` for axes, and `viz-tick` /
  `viz-axis` / `viz-label` / `viz-note` / `viz-sub` for text. Series are
  `viz-s1` / `viz-s2`. If a chart needs a new class, add it to `charts.css` with
  both theme variants, not inline `style=` or `fill=` colours.
- Hover details go in a native SVG `<title>` inside a `<g>`, with a transparent
  `viz-hit` circle for a bigger target. Each SVG needs a `<title>`/`<desc>` pair
  referenced by `aria-labelledby`, with ids unique on the page.
- Check both themes before publishing: `hugo server`, then toggle dark mode.

### Search Functionality

Client-side full-text search using Fuse.js (v7.1.0 via CDN):

1. `layouts/index.json` generates a JSON feed at `/index.json` with all posts
2. `layouts/partials/extend_footer.html` contains inline JS that initializes Fuse.js on the homepage
3. Fuse.js config: case-insensitive, threshold 0.4, weighted fields (title 0.8, content 0.5, categories 0.3)
4. Search box on homepage shows top 10 results dynamically, ESC clears

### Related Posts

Each post can carry a `related:` front-matter list of post slugs, rendered as a
"Related posts" block by `layouts/partials/related.html` (included in
`single.html`). The list is the single source of truth; an absent/empty list
renders nothing, and unresolved slugs are skipped.

Suggestions are generated by `scripts/suggest_related.py`, which embeds each
post as the mean of its chunk vectors (`sss_eval` chunker + the
`potion-retrieval-32M` model2vec model) and prints ranked cosine candidates:

```bash
uv run python scripts/suggest_related.py <slug>     # one post
uv run python scripts/suggest_related.py --all      # whole catalogue
```

**Workflow (suggest, then confirm):** when adding or editing a post, run the
script, present the top 2-3 candidates (with scores) to the user, and wait for
confirmation before writing the confirmed slugs into that post's `related:`
front matter. Never auto-fill `related:`. If nothing clears the threshold, say
so and leave it empty. The script only prints — it never edits front matter.

### /ask/ page (in-browser RAG)

`content/ask.md` + `layouts/_default/ask.html` mount an "ask my blog" page:
semantic search retrieves the top 4 passages, and a small LLM (transformers.js,
WebGPU or single-threaded WASM) streams a ≤2-sentence summary in a Web Worker.
The page is `noindex`, unlisted and out of the sitemap; it's linked from the
homepage search box (the Part 3 post will link to it too).

- `assets/js/ask/{retrieve,prompt,display,progress,models}.js` — pure, unit-tested
  (`tests/js/ask-*.test.mjs`); every rule and number lives here (gate 0.45, two
  sentences, repetition penalty, prompt). The repetition penalty is set per model:
  `repetitionPenalty` in `models.js`, defaulting to `REPETITION_PENALTY` (1.15) in
  `prompt.js`. It's off (1.0) for Qwen3 and LFM2.5, which answer more faithfully
  without it and don't loop. `candidates.json` must carry the same value
  (`repetition_penalty`), which a test checks, so the eval runs what ships. `prompt.js` and `retrieve.js` are shared
  with the eval in `scripts/ask_eval/`.
- `assets/js/ask/worker.js` — imports transformers.js from jsDelivr (pinned);
  `assets/js/ask/page.js` — DOM/state.
- Model weights come from the Hugging Face Hub, pinned by revision in
  `assets/js/ask/models.js`; a test keeps it identical to
  `scripts/ask_eval/candidates.json` (the eval measured exactly those files).
- Gemma 3 / LFM2.5 are `webgpuOnly` (their q4f16 needs a kernel WASM lacks).
- End-to-end check (not run by `node --test`):
  `hugo server --port 1314` then `BASE_URL=http://localhost:1314 node tests/e2e/ask.e2e.mjs`
  (optional `MODEL=qwen3-0.6b`). Headless Chromium has no WebGPU, so it covers
  the WASM path; check WebGPU by hand in Chrome.
- Eval, decisions and numbers: `docs/superpowers/specs/2026-10-12-ask-my-blog-results.md`.

### Hugo Configuration

- **`config.yml`**: YAML format, base URL `https://bart.degoe.de`
- Output formats: HTML, JSON (for search), RSS
- Permalink structure: `/:slug/` (preserved from legacy site for URL compatibility)
- Goldmark renderer with `unsafe: true` (allows raw HTML in markdown)
- HTML minification enabled

### Asset Pipeline

- Custom CSS: `assets/css/extended/custom.css` (auto-loaded by PaperMod)
- Post-specific JS via `include_js` front matter field (loaded from `assets/js/`)
- External CDN scripts via `include_cdn` front matter field (loaded after local JS)
- Syntax highlighting: Hugo's built-in Chroma (Monokai style)

### Blog Post Format

```yaml
---
title: "Post Title"
date: 2018-03-04T23:38:44+01:00
draft: false
slug: "url-slug"
categories: ["category1", "category2"]
keywords: ["keyword1", "keyword2"]
description: "Optional: Post description for SEO and summary"
---
```

**Optional front matter features:**

Audio player shortcode for text-to-speech versions:
```
{{<audio src="/audio/post-name.mp3" type="mp3">}}
```

Custom JavaScript (loaded from `assets/js/`):
```yaml
include_js: ["posts/2018-03-22-bloom-filters-bit-arrays-recommendations-caches-bitcoin/bloomfilters.js"]
```

External CDN scripts (loaded after local JS):
```yaml
include_cdn: ["https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"]
```

For MathJax, use both (config must load before the library):
```yaml
include_js: ["mathjax-config.js"]
include_cdn: ["https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"]
```

## Text-to-Speech Pipeline

Local Kokoro-82M narration lives in the `scripts/tts/` package, driven by the
`scripts/text_to_speech.py` CLI shim. The stages:
1. **`extract.py`** — markdown → narratable prose (reuses `sss_eval.markdown.to_prose`, then drops footnote-definition paragraphs and table markup).
2. **`lexicon.py`** — applies `scripts/tts_lexicon.yaml` pronunciation overrides (case-sensitive, whole-token, longest-match-first).
3. **`chunk.py`** — splits prose on sentence boundaries.
4. **`synth.py`** — synthesizes each chunk with Kokoro via `mlx-audio` (24 kHz).
5. **`stitch.py`** — concatenates segments and exports one MP3 with pydub/ffmpeg.
6. **`cli.py`** — click CLI: single-file and `--all` batch (backup + tqdm + per-post error isolation).

Tests are in `tests/tts/` (`uv run pytest tests/tts -m "not slow"`; the opt-in
`slow` marker runs a real Kokoro render). Dependencies are in `pyproject.toml`.
The design/plan are under `docs/superpowers/`.
