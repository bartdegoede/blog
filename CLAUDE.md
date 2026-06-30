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
python scripts/text_to_speech.py content/post/[filename].md
```
Uses Google Cloud Text-to-Speech API to convert blog post markdown to an MP3 audio file. Requires:
- Python dependencies in `requirements.txt`
- Google Cloud credentials configured
- Outputs to `static/audio/`

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

## Text-to-Speech Script

The `scripts/text_to_speech.py` script:
1. Parses markdown blog post files
2. Strips Hugo front matter and code blocks
3. Converts markdown to HTML, then extracts plain text
4. Splits text into 5000-character chunks (API limit)
5. Calls Google Cloud Text-to-Speech API for each chunk
6. Stitches MP3 segments together using pydub
7. Exports final audio as MP3
8. Cleans up intermediate files

Dependencies are specified in `requirements.txt` (beautifulsoup4, markdown, pydub, google-cloud-texttospeech).
