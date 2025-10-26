# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal blog built with Hugo (v0.147.8+extended), using the hyde-x theme. The blog includes custom client-side search functionality using Lunr.js and a text-to-speech generation script for blog posts. The site is deployed to GitHub Pages at bart.degoe.de.

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
Builds the site, commits the output in the `public/` folder, and pushes to GitHub Pages. The `public/` directory is a separate git repository.

### Generate audio versions of blog posts
```bash
python scripts/text_to_speech.py content/post/[filename].md
```
Uses Google Cloud Text-to-Speech API to convert blog post markdown to MP3 and OGG audio files. Requires:
- Python dependencies in `requirements.txt`
- Google Cloud credentials configured
- Outputs to `static/audio/`

## Architecture

### Directory Structure

- **content/**: Blog content in markdown format
  - `content/post/`: Individual blog posts, named with date prefix (e.g., `2018-03-02-searching-your-hugo-site-with-lunr.md`)
  - `content/about.md`: About page

- **layouts/**: Custom Hugo templates that override the theme
  - `layouts/index.html`: Homepage template
  - `layouts/index.json`: JSON output format for search index (generates `/index.json`)
  - `layouts/partials/`: Template partials
    - `head.html`: Custom head section with asset pipeline for CSS
    - `search.html`: Search UI component
    - `search_scripts.html`: Loads Lunr.js and search functionality
  - `layouts/_default/`: Default templates for pages

- **assets/**: Source files processed by Hugo Pipes
  - `assets/css/bart.degoe.de.css`: Custom CSS styles
  - `assets/js/search/search.js`: Client-side search implementation using Lunr.js
  - `assets/js/vendor/lunr.min.js`: Lunr.js library for search
  - Hugo concatenates, minifies, and fingerprints these assets

- **static/**: Static files served directly (not processed)
  - `static/audio/`: Generated audio versions of blog posts

- **themes/hyde-x/**: Base theme (with a backup in themes/hyde-x.bak/)

- **public/**: Generated site output (separate git repository for GitHub Pages)

- **scripts/**: Utility scripts
  - `text_to_speech.py`: Converts markdown blog posts to audio using Google Cloud TTS

### Search Functionality

The blog implements client-side full-text search using Lunr.js:

1. **Index Generation**: `layouts/index.json` generates a JSON feed at `/index.json` containing all blog posts with title, categories, href, and content
2. **Search Engine**: `assets/js/search/search.js` loads the JSON index and creates a Lunr search index with fields: title, categories, and content
3. **Search Strategy**:
   - Exact matches get highest boost (100x)
   - Prefix matches get medium boost (10x)
   - Results are limited to top 10
4. **UI Integration**: Search box updates results dynamically on keyup

### Hugo Configuration

- **config.toml**: Main configuration file
  - Base URL: bart.degoe.de
  - Theme: hyde-x with customizations
  - Multiple output formats: HTML, JSON (for search), and RSS
  - Google Analytics integrated (G-6JBRP5YVDB)
  - Social links: GitHub, LinkedIn, Twitter
  - Permalink structure: `/:slug/`

### Asset Pipeline

Hugo Pipes are used extensively for asset processing:
- CSS files are concatenated, minified, and fingerprinted for cache-busting
- JavaScript files (Lunr.js + search.js) are bundled, minified, and fingerprinted
- Subresource Integrity (SRI) hashes are generated automatically

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
---
```

Posts may include an audio player shortcode for text-to-speech versions:
```
{{<audio src="/audio/post-name.mp3" type="mp3" backup_src="/audio/post-name.ogg" backup_type="ogg">}}
```

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
