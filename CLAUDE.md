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
- `--all` backs existing audio up to `backups/` (copy, never delete) before re-rendering.
- Outputs to `assets/audio/<markdown-stem>.mp3` (content-hashed into the page by Hugo's `fingerprint` so re-rendered audio busts caches).

## Architecture

**Important:** The `public/` directory is a **separate git repository** (not a submodule of this repo). It tracks the `master` branch of the GitHub Pages deployment repo. Do not treat it as part of the main repo's git history. The `deploy.sh` script handles committing and pushing within `public/` independently.

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

### Search Functionality

Client-side full-text search using Fuse.js (v7.1.0 via CDN):

1. `layouts/index.json` generates a JSON feed at `/index.json` with all posts
2. `layouts/partials/extend_footer.html` contains inline JS that initializes Fuse.js on the homepage
3. Fuse.js config: case-insensitive, threshold 0.4, weighted fields (title 0.8, content 0.5, categories 0.3)
4. Search box on homepage shows top 10 results dynamically, ESC clears

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
