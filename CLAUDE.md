# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal blog built with Hugo (v0.147.8+extended), using the PaperMod theme. The blog includes custom client-side search functionality using Fuse.js and a text-to-speech generation script for blog posts. The site is deployed to GitHub Pages at bart.degoe.de.

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
Uses Google Cloud Text-to-Speech API to convert blog post markdown to MP3 and OGG audio files. Requires:
- Python dependencies in `requirements.txt`
- Google Cloud credentials configured
- Outputs to `static/audio/`

## Architecture

**Note on Migration:** This blog was migrated from hyde-x theme to PaperMod in October 2025. Some legacy files remain in the repository for reference (e.g., `assets/css/bart.degoe.de.css`, old search partials). The current implementation uses PaperMod's extension system (`extend_head.html`, `extend_footer.html`) and modern practices.

### Directory Structure

- **content/**: Blog content in markdown format
  - `content/post/`: Individual blog posts, named with date prefix (e.g., `2018-03-02-searching-your-hugo-site-with-lunr.md`)
  - `content/about.md`: About page

- **layouts/**: Custom Hugo templates that override the PaperMod theme
  - `layouts/index.html`: Homepage template with integrated search UI
  - `layouts/index.json`: JSON output format for search index (generates `/index.json`)
  - `layouts/partials/`: Template partials using PaperMod's extension system
    - `extend_head.html`: Extends theme's head section with OpenSearch integration and custom JS support
    - `extend_footer.html`: Extends theme's footer with Fuse.js search implementation (inline)
    - `footer.html`: Custom footer with "Buy Me a Coffee" widget
  - `layouts/_default/`: Default templates for pages
    - `single.html`: Custom single post template

- **assets/**: Source files processed by Hugo Pipes
  - `assets/css/extended/custom.css`: Custom CSS styles (PaperMod's extension system automatically loads this)
  - `assets/css/bart.degoe.de.css`: Legacy CSS file (kept for reference)
  - `assets/js/posts/`: Post-specific JavaScript files (e.g., bloom filter visualization)
  - Hugo concatenates, minifies, and fingerprints these assets as needed

- **static/**: Static files served directly (not processed)
  - `static/audio/`: Generated audio versions of blog posts (MP3 and OGG formats)
  - `static/img/`: Images used in blog posts
  - `static/pdf/`: Resume PDFs
  - `static/favicon.*`: Favicon files
  - `static/opensearch.xml`: OpenSearch descriptor for browser search integration

- **themes/**: Hugo themes
  - `themes/PaperMod/`: Current theme (git submodule)
  - `themes/hyde-x/`: Legacy theme (kept for reference)

- **public/**: Generated site output (separate git repository for GitHub Pages)

- **scripts/**: Utility scripts
  - `text_to_speech.py`: Converts markdown blog posts to audio using Google Cloud TTS

### Search Functionality

The blog implements client-side full-text search using Fuse.js (v7.1.0 via CDN):

1. **Index Generation**: `layouts/index.json` generates a JSON feed at `/index.json` containing all blog posts with title, categories, href, and content
2. **Search Engine**: `layouts/partials/extend_footer.html` contains inline JavaScript that loads Fuse.js from CDN and initializes search on the homepage
3. **Search Configuration** (Fuse.js options):
   - Case-insensitive fuzzy matching
   - Threshold: 0.4 (moderate fuzziness)
   - Minimum match length: 2 characters
   - Weighted fields: title (0.8), content (0.5), categories (0.3)
4. **UI Integration**:
   - Search box on homepage updates results dynamically on input
   - Shows top 10 results
   - ESC key clears search
   - Toggles between search results and full post list

### Hugo Configuration

- **config.yml**: Main configuration file (YAML format)
  - Base URL: https://bart.degoe.de
  - Theme: PaperMod with customizations
  - Multiple output formats: HTML, JSON (for search), and RSS
  - Google Analytics GA4 integrated (G-6JBRP5YVDB)
  - Social links: GitHub, LinkedIn, Twitter, RSS
  - Permalink structure: `/:slug/` (preserved from legacy site for URL compatibility)
  - PaperMod features enabled:
    - Reading time display
    - Share buttons
    - Breadcrumbs
    - Code copy buttons
    - Syntax highlighting (Monokai style)

### Asset Pipeline

Hugo Pipes and PaperMod's built-in asset handling:
- Custom CSS in `assets/css/extended/custom.css` is automatically loaded by PaperMod
- PaperMod's theme assets are processed, minified, and fingerprinted
- Post-specific JavaScript files can be included via `include_js` front matter field (see `extend_head.html`)
- Search functionality uses Fuse.js from CDN (no build step required)
- Syntax highlighting handled by Hugo's built-in Chroma highlighter

### Blog Post Format

Blog posts use Hugo front matter with the following structure:
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

**Optional Features:**

Posts may include an audio player shortcode for text-to-speech versions:
```
{{<audio src="/audio/post-name.mp3" type="mp3" backup_src="/audio/post-name.ogg" backup_type="ogg">}}
```

Posts can include custom JavaScript files via front matter:
```yaml
---
include_js: ["posts/2018-03-22-bloom-filters-bit-arrays-recommendations-caches-bitcoin/bloomfilters.js"]
---
```
These files are automatically loaded from the `assets/js/` directory.

## Text-to-Speech Script

The `scripts/text_to_speech.py` script:
1. Parses markdown blog post files
2. Strips Hugo front matter and code blocks
3. Converts markdown to HTML, then extracts plain text
4. Splits text into 5000-character chunks (API limit)
5. Calls Google Cloud Text-to-Speech API for each chunk
6. Stitches MP3 segments together using pydub
7. Exports final audio as both MP3 and OGG formats
8. Cleans up intermediate files

Dependencies are specified in `requirements.txt` (beautifulsoup4, markdown, pydub, google-cloud-texttospeech).
