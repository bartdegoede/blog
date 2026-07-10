# Browser-side semantic search for a Hugo blog

**Status:** approved design, ready for implementation planning
**Date:** 2026-07-08

## Problem

The blog has client-side keyword search (Fuse.js over `/index.json`). It cannot find a
post by meaning: searching "find text by what it means rather than which words it uses"
returns nothing, even though [Building a semantic search engine in ±250 lines of
Python](/building-a-semantic-search-engine-in-250-lines-of-python/) is exactly that post.

We want semantic search on a fully static site: no server, no API keys, no inference
endpoint. Embeddings are computed on a laptop at build time and shipped as static files.
The browser embeds the query and ranks locally.

The deliverables are a working search box **and** a blog post about building it. Both
matter; the design is shaped by the need for the post to have honest, reproducible
numbers.

## Background research

[ternlight](https://github.com/soycaporal/ternlight) prompted this. It distills
`all-MiniLM-L6-v2` with BitNet-style ternary weights (every weight is -1, 0, or +1) into
a 5–7 MB WASM bundle containing model, tokenizer, and engine. It reports 0.844 Spearman
against its teacher.

**Verified 2026-07-09.** It is a monorepo; the npm packages are `@ternlight/base` and
`@ternlight/mini`, both 0.1.0, both with a Node export condition and a synchronous
`embed(text) → Float32Array`. `engineInfo()` reports:

```
tern-engine v1 | embedding_format=int4 | vocab=30522 d_model=384 n_layers=2 ... max_seq_len=128
```

Two corrections to what this document originally assumed. **`@ternlight/mini` outputs 384
dimensions, not 256** — 256 is its internal `d_model`, not its `output_dim`. And its vocabulary
is 30,522 (`bert-base-uncased`), not potion's 29,528, so the two tokenize differently.

**`max_seq_len=128` is the finding that matters.** Ternlight silently truncates input at 128
WordPiece tokens. Our 1000-character chunks have a median of **204** tokens, p90 255, max 323.
So **73.2% of chunks exceed the cap**, and ternlight sees a mean of **72%** of each chunk's
tokens. MiniLM's tokenizer reports `model_max_length = 512` and truncates **0 of 179** chunks.

Proven empirically, not inferred from the docs: appending 200 filler words to an 82-token chunk
drops its cosine to **0.2168** (the tail was read), while appending the same filler to a
243-token chunk gives cosine **1.000000** (the tail was never reached).

This makes the chunk-size sweep sharper rather than useless: at 600 characters (~122 tokens)
ternlight sees nearly the whole chunk, at 1500 it sees about a third. The arm should therefore
*prefer* small chunks, and the sweep will show it.

Following that thread led to [model2vec / potion](https://github.com/MinishLab/model2vec),
which is more interesting. A model2vec "model" is a lookup table. Its entire forward pass,
from `model2vec/model.py::_encode_batch`, is:

```python
ids = self.tokenize(sentences)          # WordPiece, add_special_tokens=False
emb = self.embedding[ids]               # gather one row per token
out = emb.mean(axis=0)                  # mean-pool
out = out / (norm(out) + 1e-32)         # L2 normalize
```

No neural network. No ONNX. No WASM. `potion-retrieval-32M` reaches
[81.7% of MiniLM's MTEB retrieval score](https://huggingface.co/minishlab/potion-retrieval-32M)
this way.

Tensor shapes, read directly off the HuggingFace safetensors headers rather than trusted
from model cards:

| Model | Vocab × dims | Raw f32 | int8, full vocab |
|---|---|---|---|
| `potion-retrieval-32M` | 63,091 × 512 | 129 MB | ~32 MB |
| `potion-base-8M` | 29,528 × 256 | 30 MB | ~7.6 MB |
| `potion-base-2M` | 29,528 × 64 | 7.6 MB | ~1.9 MB |

Each has exactly one tensor, named `embeddings`. All three use a WordPiece tokenizer with
a `BertNormalizer`. Both potion configs set `apply_pca`, so dimensions are PCA components
ordered by explained variance — truncating `potion-base-8M` to its first 128 dims is
principled, not a hack.

### Corpus size

13 posts, 122,862 characters of prose after stripping front matter and fenced code.
At 1000-char chunks with 200 overlap that is ~155 chunks.

| Chunking | Chunks | int8 index @256d |
|---|---|---|
| 600 / 120 | 260 | 65 KB |
| 1000 / 200 | 155 | 39 KB |
| 1500 / 300 | 105 | 26 KB |

**The document index is a rounding error.** The query-side token table is 50×–800× larger
than the index it searches. Chunk size is therefore a quality knob, not a size constraint.

## Key insights

1. **Embedding at build time is the easy half.** The visitor still has to embed the query,
   and the query-side model dominates every byte budget.

2. **Chunk size is a model hyperparameter when the model is a mean.** A static embedding
   averages its token vectors, so a 17,209-character post collapses toward the
   common-word centroid of English and loses discriminative power. Whole-post vectors are
   expected to fail, and are retained as a benchmark baseline to demonstrate this.

3. **Vocabulary pruning is a trap.** Restricting the token table to words appearing in the
   corpus would shrink it enormously and destroy the point: semantic search works because
   "automobile" and "car" sit near each other in the matrix. Prune "automobile" and you
   have rebuilt keyword search with extra steps. Rejected.

4. **Row magnitude is the stopword weighting.** model2vec mean-pools *unnormalized* token
   vectors and normalizes only the result. Zipf/SIF weighting is baked into each row's
   magnitude — that is how the model downweights "the" without a stopword list.

   **Measured, 2026-07-09.** The mechanism is real. Sorting `potion-base-8M`'s 29,528 rows by
   L2 norm, the smallest are `a`, `.`, `,`, `-`, `)`, `the`, `to`, `and`, `of`, `in`; the
   largest are `turkmenistan`, `seychelles`, `guantanamo`, `hemingway`, `vanuatu`. Identical
   ordering in `potion-base-2M`. You can read the model's stopword list off the matrix.

   **But the practical consequence is much smaller than expected, and the spec used to
   overclaim it.** Quantizing the real table with a single *global* scale zeroes exactly two
   rows — `.` and `a` — and the aggregate query-vector cosine against fp32 is still 0.9998.
   Row norms span only ~1.5× from median to max; the spread lives in a short left tail of
   ~20 rows, and those are precisely the tokens the model already decided contribute nothing.
   A global scale is, in effect, an implicit stopword list.

   We still use a **per-row scale**: it costs 118 KB on a 7.5 MB table (1.54%), makes the
   low-norm tail exact, and removes a class of reasoning we would otherwise have to redo for
   every new model. But it is cheap insurance, not the load-bearing correctness property this
   document originally claimed. The blog post should say so.

5. **Semantic search will lose to keyword search on this corpus, for some queries.** A blog
   search box receives many single proper nouns: `pydub`, `lunr`, `mmh3`, `hnsw`. These
   are not in the 29,528-token vocabulary, so WordPiece shatters them into meaningless
   subword fragments and there is no attention layer to reassemble them.

   **The original claim — "Fuse.js finds them instantly" — was false, and finding out why
   fixed a live bug. Measured 2026-07-09.** The blog's Fuse config set `location: 0,
   distance: 1000` with no `ignoreLocation`. Fuse's location-aware scoring only rewards
   matches near the *start* of a field, and `pydub` first appears at character 3,712 of the
   TTS post's 14,803-character body. So the shipped search box returned **zero results** for
   `pydub`, `mmh3`, and `hnsw` — words that are in the posts. `lunr` and `opensearch` worked
   only because they also appear in a *title*, where `location: 0` is satisfied.

   Fixed in `layouts/partials/extend_footer.html` with `ignoreLocation: true` and
   `threshold: 0.2` (0.4 with `ignoreLocation` makes `pydub` fuzzy-match 10 of 13 posts).
   After the fix: `pydub` → the TTS post, `mmh3` → the bloom filter post, and the conceptual
   query "find documents by what they mean" still returns nothing.

   **The eval's keyword arm uses the corrected config.** Benchmarking semantic search against
   a keyword baseline that cannot find literal words in body text would be beating a strawman,
   and the resulting chart would be dishonest. The as-shipped bug is a footnote in the post,
   not a measured arm.

   Replacing keyword search would still be a visible regression — but only now that keyword
   search actually works.

## Architecture

### Two repositories

The pipeline and the eval are **not blog code**. They live in
`github.com/bartdegoede/static-site-search-eval` and are published to PyPI as
`static-site-search-eval` (importing as `sss_eval`). The corpus directory and the query
set are CLI arguments, so the tool runs against any static site, not just this one.

The blog depends on a **pinned exact version** and keeps a thin
`scripts/build_search_index.py` that calls into it.

This exists to close a specific hole. The eval concludes something like "chunk size 1000
with title prefixes and `potion-base-8M` wins." That conclusion only describes the blog if
the blog chunks text *identically*. Two copies of `chunk.py` that drift by one
sentence-boundary rule would make the eval a measurement of a system nobody runs, and
nothing would ever report the discrepancy.

So: one source of truth, pinned. `manifest.json` records `sss_eval_version`, which makes a
mismatch between the artifacts and the installed package **detectable** rather than silent.

```
static-site-search-eval/          blog/
  src/sss_eval/                     scripts/build_search_index.py   -> imports sss_eval
    markdown.py  chunk.py           static/search/                  -> live artifacts
    anchors.py   quantize.py        static/search-benchmark/        -> frozen artifacts
    rank.py      metrics.py         assets/js/semantic/             -> browser runtime
    artifacts.py evaluate.py
  node/                             pyproject.toml:
    build_minilm.mjs                  static-site-search-eval==0.1.0
    build_ternlight.mjs
    rank_fuse.mjs
  examples/degoe-de/queries.yaml
```

The blog post links to the repo, and its closing section — "run this on your own site" — is
then a true statement rather than an aspiration.

### Two artifact sets, different lifecycles

**`static/search/` — live.** The winning arm only. Regenerated whenever a post is added or
edited.

```
static/search/
  manifest.json        # model id, dims, chunker params, sss_eval_version, artifact hashes
  chunks.<hash>.json   # per-chunk metadata, parallel to docs.bin row order
  docs.<hash>.bin      # int8 chunk vectors, ~39 KB
  tokens.<hash>.bin    # int8 token table
  scales.<hash>.bin    # fp32 per-row scales
  vocab.<hash>.txt     # 29,528 lines
```

`chunks.json` holds one record per row of `docs.bin`, in the same order:

```json
{ "post": "searching-your-hugo-site-with-lunr",
  "title": "Searching your Hugo site with Lunr",
  "href": "/searching-your-hugo-site-with-lunr/",
  "text": "...chunk prose, used as the result snippet...",
  "heading": "Generating the index at build time",
  "anchor": "generating-the-index-at-build-time" }
```

Binaries carry a content hash in the filename; `manifest.json` points at them, so
cache-busting is free. Raw `ArrayBuffer`s, never base64 (which costs +33%).

**`static/search-benchmark/` — frozen.** Three arms' vectors over the corpus as it stood on
publication day. Generated once, committed, never regenerated. The widget states its
corpus snapshot date so it does not quietly rot into a lie as new posts are written.

```
static/search-benchmark/{minilm,ternlight,potion}/
```

Committing a multi-megabyte `tokens.bin` to git is accepted. It changes only when the
model changes.

### Build pipeline

Python under `uv`, in the `static-site-search-eval` repo. The chunker reads markdown source
directly rather than Hugo's `.Plain`, as `scripts/text_to_speech.py` does.

| Module | Responsibility |
|---|---|
| `markdown.py` | Strip front matter, fenced code, Hugo shortcodes, raw HTML. |
| `anchors.py` | Goldmark GitHub-style heading slugs + duplicate disambiguation. |
| `post.py` | Parse a markdown file into a `Post` of anchored `Section`s. |
| `chunk.py` | Sections → overlapping, sentence-snapped `Chunk`s. |
| `quantize.py` | fp32 ↔ int8 with per-row scales. |
| `cache.py` | Content-hash embedding cache. |
| `rank.py` | Cosine scoring, chunk→post rollup, RRF fusion. |
| `metrics.py` | recall@k, MRR@k. |
| `artifacts.py` | On-disk vector format + `manifest.json`. |
| `build.py` | Corpus → potion vectors → artifacts. The live blog pipeline calls this. |
| `build_arms.py` | Assemble every benchmark arm. |
| `evaluate.py` | Score arms, apply the ship rule. |
| `verify_anchors.py` | Assert indexed anchors exist in rendered HTML. |
| `node/*.mjs` | MiniLM (transformers.js), ternlight, and the real Fuse.js baseline. |

Corpus path and query file are **arguments**, never constants — the package must run against
any static site.

Each arm's document vectors must come from the same implementation that will embed its
queries in the browser, or the two halves of the comparison live in different vector
spaces. That is why MiniLM is embedded with transformers.js in Node rather than
`sentence-transformers` in Python: the browser will run the ONNX q8 weights, so the build
must too.

**Chunking:** ~1000 chars, 200 overlap, snapped to sentence boundaries. Fenced code blocks
are **stripped**. `import numpy as np` mean-pooled into a static embedding is noise that
drags the chunk vector away from surrounding prose. Fuse.js indexes Hugo's `.Plain`, which
*does* include code, so keyword search still finds `pydub` inside a code fence. The two
engines deliberately index different views of the same post; the hybrid layer makes that
division of labor pay off.

**Title prefixing:** each chunk gets its post title prepended. This pulls a post's chunks
toward a common centroid — slightly hurting intra-post discrimination, clearly helping
post-level ranking, which is what we score. Implemented as an eval knob, not an assumption.

**Incremental cache:** keyed on `sha256(model_id + dims + chunker_version + chunk_text)`,
stored gitignored. Honestly: for the model2vec arm this is near-pointless, since embedding
155 chunks is a gather and a mean (~10 ms). It earns its keep on the MiniLM arm, where a
CPU torch forward pass takes seconds. Retained because it was requested, it is genuinely
useful during benchmarking, and "I built an embedding cache and then chose a model so fast
the cache never pays for itself" is a good paragraph.

### Browser runtime

`assets/js/semantic/`, roughly 150 lines total:

- **`tokenizer.js`** — reimplements `BertNormalizer` (clean control chars, lowercase, strip
  accents via NFD + drop combining marks), `BertPreTokenizer` (split on whitespace, isolate
  punctuation), and greedy longest-match-first WordPiece with `##` continuation and
  `max_input_chars_per_word = 100`.
- **`embed.js`** — gather one int8 row per token id, multiply by that row's fp32 scale,
  mean, L2-normalize.
- **`search.js`** — 155 dot products for cosine, then RRF fusion with Fuse.js results.

The token table loads lazily on first focus of the search box. The homepage pays nothing.

With ~155 vectors, brute-force cosine is ~40k multiply-adds. An approximate-nearest-neighbor
index would be actively counterproductive at this scale, and the post should say so.

#### Tokenizer parity: three traps

Verified by reading `model2vec/model.py` and `potion-base-8M/tokenizer.json`. A hand-rolled
tokenizer that disagrees with the build-time one silently poisons every query vector.

1. **No `[CLS]` / `[SEP]`.** `tokenize()` calls `encode_batch_fast(..., add_special_tokens=False)`.
   The `TemplateProcessing` post-processor in `tokenizer.json` is a decoy.
2. **`[UNK]` tokens are deleted from the sequence, not embedded.** A query of entirely
   out-of-vocabulary words yields an empty token list and a zero vector. The JS must
   reproduce this exactly, including the zero-vector case.
3. **`"strip_accents": null` means accents ARE stripped.** In HuggingFace `tokenizers`, a
   null `strip_accents` on a `BertNormalizer` inherits from `lowercase`, which is `true`.

#### Quantization

int8 values with a **per-row fp32 scale** (see key insight 4 for the measured, and partly
deflating, justification). 118 KB of scales on a 7.5 MB table.

Fidelity is verified by measuring cosine similarity between the fp32 and int8 query vectors.
Measured on real `potion-base-2M` weights over 50 random mean-pools: **0.999968** per-row,
against **0.999845** for a single global scale. Both clear the bar. The number goes in the post,
along with the fact that the global scale does nearly as well.

### Measured 2026-07-09: the shipped table reproduces the model

The central premise, verified end to end. Quantize the table, gather rows by token id, mean-pool,
L2-normalize — then compare against `StaticModel.encode()`:

| Model | dims | min cosine vs `encode()` | table + scales | + vocab = first-query download |
|---|---|---|---|---|
| `potion-base-8M` | 256 | 0.999958 | 7.68 MB | **7.99 MB** |
| `potion-base-8M` | 128 | 0.999970 | 3.90 MB | **4.21 MB** |
| `potion-retrieval-32M` | 512 | 0.999945 | 32.55 MB | ~33 MB |

Probes included `pydub` (out-of-vocabulary, shattered into subwords), `café naïve` (accent
stripping), `the` (lowest-norm row), and `vanuatu` (highest-norm row).

`StaticModel(dimensionality=128)` truncates PCA components *before* the final normalize, so its
output is still unit-norm and `quantize_unit` accepts it. The 128-dim arm is safe to ship.

The 13-post corpus yields **179 chunks** and a **46 KB** `docs.bin`. The token table is 173× the
size of the index it searches.

Document vectors are already L2-normalized, so they use a single global scale of 127.
`quantize_unit` asserts that precondition rather than silently clipping — an unnormalized vector
would lose information with no signal, which is a worse failure than an exception.

**Consequence for the browser, measured 2026-07-09:** because cosine similarity is invariant to
a per-row positive scale, and the document matrix uses one global scale, the browser **never has
to dequantize `docs.bin`**. A float32 query dotted against the raw int8 rows produces the same
ranking, to within 1e-6, as against dequantized float32 rows. Only the *query* must be float.

The corresponding hazard: `int8 @ int8` wraps around silently. A 300-dim dot product whose true
value is 3,000,000 comes back as `-64`, with no exception and no NaN. `cosine_scores` now raises
`TypeError` on a non-floating query rather than returning garbage. The JS port must be equally
careful: accumulate into a `Float32Array`, never an `Int8Array`.

### Ranking: hybrid via Reciprocal Rank Fusion

The keyword arm runs the real Fuse.js with the site's **corrected** configuration
(`ignoreLocation: true`, `threshold: 0.2`) — see key insight 5. The eval must measure the
engine that ships, not the one that was misconfigured.

Fuse.js returns a fuzzy-match **distance** in [0,1], lower is better, on a scale that
depends on query length and field weights. The vector index returns a **cosine similarity**
in [-1,1], higher is better, realistically banded around 0.3–0.8 for English prose. These
cannot be added.

The common hack — min-max normalize each list, take a weighted sum — makes a document's
score depend on which *other* documents happened to match, and introduces a blend weight
tuned until the demo looks good.

RRF discards the scores and keeps only the ranks:

```
RRF(d) = Σ  1 / (k + rank_i(d))         k = 60
         i ∈ engines
```

A document ranked 1st by keyword and unranked by semantic scores `1/61 ≈ 0.0164`. A
document ranked 3rd by both scores `2/63 ≈ 0.0317` and wins. The `k` term flattens the top
of the curve, so rank 1 vs rank 2 is a small difference while rank 1 vs rank 50 is large.
The behavior is "both engines liked this a bit" beats "one engine loved it" — exactly right
when one engine is blind to `pydub` and the other is blind to paraphrase.

Ten lines, one parameter, a defensible default (Cormack et al.), no score calibration.

**Shipped UI:** hybrid is the default. A keyword/semantic/hybrid toggle sits on the search
box, so readers of the post can drive it themselves. All three modes are needed for the
eval regardless; the toggle is ~20 extra lines.

### Result unit

Chunk-scored, post-level results. Score all ~155 chunks; a post's score is its best chunk.
At most 13 results, one per post, with the winning chunk as snippet, linking to the top of
the post. This drops into the existing Fuse.js result list with no template changes.

Known weakness: "max over chunks" is a noisy estimator, and a multi-section answer surfaces
only one snippet.

**Deep-link data is indexed now; deep-link rendering is deferred.** Every chunk records its
nearest preceding `##` heading and that heading's Goldmark anchor in `chunks.json`. The
query-time code ignores both fields and links to the top of the post. This costs a few
hundred bytes and keeps the option open: switching to section-level results later becomes a
UI change plus per-post capping, with no index rebuild and no re-embedding.

The risk of indexing a field nothing reads is that it silently rots — Goldmark's anchor
slugification can drift, and no one would notice. So the build script **verifies** anchors
rather than trusting them: after `hugo` runs, assert that every `anchor` in `chunks.json`
appears as an `id=` attribute in the corresponding `public/<slug>/index.html`. A wrong anchor
fails the build instead of producing a dead link the day we turn the feature on.

**Two things this actually caught, 2026-07-09.** Both belong in the blog post.

*Hugo is configured with `minify.minifyOutput: true`, so it emits unquoted id attributes.* A
regex matching only `id="..."` finds **2 ids on a page that has 30** — `moon` and `sun`, which
survive quoted only because they are SVG attributes the minifier left alone. Every heading
anchor would have been reported missing. `extract_ids` must handle `id="x"`, `id='x'`, and bare
`id=x`.

*The verifier immediately found a real anchor bug that a narrower check had already passed.* An
earlier task compared `github_anchor(text)` against Hugo's ids for all 93 headings and got 93
matches — but it took the heading text from the *rendered HTML*, where Goldmark had already
turned `_most definitely_` into `<em>most definitely</em>` and the tag had been stripped. The
real pipeline slugifies **raw markdown**, so `## It _most definitely_ needs supervision` produced
`it-_most-definitely_-needs-supervision` against Hugo's `it-most-definitely-needs-supervision`.
One dead link, invisible to a test that validated the slugifier against pre-cleaned input.

The fix is `strip_inline_emphasis` in `markdown.py`, applied inside `to_prose` — `github_anchor`
was innocent, it was being fed markup. It must preserve intraword `_`, because CommonMark forbids
intraword emphasis and `free_ssl` is a real heading word on this blog.

The moral, and the reason the verifier is worth its weight: **a check that constructs its own
expected value tests the function; only a check against the real artifact tests the pipeline.**

## Evaluation

30 hand-labeled queries in `scripts/queries.yaml`, three families of ten, each labeled with
the set of post slugs that should surface:

- **Exact-token** — `pydub`, `lunr`, `certbot`, `mmh3`. Keyword should dominate; semantic
  should visibly fail.
- **Conceptual paraphrase** — "find documents by meaning instead of matching words",
  "probabilistic set membership". Semantic should dominate; keyword should return nothing.
- **Navigational** — "how do I add search to a static site", legitimately spanning three
  posts.

**Arms:** keyword-only; whole-post-vector baseline; `potion-base-8M` at 256d and
PCA-truncated to 128d; `potion-base-2M`; `potion-retrieval-32M`; ternlight base and mini;
MiniLM q8. Plus RRF-hybrid on top of each semantic arm.

**Knobs swept:** chunk size {600, 1000, 1500}, title-prefix {on, off}.

**Metrics:** recall@3, MRR@10, and **precision@3**, reported **per family**. The aggregate
number hides the entire story, and precision is what stops a high-recall degenerate config
(see the threshold table below) from looking like a win.

### Ship rule, fixed in advance

> Ship the arm with the smallest first-query download whose overall recall@3 is within 0.03
> of the best arm's, tie-broken by MRR@10.

This is registered here, before any numbers exist, and stated as such in the post. The
alternative is picking a winner and reverse-engineering a justification, which is how most
"we chose X" engineering posts are written and why none of them are trustworthy.

### The baseline must be pre-registered too, and nearly wasn't

The ship rule governs which *semantic arm* wins. It says nothing about how strong the keyword
baseline is allowed to be — and Fuse's `threshold` is a dial that moves the baseline enormously.
Measured over the 30 eval queries, with `ignoreLocation: true`:

| threshold | exact | conceptual | navigational | overall | hits for `papermod` |
|---|---|---|---|---|---|
| 0.2 | **1.000** | 0.000 | 0.100 | 0.367 | 1 of 13 |
| 0.3 | 1.000 | 0.000 | 0.133 | 0.378 | 2 of 13 |
| 0.4 | 0.950 | 0.200 | 0.550 | 0.567 | 4 of 13 |
| 0.5 | 0.900 | **0.800** | 0.850 | **0.850** | **13 of 13** |

Read naively, `threshold: 0.5` says a fuzzy string matcher answers paraphrase queries as well
as embeddings do, and the entire premise of this project collapses. It is a mirage, and the
mechanism is worth stating exactly.

At 0.5, the query *"find documents by what they mean instead of which words they contain"*
returns 10 of the 13 posts. Their top four, by score:

```
  1  0.9916  use-google-cloud-text-to-speech-...      <- wrong
  2  0.9916  searching-your-hugo-site-with-lunr       <- wrong
  3  0.9920  building-a-semantic-search-engine-...    <- correct
  4  0.9930  building-a-full-text-search-engine-...
```

The correct post ranks **third**, behind two irrelevant posts that tie at 0.9916. Every score
sits within 0.0014 of every other. recall@3 scores this as a hit. It is noise wearing a
ranking's clothes, and `papermod` matches all 13 posts at the same setting.

**`threshold: 0.2` is chosen because it is what ships on the live site**, not because it makes
semantic search look good. It is also the precise setting: exactly one hit for `pydub`, `mmh3`,
and `papermod`. Reporting **precision@3 alongside recall@3** makes this checkable by a reader
rather than something they have to take on faith.

The general hazard, worth its own paragraph in the post: a pre-registered rule for choosing the
winner does nothing if you are free to tune the loser afterwards.

**The keyword baseline every semantic arm must beat** (Fuse.js, shipped config, 30 queries):

| family | recall@3 | MRR@10 | mean results returned | empty rankings |
|---|---|---|---|---|
| exact | **1.000** | 0.900 | 2.20 | 0 / 10 |
| conceptual | **0.000** | 0.000 | 0.00 | 10 / 10 |
| navigational | 0.100 | 0.100 | 0.10 | 9 / 10 |
| **overall** | **0.367** | 0.333 | 0.77 | 19 / 30 |

Keyword search is *perfect* on exact tokens and returns literally nothing for all ten paraphrase
queries. Not "ranks them poorly" — returns zero candidates. That is the shape of the problem
semantic search exists to solve, measured rather than assumed.

The navigational row is the surprise: 9 of 10 empty. Fuse is a fuzzy *substring* matcher, not a
bag-of-words engine like BM25, so a long natural-language query has no near-substring anywhere
in the corpus and matches nothing. Worth saying plainly in the post — "keyword search" on this
blog was never doing what most readers assume that phrase means.

### What the models actually know, measured before the eval ran

A sanity probe on short phrases, before any retrieval numbers exist. Cosine similarity:

| pair | MiniLM-q8 | tern-base | tern-mini | potion-8M | potion-ret32M |
|---|---|---|---|---|---|
| `reset my password` / `I forgot my password` | 0.837 | 0.884 | 0.907 | 0.775 | 0.676 |
| ↳ against `bloom filter` | 0.055 | 0.062 | 0.090 | 0.108 | 0.036 |
| `semantic search` / `find documents by meaning` | 0.547 | 0.587 | 0.451 | 0.398 | 0.209 |
| ↳ against `text to speech audio` | 0.113 | 0.191 | 0.286 | 0.108 | 0.087 |
| `bloom filter` / `probabilistic set membership` | 0.174 | **0.061** | **0.054** | -0.009 | **0.007** |
| ↳ against `free ssl certificate` | 0.101 | 0.108 | 0.100 | -0.054 | 0.019 |

Every model handles conversational paraphrase and separates it cleanly from a distractor. But
`bloom filter ↔ probabilistic set membership` sits **at noise level** for both ternlight tiers
and for `potion-retrieval-32M` — the related pair scores *below* the unrelated one. Small models
distilled on general text never learned that the term names the concept.

This is not an integration bug: ternlight's own README examples reproduce exactly (0.8844,
0.8218). It is a capability ceiling, and it directly foreshadows the conceptual eval query
*"a probabilistic structure for testing whether an item is in a set"*. Chunk-level context may
rescue it. If it doesn't, that is a result about small static embeddings on technical jargon —
which is what a programming blog is made of — not a failure of the experiment.

### A content bug the eval surfaced

`hnsw` was dropped from the `exact` family. It appears once in the corpus, inside the footnote
`[^faiss]` of the semantic-search post — and that footnote is **defined but never referenced**,
so Goldmark silently drops it. It renders nowhere, and is therefore absent from Hugo's `.Plain`
and from `index.json`.

The semantic arm reads markdown source and sees it. The keyword arm reads `.Plain` and cannot.
Asking both to find it would have understated the keyword baseline by 0.1 recall@3. Replaced
with `papermod`, which both engines can see.

Separately: that footnote is invisible on the published post. Worth fixing in the blog, but
*after* the eval, since the corpus snapshot is frozen at a commit.

### Honesty caveats (belong in the post, not a footnote)

- Thirty queries is a small sample with wide confidence intervals. Report per-family counts;
  do not claim a 0.01 recall difference is meaningful.
- The eval set is **generated by Claude and reviewed by a human**, and the post says so
  plainly. The failure mode this invites is vocabulary leakage: a model that has read the
  posts will phrase conceptual queries using the posts' own words, which flatters the
  semantic arm. Mitigation: the ten conceptual queries are drafted from each post's `title`
  and `description` front matter only, never from body prose. The exact-token and
  navigational families are unaffected, since their whole point is to use words the corpus
  does or does not contain.
- `examples/degoe-de/queries.yaml` is committed to a public repo, so anyone can inspect the
  eval set and disagree with it.

## The live demo

Follows the [bloom filters post](/bloom-filters-bit-arrays-recommendations-caches-bitcoin/)
pattern exactly: raw HTML in the markdown (Goldmark has `unsafe: true`), JS at
`assets/js/posts/<slug>/benchmark.js` loaded via the `include_js` front-matter field.
`extend_head.html` injects scripts un-deferred into `<head>`, so the widget must guard on
`DOMContentLoaded`, as `bloomfilters.js` does.

There is **no standalone benchmark page**. The widget lives in the post.

Each arm has its own Run button rather than auto-loading — one of them pulls 23 MB and
nobody should pay that by scrolling past. Each shows download bytes, embed ms, and search ms.

Two columns: **reference** (numbers measured while writing the post, baked in as constants)
and **your browser** (measured live on the reader's hardware). A reader on a phone over
cellular gets to watch the 23 MB arm hurt.

Transformers.js and ternlight load from CDN via the `include_cdn` front-matter field.

## Post outline

1. Hook: sequel to [Lunr in 2018](/searching-your-hugo-site-with-lunr/) and
   [the 250-line Python semantic search engine](/building-a-semantic-search-engine-in-250-lines-of-python/).
2. Why running a transformer in the browser costs 23 MB.
3. The reveal: a static embedding model *is* a lookup table (model2vec's `_encode_batch`).
4. Build time: chunking, stripping code, the cache that never pays for itself.
5. Quantization: int8 with per-row scales. The model's stopword list is its row norms — the
   smallest are `a`, `.`, `the`, `and`; the largest are `vanuatu` and `guantanamo`. Then the
   deflating measurement: a global scale zeroes only `.` and `a`, and still hits 0.9998. Keep
   per-row anyway at 1.54% overhead. A section about being wrong for the right reason.
6. WordPiece in 80 lines, and its three traps.
7. 179 dot products, and why an ANN index would be absurd here.
8. Hybrid retrieval and RRF.
8b. The anchor verifier, and the difference between testing a function and testing a pipeline.
   A check that builds its own expected value passed 93/93 while a dead link sat in the index.
8c. "Before I could benchmark semantic search, I had to admit my keyword search was broken."
   `location: 0, distance: 1000` meant the search box returned zero results for `pydub`,
   `mmh3`, and `hnsw`. Benchmarking against that would have been beating a strawman.
9. The benchmark: the pre-registered rule, the numbers, the per-family breakdown, the widget.
10. What shipped.

## Out of scope

- *Rendering* section deep links, and the per-post capping they require. The heading and
  anchor data is indexed and build-verified; only the UI is deferred. See Result unit.
- Approximate-nearest-neighbor indexing (counterproductive at 155 vectors).
- Vocabulary pruning (rejected; see key insight 3).
- Regenerating benchmark artifacts as new posts are added (frozen by design).
- CI-based embedding. Build runs on the laptop; artifacts are committed.
