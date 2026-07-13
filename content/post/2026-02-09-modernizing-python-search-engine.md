---
title: "Modernizing my 150-line Python search engine: Yahoo! dumps -> Hugging Face 🤗"
date: 2026-02-09T12:00:00-07:00
draft: false
slug: "modernizing-python-search-engine"
categories: ["how-to", "search", "python", "open-source"]
keywords: ["python", "search engine", "hugging face", "datasets", "uv", "modernization"]
description: A few years ago I wrote a full-text search engine in 150 lines of Python. The Wikipedia data source it relied on has since been discontinued, and the tooling around it was showing its age. I wanted to (finally) write a follow-up about semantic search, but I realized that I had to get the old repository in a working state first. It's now using Hugging Face (🤗) datasets, uv, ruff, pytest, and GitHub Actions, without touching the core search logic.
related:
  - building-a-full-text-search-engine-150-lines-of-code
  - building-a-semantic-search-engine-in-250-lines-of-python
  - semantic-search-in-your-browser
---

A few years ago I wrote a [full-text search engine in 150 lines of Python](/building-a-full-text-search-engine-150-lines-of-code/). The Wikipedia data source it relied on has since been discontinued, and the tooling around it was showing its age. I wanted to (finally) write a follow-up about semantic search, but I realized that I had to get the old repository in a working state first. It's now using Hugging Face (🤗) datasets, uv, ruff, pytest, and GitHub Actions, without touching the core search logic.<!-- more -->

{{<audio src="/audio/2026-02-09-modernizing-python-search-engine.mp3" type="mp3" backup_src="/audio/2026-02-09-modernizing-python-search-engine.ogg" backup_type="ogg">}}

# The problem

The original project downloaded Wikipedia abstracts from an XML dump hosted at `dumps.wikimedia.org`. This was a convenient ±800mb gzipped XML file containing about 6.3 million article titles, URLs, and abstracts. The code used `lxml` to stream-parse the XML and `requests` to download it.

Turns out these dumps were specifically made for Yahoo!, so at some point, Wikimedia [proposed sunsetting](https://www.mail-archive.com/wikitech-l@lists.wikimedia.org/msg96480.html) these abstract dumps. They required them maintaining a dedicated MediaWiki extension called `ActiveAbstract`, and the same data could be extracted from the main article dumps. Fair enough, but that means the convenient data dump for this little project's data pipeline is now busted.

# Hugging Face datasets

Thankfully, Wikimedia publishes[^wikimedia_donate] a [Wikipedia dataset on Hugging Face](https://huggingface.co/datasets/wikimedia/wikipedia) that contains all English Wikipedia articles with their titles, URLs, and full text. The `20231101.en` config has 6.4 million articles, roughly the same size as the old abstract dump, and has 2.5 years _more_ articles.

The Hugging Face `datasets` library handles downloading, caching, and efficient iteration out of the box. That means I delete both my questionable code in `download.py` (the HTTP download logic) and the XML parsing in `load.py` with essentially one function call.

Here's what the old manual `load.py` looked like:

```python
import gzip
from lxml import etree

from search.documents import Abstract

def load_documents():
    with gzip.open('data/enwiki-latest-abstract.xml.gz', 'rb') as f:
        doc_id = 0
        for _, element in etree.iterparse(f, events=('end',), tag='doc'):
            title = element.findtext('./title')
            url = element.findtext('./url')
            abstract = element.findtext('./abstract')

            yield Abstract(ID=doc_id, title=title, url=url, abstract=abstract)

            doc_id += 1
            element.clear()
```

And here's the new version:

```python
from datasets import load_dataset
from tqdm import tqdm

from search.documents import Abstract

DATASET = "wikimedia/wikipedia"
DATASET_CONFIG = "20231101.en"

def load_documents():
    ds = load_dataset(DATASET, DATASET_CONFIG, split="train")  # this library is used for ML training
    for doc_id, row in enumerate(tqdm(ds, desc="Loading documents")):
        title = row["title"]
        url = row["url"]
        # extract first paragraph as abstract
        text = row["text"]
        abstract = text.split("\n\n")[0] if text else ""

        yield Abstract(ID=doc_id, title=title, url=url, abstract=abstract)
```

The major difference is that the HF dataset contains the full article text, not just the abstract. So we extract the first paragraph with a simple `split("\n\n")[0]`. The rest of the code (the `Abstract` dataclass, the inverted index, the analysis pipeline, the TF-IDF ranking) remains completely unchanged. The `load_documents()` function still yields the same `Abstract` objects.

The `datasets` library also handles caching to `~/.cache/huggingface/`, so the ±20GB download only happens once. That replaces the old `download.py` that did HTTP chunked downloads with progress tracking, and the library gives us progress bars for free (and free is my favorite price).

{{< figure src="/img/2026-02-09-modernizing-python-search-engine/loading-documents.jpg" title="Loading progress bars!" >}}

# While we're at it: modern Python tooling

Since we're here, I figured I'd drag the rest of the project into 2026 too. The original setup was the classic `requirements.txt` with pinned dependencies and not much else. No tests, no linting, no CI. And GitHub Actions are also free.

## pyproject.toml and uv

I replaced `requirements.txt` with a `pyproject.toml` and switched to [uv](https://docs.astral.sh/uv/) for dependency management:

```toml
[project]
name = "python-searchengine"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "datasets",
    "PyStemmer",
]

[dependency-groups]
dev = [
    "pytest",
    "ruff",
]
```

The dependencies went from three (`lxml`, `PyStemmer`, `requests`) to two (`datasets`, `PyStemmer`). The `datasets` library brings in its own HTTP and caching machinery, so we don't need `requests` or `lxml` anymore.

## ruff

I added [ruff](https://docs.astral.sh/ruff/) for linting with a minimal set of rules (pyflakes, pycodestyle, import sorting). Running it immediately caught a forgotten `import requests` in `run.py` and some unsorted imports. It also surfaced a subtle bug in the original `index.py`:

```python
# before (bug: second `if` always evaluates, even after AND branch)
if search_type == 'AND':
    documents = [self.documents[doc_id] for doc_id in set.intersection(*results)]
if search_type == 'OR':
    documents = [self.documents[doc_id] for doc_id in set.union(*results)]

# after
if search_type == 'AND':
    documents = [self.documents[doc_id] for doc_id in set.intersection(*results)]
elif search_type == 'OR':
    documents = [self.documents[doc_id] for doc_id in set.union(*results)]
```

That second `if` should have been an `elif`. It doesn't _really_ matter because the early return for invalid search types meant the code paths were mutually exclusive, but wasteful and correctness and I just wanted a happy linter.

## Tests

I added pytest with tests for the core search logic, which is basically the analysis pipeline (tokenization, filtering, stemming), the `Abstract` dataclass, and the `Index` class (indexing, AND/OR search, ranked results). All tests use tiny in-memory data, so they run in about 30ms and **don't** require downloading Wikipedia:

```bash
$ uv run pytest -v
tests/test_analysis.py::test_tokenize PASSED
tests/test_analysis.py::test_lowercase_filter PASSED
tests/test_analysis.py::test_punctuation_filter PASSED
tests/test_analysis.py::test_stopword_filter PASSED
tests/test_analysis.py::test_stem_filter PASSED
tests/test_analysis.py::test_analyze_full_pipeline PASSED
tests/test_analysis.py::test_analyze_filters_empty_tokens PASSED
tests/test_index.py::TestAbstract::test_fulltext PASSED
tests/test_index.py::TestAbstract::test_term_frequency PASSED
tests/test_index.py::TestIndex::test_index_document PASSED
tests/test_index.py::TestIndex::test_index_document_no_duplicate PASSED
tests/test_index.py::TestIndex::test_document_frequency PASSED
tests/test_index.py::TestIndex::test_search_and PASSED
tests/test_index.py::TestIndex::test_search_or PASSED
tests/test_index.py::TestIndex::test_search_invalid_type PASSED
tests/test_index.py::TestIndex::test_search_ranked PASSED
tests/test_index.py::TestIndex::test_search_ranked_ordering PASSED

17 passed in 0.03s
```

## GitHub Actions

Finally, a CI workflow that runs lint and tests across Python 3.10 through 3.13:

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync
      - run: uv run ruff check .

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: uv sync
      - run: uv run pytest -v
```

# What stayed the same

The nice thing about all of this is that the core search engine (the inverted index, the analysis pipeline, the TF-IDF scoring) didn't change at all. The `Abstract` dataclass, the `Index` class, the tokenizer, the stemmer, the stopword filter are also all identical to the original post. No rewriting old blog posts! This is entirely about the plumbing around it: how the data gets in, how dependencies are managed, and how correctness is verified.

If you want to try it yourself, the updated code is on [GitHub](https://github.com/bartdegoede/python-searchengine/):

```bash
uv sync
uv run python run.py
```

The first run will download the Wikipedia dataset from Hugging Face (±20GB, cached after that). If you want faster downloads, you can set a [Hugging Face token](https://huggingface.co/settings/tokens):

```bash
export HF_TOKEN=hf_...
```

Also do note that it wants to load a lot of data, and that takes a long time, especially if your laptop isn't as well-endowed in the RAM department 😅

[^wikimedia_donate]: Wikipedia is _awesome_, and you should [donate](https://donate.wikimedia.org/w/index.php) to them. Go do it now.
