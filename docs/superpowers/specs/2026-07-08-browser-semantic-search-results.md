# Browser semantic search: eval results and the selected arm

**Date:** 2026-07-10
**Corpus:** 13 posts, frozen at blog commit `dc70bff`, vendored to
`static-site-search-eval/examples/degoe-de/corpus/`
**Eval set:** 30 labeled queries, 10 per family, `examples/degoe-de/queries.yaml`
**Harness:** `sss_eval.evaluate`, 28 arms × {semantic-only, +RRF hybrid} = 56 rows, plus keyword

The ship rule was registered in the design doc **before any of these numbers existed**:

> Ship the arm with the smallest first-query download whose overall recall@3 is within 0.03
> of the best arm's, tie-broken by MRR@10.

It has not been changed. Everything below reports what it chose and what I subsequently
learned about it.

---

## The winner

**`potion-base-8M`, PCA-truncated to 128 dimensions, chunks of 600 characters with 120 overlap,
title-prefixed, fused with the Fuse.js keyword ranking via RRF (k=60).**

| | |
|---|---|
| First-query download | **4,205,974 bytes (4.21 MB)** — int8 token table + fp32 per-row scales + JSON vocab |
| Document index | 313 chunks × 128 int8 = **40 KB** |
| recall@3 | 0.967 |
| MRR@10 | 0.944 |
| precision@3 | 0.444 |
| per family (recall@3) | exact **1.000**, conceptual **1.000**, navigational 0.900 |
| per family (MRR@10) | exact **1.000**, conceptual 0.883, navigational 0.950 |

Half the download of `potion-base-8M` at full 256 dims (7.99 MB), a fifth of MiniLM q8 (23.10 MB),
and it beats both on the pre-registered rule.

---

## The keyword baseline it had to beat

Real Fuse.js, running the site's **corrected** shipped config (`ignoreLocation: true`,
`threshold: 0.2` — see the design doc's key insight 5 for why the original config was broken).

| family | recall@1 | recall@3 | MRR@10 | precision@3 | mean results | empty rankings |
|---|---|---|---|---|---|---|
| exact | 0.700 | **1.000** | 0.900 | — | 2.20 | 0 / 10 |
| conceptual | 0.000 | **0.000** | 0.000 | — | 0.00 | 10 / 10 |
| navigational | 0.100 | 0.100 | 0.100 | — | 0.10 | 9 / 10 |
| **overall** | 0.267 | 0.367 | 0.333 | 0.278 | 0.77 | 19 / 30 |

Keyword search is *perfect* on exact tokens at recall@3 and returns **literally zero candidates**
for all ten paraphrase queries. Not "ranks them badly" — returns nothing. That is the problem
semantic search exists to solve, measured rather than assumed.

The navigational row is the surprise: 9 of 10 empty. Fuse is a fuzzy *substring* matcher, not a
bag-of-words engine like BM25, so a long natural-language query has no near-substring anywhere in
the corpus. "Keyword search" on this blog was never doing what that phrase usually implies.

---

## The methodological finding: recall@3 saturates on a 13-document corpus

**This is the most important thing in this document and it belongs in the blog post.**

With 13 posts, "is a relevant post in the top 3" has a 3/13 ≈ 0.23 chance baseline, and almost any
signal clears it. Across 56 semantic rows, recall@3 produced only 24 distinct values and the top
five arms tied at 0.978. It could not separate a 4 MB lookup table from a 23 MB transformer.

Concretely: pure `potion-base-8M-256d-c600-o120-tp`, with **no keyword fusion**, scores
`exact` recall@3 = **1.000** — it finds `pydub`, `mmh3`, `papermod`, all supposedly
out-of-vocabulary subword rubble. Inspect the ranking and the illusion dissolves:

```
pydub  ->  1. free-ssl-on-github-pages-with-a-custom-domain   (wrong)
           2. github-pages-and-lets-encrypt                    (wrong)
           3. use-google-cloud-text-to-speech-...              (correct)
```

It ranks third, behind two irrelevant posts, and recall@3 scores that a hit.

### recall@1 separates what recall@3 cannot

All sizes are decimal MB (10⁶ bytes). Note that `sss_eval.evaluate`'s table prints **MiB** under
an `MB` header. Fixed in `a76eee7`; the byte counts in `arms.json` are authoritative.
Semantic-only rows unless marked, at each arm's best chunk config.

| arm | download | r@1 | r@3 | MRR@10 | exact r@1 | conceptual r@1 |
|---|---|---|---|---|---|---|
| keyword (Fuse.js) | 0 | 0.267 | 0.367 | 0.333 | 0.700 | **0.000** |
| potion-base-2M @64d | 2.32 MB | 0.500 | 0.911 | 0.808 | 0.400 | 0.550 |
| ternlight-mini | 5.05 MB | 0.567 | 0.939 | 0.850 | 0.400 | — |
| ternlight-base | 7.19 MB | 0.633 | 0.911 | 0.889 | 0.600 | 0.750 |
| whole-post baseline | 7.99 MB | 0.667 | 0.861 | 0.878 | **0.500** | 0.850 |
| potion-base-8M @256d | 7.99 MB | 0.667 | 0.978 | 0.906 | 0.700 | 0.650 |
| potion-base-8M @128d | **4.21 MB** | 0.683 | 0.967 | 0.922 | 0.750 | 0.750 |
| MiniLM q8 | 23.10 MB | 0.700 | 0.944 | 0.925 | 0.700 | 0.850 |
| **winner: potion-8M @128d + RRF** | **4.21 MB** | **0.717** | 0.967 | **0.944** | **0.850** | 0.750 |

MiniLM at 23.10 MB scores 0.700 recall@1. The winner scores **0.717 at 4.21 MB** — 5.5× smaller,
and by the caveat below, statistically indistinguishable. "As good as a transformer, at a fifth
the size" is the honest claim; "better" is not.

### The rule was right for nearly the wrong reason

Under recall@3, the eligibility cutoff was `0.9778 − 0.03 = 0.9478`. The 2.32 MB arm
`potion-base-2M-64d-c600-o120-tp+rrf` scored 0.9444 and was excluded **by 0.0033** — a margin far
smaller than one query's worth of recall, on a sample of 30. That exclusion looked arbitrary and
very nearly cost us a 45%-smaller model.

Under recall@1, the same arm is **0.183** behind (0.633 vs 0.717). It is genuinely worse. The
0.03 tolerance happened to land on the correct side of a boundary it had no business resolving.

**The lesson for the post:** a pre-registered decision rule protects you from choosing the winner
after seeing the numbers. It does *not* protect you from having pre-registered a metric that
cannot see the difference. With n=30 and 13 documents, a 0.003 recall@3 gap is noise, and I only
discovered that by computing a metric I had not committed to.

---

## What RRF hybrid actually buys

Fusing the keyword ranking into the winning semantic arm, at **zero additional download** (the
Fuse index already loads on every page):

| | exact r@1 | conceptual r@1 | overall r@1 | MRR@10 |
|---|---|---|---|---|
| semantic only | 0.750 | 0.750 | 0.683 | 0.922 |
| **+ RRF hybrid** | **0.850** | 0.750 | **0.717** | **0.944** |

Exact-token recall@1 rises by 0.100 and conceptual is untouched. Precisely the division of labor
the design predicted: keyword search knows `pydub` is a literal string, embeddings know
"listen to an article instead of reading it" means the text-to-speech post, and RRF takes the
union without ever comparing their incomparable scores.

---

## The whole-post baseline: wrong prediction, better finding

The design predicted whole-post vectors would fail outright, demonstrating that chunking matters.
They did not fail. They failed *selectively*:

| family | whole-post r@1 | best chunked (8M @128d) r@1 |
|---|---|---|
| exact | **0.500** | 0.750 |
| conceptual | 0.850 | 0.750 |
| navigational | 0.650 | 0.550 |

Mean-pooling an entire 15,000-character post **preserves its topic** — conceptual and navigational
queries do fine, sometimes better, because the vector is a clean centroid of what the post is
about. What it destroys is **rare-token signal**: `pydub` occurs four times in 14,803 characters,
and averaging it against 3,000 other tokens dilutes it to nothing. exact recall@1 collapses from
0.750 to 0.500.

So "chunking matters" is true, but the reason is narrower and more interesting than assumed:
chunking preserves rare tokens, not topic.

---

## Ternlight's 128-token ceiling is doing the chunking for it

`@ternlight/base` and `@ternlight/mini` (both **384-dim output**; the design doc's claim that
`mini` is 256-dim was wrong — 256 is its internal `d_model`).

Ternlight truncates at **128 WordPiece tokens**. Our 1000-character chunks have a median of 204
tokens, so **73.2% of chunks exceed the cap** and it sees a mean of 72% of each chunk's tokens.
Proven empirically, not from the docs: appending 200 filler words to an 82-token chunk moves its
cosine to 0.2168; appending the same filler to a 243-token chunk leaves cosine at **1.000000**.
The tail is never read.

I expected this to be a handicap. It is not. At the identical chunk configuration
(1000/200/title-prefix, semantic only, no fusion), recall@1:

| arm | r@1 | exact r@1 | sees |
|---|---|---|---|
| MiniLM q8 | **0.700** | 0.700 | all 204 median tokens |
| **ternlight-base** | **0.633** | 0.600 | first 128 tokens |
| potion-base-8M @256d | 0.583 | 0.650 | all 204 median tokens |
| ternlight-mini | 0.567 | 0.400 | first 128 tokens |

**Ternlight-base beats potion at the same chunk size while reading only 63% of each chunk.**

The explanation is the whole-post baseline's lesson in miniature. A 128-token window is roughly
600 characters — which is precisely the chunk size the sweep found optimal for potion. Ternlight's
truncation is silently performing the chunking that potion has to be *told* to do. Feed potion
1000-character chunks and it dutifully mean-pools all 204 tokens into a mushier vector (r@1 0.583);
feed it 600-character chunks and it jumps to 0.667.

So the fair comparison is ternlight-base at c1000 (0.633, effective window ~600 chars) against
potion-8M-256d at c600 (0.667). They are close, and potion wins on download size: 7.99 MB against
ternlight-base's 7.19 MB at 256d, or **4.21 MB at 128 dims** — where potion also scores higher
(0.683). That is the arm that ships.

`ternlight-mini`'s exact r@1 of 0.400 is the worst number in the table. A smaller distilled model
plus a truncation window is where rare-token signal goes to die.

Two caveats stated plainly. The three Node arms (MiniLM, both ternlight tiers) exist at **one**
chunk configuration only (1000/200/title-prefix), because re-running ONNX and WASM inference over
179 chunks × six chunk settings was not worth the wall time. They are marked `†` in the harness
output and were not swept. Ternlight at c600 would see whole chunks and might well improve — that
experiment was not run, and the post should not pretend otherwise.

And ternlight is not misconfigured: its own README examples reproduce exactly
(`cosineSim(embed('reset my password'), embed('I forgot my password'))` = **0.8844**, against a
documented 0.88).

---

## Caveats that belong in the post, not a footnote

- **Thirty queries is a small sample.** The 95% confidence interval on a proportion near 0.7 with
  n=30 is roughly ±0.16. Differences below ~0.1 in recall@1 should not be read as real. The winner
  beats MiniLM by 0.017 — that is a tie, and the honest claim is "as good as, at a fifth the size."
- **The eval set was generated by Claude and reviewed by a human.** The ten conceptual queries were
  drafted from each post's `title` and `description` front matter only, never body prose, to limit
  vocabulary leakage. `queries.yaml` is committed to a public repo; disagree with it in the open.
- **13 documents is a small corpus.** recall@3 saturates (above). Nothing here generalizes to a
  1,000-post blog without re-measuring.
- **precision@3 has a ceiling of ~0.44** on this eval, because 20 of 30 queries have exactly one
  relevant post and precision@3 is therefore capped at 1/3 for them. It is reported to detect
  degenerate high-recall configurations, not to rank good ones.
- **The keyword baseline's threshold was pre-registered as the shipped value (0.2)**, not tuned.
  At `threshold: 0.5` its overall recall@3 would rise to 0.850 — entirely from returning 10–13 of
  13 posts per query. See the design doc's threshold table.

---

## Reproducing this

```bash
git clone https://github.com/bartdegoede/static-site-search-eval
cd static-site-search-eval && uv sync && pnpm install

uv run python -m sss_eval.dump_chunks \
  --corpus examples/degoe-de/corpus --queries examples/degoe-de/queries.yaml --out build/chunks.json
node node/build_minilm.mjs build/chunks.json build/minilm.json
node node/build_ternlight.mjs build/chunks.json build/ternlight-base.json @ternlight/base
node node/build_ternlight.mjs build/chunks.json build/ternlight-mini.json @ternlight/mini
node node/rank_fuse.mjs examples/degoe-de/index.json examples/degoe-de/queries.yaml build/fuse-ranks.json

uv run python -m sss_eval.build_arms \
  --corpus examples/degoe-de/corpus --queries examples/degoe-de/queries.yaml
uv run python -m sss_eval.evaluate --json build/results.json
```

`potion-retrieval-32M` downloads 129 MB once. Everything else is cached after the first run.

---

## What int8 quantization actually costs, measured on the shipped index

The browser reconstructs each token row as `tokens[id*dims+d] * scales[id]` from the int8 table.
`StaticModel.encode()` reads the fp32 table. Worst-case query-vector cosine between them, across
the 30 eval queries: **0.999966**.

That fidelity is not free of consequences, and the consequences land exactly where you'd want:

| | changed by quantization |
|---|---|
| top-1 result | **0 / 30** |
| top-3 results | 1 / 30 |
| full ranking order | 4 / 30 |

Quantization never moves the answer. It reshuffles near-ties four ranks down, where nobody looks.
The divergences are 1e-4-sized score gaps between posts that were already neck and neck.

**This matters for testing.** A parity gate asserting `js_ranking == rank(model.encode(q))` fails
on those four queries **against a correct implementation**, because the browser can never reach a
reference computed from weights it does not have. The correct reference is Python reconstructing
its query vector from the same shipped int8 bytes -- under which JavaScript agrees **30/30**.

The hand-written JS WordPiece tokenizer separately reproduces Python's token ids on 16/16 probe
strings, including `日本語のみ`, `naïve café 3.14`, `C++ vs C#`, and `tf-idf`.

## What Part 2 ships

```bash
sss-eval build \
  --corpus content/post \
  --outdir static/search \
  --model minishlab/potion-base-8M \
  --dims 128 \
  --chunk-size 600 \
  --chunk-overlap 120
```

Browser runtime: hand-rolled WordPiece tokenizer + int8 gather/mean/normalize + 313 dot products,
fused with the existing Fuse.js ranking via RRF at `k=60`. First-query cost 4.21 MB, lazy-loaded
on search-box focus. The document index is 40 KB.
