# Related posts — Design

## Goal

Add a "Related posts" block to the bottom of each post to strengthen internal
linking (crawl-graph / SEO recovery after the May 2026 de-indexing) and help
readers find adjacent content. Relatedness must be *genuine*, not tag/keyword
overlap. Suggestions are generated semantically but every related list is
**confirmed by a human** before it ships.

## Decisions (locked)

- **Hybrid mechanism**: a build-time script proposes candidates; the author
  confirms; confirmed slugs live in front matter. Nothing auto-writes.
- **Source of truth**: a `related:` list of slugs in each post's front matter.
  Absent/empty ⇒ no block renders. No `related_lock` field (there is no
  auto-writer to guard against — YAGNI).
- **Model**: `minishlab/potion-retrieval-32M` via `model2vec` (already a
  dependency). Build-time only. Deliberately **decoupled** from the browser
  search index model (`potion-base-8M`): that model was chosen to minimise the
  in-browser download, a constraint that does not apply to a local script.
- **Encoding**: each post is represented as the **mean of its chunk vectors**,
  not one embedding of the full text (static/mean-pooled embeddings dilute on
  long text). Reuse `sss_eval.chunk.chunk_post` with the same params the search
  index uses: `chunk_size=600`, `chunk_overlap=120`, `title_prefix=True`.
- **Scoring**: cosine similarity between post vectors. Suggest **top 3**, gated
  by a **0.35** threshold (starting value; tune against real scores during
  backfill). The script also prints the **max chunk-to-chunk cosine** per
  candidate as a secondary signal (surfaces shared subtopics), but ranking is by
  the doc-vector cosine.
- **Rendering**: `layouts/partials/related.html`, included in
  `single.html`. Renders nothing when the list is empty or a slug does not
  resolve.
- **Workflow**: a CLAUDE.md instruction tells the assistant to run the script,
  present the top candidates with scores, wait for confirmation, then write the
  confirmed slugs into front matter. Never auto-fill.

## Architecture

```
suggest_related.py  --(proposes ranked candidates + scores)-->  human confirms
        │                                                             │
        │ reuses sss_eval (load_corpus, chunk_post) + model2vec       ▼
        │                                              related: [slug,…] front matter
        ▼                                                             │
  prints only; never writes                                          ▼
                                              related.html (resolves slugs → pages, renders)
```

Data flow: **script proposes → human confirms → front matter (truth) → partial renders.**

## Components

### 1. Suggestion tool — `scripts/suggest_related.py`

- CLI: `uv run python scripts/suggest_related.py <slug>` for one post, or
  `--all` to print candidates for every post. Optional `--threshold` /
  `--top` overrides.
- Loads posts via `sss_eval.corpus.load_corpus(Path("content/post"))`.
- For each post: `chunk_post(...)` → `model.encode([chunk.text …])` →
  L2-normalize → mean → L2-normalize again = the post vector.
- Builds the 15×15 cosine matrix. For the target post, prints ranked candidates:
  `score  max_chunk_sim  slug  "title"`, filtered to `score ≥ threshold`,
  capped at `top`.
- **Prints only. Never edits front matter.** Pure authoring aid.
- Model is loaded once; `StaticModel.from_pretrained("minishlab/potion-retrieval-32M")`.

### 2. Partial — `layouts/partials/related.html`

- Reads `.Params.related` (list of slugs). Builds a slug→page lookup once from
  `.Site.RegularPages` keyed by each page's `.Params.slug` (fallback: `.File.ContentBaseName`).
- Renders a PaperMod-native block: an `<h3>Related posts</h3>` heading and a
  list of title links. Skips unresolved slugs; renders nothing if the resolved
  list is empty.

### 3. Template hook — `layouts/_default/single.html`

- Include `{{- partial "related.html" . -}}` after the post content / before the
  existing footer elements (e.g. the Buy Me a Coffee button), consistent with
  the current single template.

### 4. Docs — `CLAUDE.md`

- New "Related posts" section documenting the `related:` front-matter field, the
  `suggest_related.py` command, and the **suggest-then-confirm** workflow rule:
  run the script, present top 2–3 candidates with scores, wait for the user's
  confirmation, write confirmed slugs to `related:`, and if nothing clears the
  threshold say so and leave it empty.

## Backfill & data

- Run `suggest_related.py --all`, review candidates with the user, and populate
  `related:` for the existing 15 posts one at a time (user confirms each set) so
  the feature ships populated. This pass also calibrates the 0.35 threshold
  against real potion-retrieval-32M scores.

## Testing

- Unit: a `tests/` test for the ranking core (post-vector build + cosine
  ranking) over a tiny synthetic corpus — asserts a clearly-related pair ranks
  above an unrelated one and that the threshold filters. No network model load
  in the unit test (inject vectors).
- Render: `hugo` build succeeds; a post with `related:` shows the block, a post
  without shows nothing; unresolved slug is skipped silently.

## Out of scope

- Auto-writing `related:` without confirmation.
- Runtime / in-browser related computation (this is build/author-time only).
- Relating non-post pages (categories, about).
- Re-tuning or replacing the browser search index model.
