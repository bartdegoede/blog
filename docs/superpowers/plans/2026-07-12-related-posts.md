# Related Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a human-confirmed, semantically-suggested "Related posts" block to each post to strengthen internal linking after the May 2026 de-indexing.

**Architecture:** A build-time Python script (`scripts/suggest_related.py`) embeds each post as the mean of its chunk vectors (reusing `sss_eval` + `potion-retrieval-32M`) and prints ranked candidates. A human confirms; confirmed slugs go into each post's `related:` front matter. A Hugo partial renders the block from front matter only.

**Tech Stack:** Python (numpy, model2vec, sss_eval), pytest, Hugo (Go templates).

---

### Task 1: Pure ranking core + tests

Pure, model-free functions so ranking is unit-testable by injecting vectors.

**Files:**
- Create: `scripts/suggest_related.py`
- Test: `tests/test_suggest_related.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_suggest_related.py
import numpy as np

from suggest_related import doc_vector, max_chunk_sim, rank_related


def test_doc_vector_is_unit_length_mean():
    mat = np.array([[3.0, 0.0], [0.0, 4.0]], dtype=np.float32)  # -> unit rows [1,0],[0,1]
    v = doc_vector(mat)
    assert np.allclose(np.linalg.norm(v), 1.0, atol=1e-6)
    assert np.allclose(v, [0.7071, 0.7071], atol=1e-3)


def test_max_chunk_sim_takes_best_pair():
    a = np.array([[1.0, 0.0]], dtype=np.float32)
    b = np.array([[0.0, 1.0], [0.8, 0.6]], dtype=np.float32)
    assert np.isclose(max_chunk_sim(a, b), 0.8, atol=1e-6)


def test_rank_related_orders_and_thresholds():
    single = lambda v: np.array([v], dtype=np.float32)
    chunk_mats = {
        "a": single([1.0, 0.0, 0.0]),
        "b": single([0.9, 0.1, 0.0]),   # close to a
        "c": single([0.0, 0.0, 1.0]),   # orthogonal to a
    }
    doc_vecs = {k: doc_vector(m) for k, m in chunk_mats.items()}
    hits = rank_related(doc_vecs, chunk_mats, "a", top=3, threshold=0.5)
    assert [h[0] for h in hits] == ["b"]        # c filtered by threshold
    assert hits[0][1] > 0.98                     # cosine(a,b)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_suggest_related.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'suggest_related'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/suggest_related.py
"""Suggest genuinely-related posts via semantic similarity (authoring aid).

Prints ranked candidates for a post; never edits front matter. A human confirms
suggestions before they go into a post's `related:` list. See
docs/superpowers/specs/2026-07-12-related-posts-design.md.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

CORPUS = Path("content/post")
MODEL = "minishlab/potion-retrieval-32M"
# Match the search index chunker so "related" sees posts the way search does.
CHUNK_SIZE = 600
CHUNK_OVERLAP = 120
DEFAULT_TOP = 3
DEFAULT_THRESHOLD = 0.35


def _l2(mat: np.ndarray) -> np.ndarray:
    """Row-wise (or vector) L2 normalize; zero rows stay zero."""
    mat = np.asarray(mat, dtype=np.float32)
    if mat.ndim == 1:
        norm = np.linalg.norm(mat)
        return mat / norm if norm else mat
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    return np.divide(mat, norms, out=np.zeros_like(mat), where=norms > 0)


def doc_vector(chunk_matrix: np.ndarray) -> np.ndarray:
    """Post vector = L2-normalized mean of L2-normalized chunk vectors."""
    unit = _l2(chunk_matrix)
    return _l2(unit.mean(axis=0))


def max_chunk_sim(a_chunks: np.ndarray, b_chunks: np.ndarray) -> float:
    """Largest cosine between any chunk of A and any chunk of B."""
    return float((_l2(a_chunks) @ _l2(b_chunks).T).max())


def rank_related(
    doc_vecs: dict[str, np.ndarray],
    chunk_mats: dict[str, np.ndarray],
    target: str,
    *,
    top: int = DEFAULT_TOP,
    threshold: float = DEFAULT_THRESHOLD,
) -> list[tuple[str, float, float]]:
    """[(slug, cosine, max_chunk_sim)] for the best `top` peers of `target`
    whose cosine >= threshold, best first. doc_vecs are already unit vectors."""
    tv = doc_vecs[target]
    scored: list[tuple[str, float, float]] = []
    for slug, vec in doc_vecs.items():
        if slug == target:
            continue
        cos = float(tv @ vec)
        if cos >= threshold:
            scored.append((slug, cos, max_chunk_sim(chunk_mats[target], chunk_mats[slug])))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:top]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_suggest_related.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/suggest_related.py tests/test_suggest_related.py
git commit -m "Add related-posts ranking core"
```

---

### Task 2: Model-backed embedding + CLI

Wire the pure core to `sss_eval` + `model2vec` and expose a print-only CLI.

**Files:**
- Modify: `scripts/suggest_related.py` (append embedding + CLI below the core)

- [ ] **Step 1: Append embedding + CLI code**

```python
def build_vectors(corpus: Path = CORPUS, model_id: str = MODEL):
    """Return (doc_vecs, chunk_mats, titles) keyed by slug. Loads the model."""
    from model2vec import StaticModel
    from sss_eval.chunk import chunk_post
    from sss_eval.corpus import load_corpus

    model = StaticModel.from_pretrained(model_id)
    doc_vecs: dict[str, np.ndarray] = {}
    chunk_mats: dict[str, np.ndarray] = {}
    titles: dict[str, str] = {}
    for post in load_corpus(corpus):
        chunks = chunk_post(
            post, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP, title_prefix=True
        )
        if not chunks:
            continue
        mat = np.asarray(model.encode([c.text for c in chunks]), dtype=np.float32)
        chunk_mats[post.slug] = mat
        doc_vecs[post.slug] = doc_vector(mat)
        titles[post.slug] = post.title
    return doc_vecs, chunk_mats, titles


def _print_for(target, doc_vecs, chunk_mats, titles, top, threshold):
    print(f"\n{target}  — {titles.get(target, '')}")
    hits = rank_related(doc_vecs, chunk_mats, target, top=top, threshold=threshold)
    if not hits:
        print("  (no candidates above threshold)")
    for slug, cos, mcs in hits:
        print(f"  {cos:.3f}  (max-chunk {mcs:.3f})  {slug}  — {titles.get(slug, '')}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Suggest related posts (prints only).")
    ap.add_argument("slug", nargs="?", help="post slug; omit when using --all")
    ap.add_argument("--all", action="store_true", help="print for every post")
    ap.add_argument("--top", type=int, default=DEFAULT_TOP)
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    ap.add_argument("--corpus", type=Path, default=CORPUS)
    a = ap.parse_args()

    doc_vecs, chunk_mats, titles = build_vectors(a.corpus)
    if a.all:
        for slug in sorted(doc_vecs):
            _print_for(slug, doc_vecs, chunk_mats, titles, a.top, a.threshold)
    elif a.slug:
        if a.slug not in doc_vecs:
            raise SystemExit(
                f"unknown slug: {a.slug}\nknown: {', '.join(sorted(doc_vecs))}"
            )
        _print_for(a.slug, doc_vecs, chunk_mats, titles, a.top, a.threshold)
    else:
        ap.error("provide a slug or --all")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test the CLI (manual; loads the model)**

Run: `uv run python scripts/suggest_related.py --all --threshold 0`
Expected: prints every slug with up to 3 ranked candidates and cosine/max-chunk scores. No tracebacks.

- [ ] **Step 3: Verify tests still pass**

Run: `uv run pytest tests/test_suggest_related.py -v`
Expected: PASS (3 passed)

- [ ] **Step 4: Commit**

```bash
git add scripts/suggest_related.py
git commit -m "Add related-posts embedding and CLI"
```

---

### Task 3: Hugo partial + template hook

Render the block from front matter only; skip unresolved/empty.

**Files:**
- Create: `layouts/partials/related.html`
- Modify: `layouts/_default/single.html` (after the post-content block)
- Modify: `assets/css/extended/custom.css` (append spacing)

- [ ] **Step 1: Create the partial**

```html
{{- /* Related posts: resolves front-matter `related:` slugs to pages.
       Renders nothing when the list is empty or no slug resolves. */ -}}
{{- $related := .Params.related }}
{{- if $related }}
{{- $pages := slice }}
{{- range $slug := $related }}
  {{- with where site.RegularPages "Params.slug" $slug }}
  {{- $pages = $pages | append (index . 0) }}
  {{- end }}
{{- end }}
{{- with $pages }}
<div class="post-related">
  <h3>Related posts</h3>
  <ul>
    {{- range . }}
    <li><a href="{{ .Permalink }}">{{ .Title }}</a></li>
    {{- end }}
  </ul>
</div>
{{- end }}
{{- end }}
```

- [ ] **Step 2: Hook it into single.html**

In `layouts/_default/single.html`, immediately after the post-content block that ends with `{{- end }}` (the `{{- if .Content }} ... {{- end }}`), and before the `{{- /* Buy Me a Coffee button before post footer */ -}}` comment, insert:

```html
  {{- partial "related.html" . }}
```

- [ ] **Step 3: Add minimal styling**

Append to `assets/css/extended/custom.css`:

```css
.post-related { margin-top: 2rem; }
.post-related h3 { margin-bottom: 0.5rem; }
.post-related ul { margin: 0; padding-left: 1.2rem; }
```

- [ ] **Step 4: Verify render with a temporary related list**

Add `related:\n  - building-a-full-text-search-engine-150-lines-of-code` to one post's front matter temporarily, then:

Run: `hugo --quiet && rg -l "post-related" public/ | head`
Expected: the block appears in that post's built HTML. Then remove the temporary front-matter edit (real values come in Task 5).

- [ ] **Step 5: Commit**

```bash
git add layouts/partials/related.html layouts/_default/single.html assets/css/extended/custom.css
git commit -m "Render related-posts block from front matter"
```

---

### Task 4: Document the workflow in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (add a "Related posts" subsection under Architecture)

- [ ] **Step 1: Add the section**

Insert after the "Search Functionality" section:

```markdown
### Related Posts

Each post can carry a `related:` front-matter list of post slugs, rendered as a
"Related posts" block by `layouts/partials/related.html` (included in
`single.html`). The list is the single source of truth; an absent/empty list
renders nothing.

Suggestions are generated by `scripts/suggest_related.py`, which embeds each
post as the mean of its chunk vectors (`sss_eval` chunker + the
`potion-retrieval-32M` model2vec model) and prints ranked cosine candidates:

    uv run python scripts/suggest_related.py <slug>     # one post
    uv run python scripts/suggest_related.py --all       # whole catalogue

**Workflow (suggest, then confirm):** when adding or editing a post, run the
script, present the top 2-3 candidates (with scores) to the user, and wait for
confirmation before writing the confirmed slugs into that post's `related:`
front matter. Never auto-fill `related:`. If nothing clears the threshold, say
so and leave it empty. The script only prints — it never edits front matter.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document related-posts workflow"
```

---

### Task 5: Backfill the existing posts (interactive)

Populate `related:` for the current posts. Confirmations happen live with the user; this task is not fully automated.

**Files:**
- Modify: `content/post/*.md` (front matter only)

- [ ] **Step 1: Generate candidates**

Run: `uv run python scripts/suggest_related.py --all`
Review scores; note where 0.35 looks too loose/tight and adjust `--threshold` if the user agrees.

- [ ] **Step 2: Confirm and write, post by post**

For each post, present the top 2-3 candidates to the user. On confirmation, add to that post's front matter:

```yaml
related:
  - <confirmed-slug-1>
  - <confirmed-slug-2>
```

Leave `related:` absent for any post with no confirmed matches.

- [ ] **Step 3: Build and verify**

Run: `hugo --quiet && uv run pytest tests/test_suggest_related.py -v`
Expected: clean build; tests pass. Spot-check a couple of posts show the block.

- [ ] **Step 4: Commit**

```bash
git add content/post
git commit -m "Backfill related posts for existing catalogue"
```

---

## Out of scope

- Auto-writing `related:` without confirmation.
- Runtime / in-browser related computation.
- Relating non-post pages; re-tuning the browser search model.
