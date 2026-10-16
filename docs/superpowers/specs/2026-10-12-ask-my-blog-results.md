# Ask my blog: eval results

**Date:** 2026-10-12. **Branch:** `ask-my-blog-eval`.
**Spec:** `2026-10-12-ask-my-blog-design.md`. **Plan:** `../plans/2026-10-12-ask-my-blog-part1-eval.md`.
**Raw data:** `scripts/ask_eval/results/` (prompts, every arm's runs, judgements,
spot check, `report.md`).

## 1. Decisions (Part 2 builds on these)

| decision | value |
|---|---|
| Default model | **Qwen3-0.6B**, `onnx-community/Qwen3-0.6B-ONNX`, dtype `q4f16`, 579 MB, chat template with `enable_thinking: false` |
| Demonstrators (labelled "see why size matters") | SmolLM2-360M (`HuggingFaceTB/SmolLM2-360M-Instruct`, q4f16, 275 MB); Gemma 3 270M (`onnx-community/gemma-3-270m-it-ONNX`, q4f16, 293 MB); LFM2.5-350M (`onnx-community/LFM2.5-350M-ONNX`, q4f16, 258 MB) |
| Not offered | SmolLM2-135M (0/30 faithful); Gemma 4 E2B (3.1 GB; post-only reference) |
| Relevance gate threshold | **0.45** (best chunk cosine score; below it the model is not called) |
| Decoding | greedy, `MAX_NEW_TOKENS = 120`, `REPETITION_PENALTY = 1.15` (`assets/js/ask/prompt.js`) |
| Retrieval | top 4 chunks (`TOP_K`), passage budget 4,800 chars |
| Weights hosting | Hugging Face Hub (pinned commit per model), not GitHub Pages |

The spec's original rule ("two models ≤ 350 MB, Small = smallest with ≥75% faithful")
returned nothing: no ≤350 MB model got above 3/30. The shipping decision above was made
by the author with that in mind; the post is about these numbers.

## 2. Feasibility

All candidates verified on Hugging Face and probed on CPU in Node with
transformers.js 4.3.1 (`scripts/ask_eval/probe_models.mjs`, `candidates.json`).

| arm | tier | repo | dtype | MB | status |
|---|---|---|---|---|---|
| smollm2-135m | browser | HuggingFaceTB/SmolLM2-135M-Instruct | q4f16 | 120 | ok |
| smollm2-360m | browser | HuggingFaceTB/SmolLM2-360M-Instruct | q4f16 | 275 | ok |
| gemma3-270m | browser | onnx-community/gemma-3-270m-it-ONNX | q4f16 | 293 | ok (template folds system into user turn) |
| lfm2.5-350m | browser | onnx-community/LFM2.5-350M-ONNX | q4f16 | 258 | ok |
| qwen3-0.6b | midsize | onnx-community/Qwen3-0.6B-ONNX | q4f16 | 579 | ok; over the 350 MB budget at every dtype, kept as reference, then chosen as default |
| qwen2.5-0.5b | browser | onnx-community/Qwen2.5-0.5B-Instruct | q4 | 793 | over budget (483 MB at q4f16); not run |
| gemma4-e2b | large | onnx-community/gemma-4-E2B-it-ONNX | q4f16 | 3,131 | ok; text-only load skips audio/vision encoders |
| qwen3.5-0.8b | | | | | excluded up front: no official ONNX build |

**Surprise:** in several repos `q4` is *larger* than `q4f16` (q4 keeps embeddings
in fp32), so every arm uses q4f16. **Part 2 must verify q4f16 runs on the WASM
fallback** (it ran on CPU in Node, which is encouraging but not the same runtime).

## 3. Results

Same 45 questions, same 4 retrieved passages, same prompt for every arm. Judged by
Claude Opus 5.5 against the passages each arm was given.

| arm | tier | MB | faithful | unsupported | non-answer | negatives answered with invented content | median TTFT (CPU) | median tok/s (CPU) | USD / 1k questions |
|---|---|---|---|---|---|---|---|---|---|
| smollm2-135m | browser | 120 | 0/30 | 28/30 | 2/30 | 14/15 | 972 ms | 43.4 | 0 |
| lfm2.5-350m | browser | 258 | 2/30 | 27/30 | 1/30 | 14/15 | 2,039 ms | 25.5 | 0 |
| smollm2-360m | browser | 275 | 3/30 | 24/30 | 3/30 | 15/15 | 2,620 ms | 22.1 | 0 |
| gemma3-270m | browser | 293 | 3/30 | 22/30 | 5/30 | 13/15 | 1,777 ms | 23.7 | 0 |
| **qwen3-0.6b** | midsize | 579 | **15/30** | 15/30 | 0/30 | 5/15 | 4,892 ms | 11.0 | 0 |
| gemma4-e2b | large | 3,131 | 28/30 | 2/30 | 0/30 | 0/15 | 13,692 ms | 4.3 | 1,032 (always-on GPU) |
| haiku-5-5 | hosted | n/a | 27/30 | 3/30 | 0/30 | 1/15 | 1,120 ms (end-to-end) | n/a | 0.13 |

Local timings are CPU-in-Node on the author's Mac; browser WebGPU/WASM numbers come
in Part 3.

### Retrieval

hit@4 on answerable questions: **28/30**. Misses: q03 (mmh3: the token is
out-of-vocabulary for the static embedding model) and q16 (a conceptual paraphrase
that lands on unrelated posts). Failures in the table above are model failures, not
retrieval failures, except on those two.

### Relevance gate

Near-miss negatives score as high as answerable questions (negatives: median 0.525,
max 0.633; answerable: min 0.374, median 0.643), so a score gate only catches
clearly off-topic questions.

| threshold | negatives passing | answerable rejected |
|---|---|---|
| 0.40 | 11/15 | 1/30 |
| **0.45** | 9/15 | 2/30 (q04, q16) |
| 0.50 | 8/15 | 4/30 |
| 0.61 (plan's "≤10% negatives" rule) | 1/15 | 13/30 |

At 0.45, Qwen3 still invents an answer on 5/15 negatives: those are near-misses
whose scores clear any sensible gate. The gate mostly protects the demonstrators
from off-topic rambling. The "generated, may be wrong" label and sources-first
layout carry the rest.

### Repetition penalty

The first local run used plain greedy decoding (commit `1a96d85`). The tiny models
looped until the 120-token cap (SmolLM2-135M on 39/45 questions, Gemma 3 270M on
21/45), e.g. SmolLM2-135M on q05: *"1. Custom Search: Search from your URL bar\n2.
Search from your URL bar\n3. Search from your URL bar…"*, and Gemma 3 270M on n07:
*"I'5555555555…"*. With `repetition_penalty = 1.15` (commit `29d7fc6`, the runs
judged above) the loops are gone, but the tiny models now write long, varied,
confident text to the cap instead (36/45 and 24/45). The penalty fixes the symptom,
not the problem: they don't stick to the passages or to two sentences.

## 4. Is renting a GPU or paying for inference worth it?

- **Always-on GPU for Gemma 4 E2B:** $0.707/h (Google Cloud g2-standard-4, 1× L4,
  us-central1 on-demand, via https://computeprices.com/providers/google/gpus/l4,
  checked 2026-10-12; a third-party tracker, the GCP page didn't render) × 730 h =
  **$516/month**. At this blog's traffic (300-500 visitors/month; assumed 500
  questions/month) that is ~$1,032 per 1,000 questions.
- **Claude Haiku 5.5:** measured $0.0059 for 45 questions → **$0.07/month** at
  500 questions/month, with 27/30 faithful and 1/15 invented answers.
- **In-browser Gemma 4 E2B** matches Haiku on quality (28/30, 0/15) at $0, but
  costs the reader a 3.1 GB download and ~14 s to first token on CPU.

Plainly: renting a GPU makes no sense at this scale; paying for inference is almost
free and as good as the best local model; the honest in-browser trade-off is
download size vs. faithfulness, and the knee is somewhere between 0.6B and 2B.

## 5. Examples for the post (verbatim)

**Good**
- Qwen3-0.6B, q06 "How did the blog use Cloudflare to get SSL working?": *"The blog
  used CloudFlare to enable SSL by allowing users to access websites over HTTPS
  through a free SSL option. This involved setting up a proxy between GitHub sites
  and users using CloudFlare’s Universal SSL feature."*
- Gemma 3 270M, q10 "Which Qwen3 model does the local coding agent run?": *"The
  local coding agent uses the Qwen3-Coder-30B-A3B model."* (one of its 3 faithful)
- Gemma 4 E2B, n07 "Which GPU should I buy to run Llama 70B locally?": *"The
  provided passages do not contain information about which GPU you should buy to
  run Llama 70B locally."*

**Unsupported**
- SmolLM2-360M, n07: *"…the best option to run Llama 70B locally is likely to be a
  NVIDIA GTX 960 or GTX 970… ideal for handling large amounts of data such as the
  6.4 million documents required by Llama 70B."*
- LFM2.5-350M, q01 "How did the blog use Lunr to add search?": *"Lunr was used to
  enable a typeahead search mode, allowing users to view results from partial
  queries like displaying "pyth" after typing "p"…"* (garbles the passages)
- Qwen3-0.6B, n10 "How does BM25 ranking improve on TF-IDF?": *"BM25 ranking
  improves on TF-IDF by incorporating additional factors such as word context and
  relevance…"* (no passage mentions BM25)

**Negatives the ungated model answered anyway**
- Gemma 3 270M, n01 "How do I bake sourdough bread at home?": *"…The answer is by
  using a commercial yeast starter. You need to follow these steps: 1. Choose a
  suitable starter…"* (blocked by the 0.45 gate: score 0.248)
- Gemma 3 270M, n07: *"I recommend using a high-performance graphics card (GPU)
  such as a NVIDIA A100 series (e.g., RTX 3090, RTX 3080…)"* (not blocked: score 0.569)

## 6. Notes for Part 2

- Some answers start with or contain passage markers (`[1]`, `[3]`) despite the
  spec dropping inline citations (Gemma 4, Qwen3). Strip a leading marker, or turn
  markers into links to the source cards.
- Answers routinely exceed two sentences; consider displaying only the first two
  sentences (not evaluated here; it would change what the judge saw).
- Qwen3 needs `enable_thinking: false` in the chat template kwargs.
- Model files (names + byte sizes) per pinned revision feed the progress bar's total.

## 7. Caveats

- The question set (45: 30 answerable rephrased from the semantic-search eval,
  15 negatives) was generated by Claude and reviewed by the author; `relevant`
  lists were extended for two newer posts with the author's approval.
- The judge is Claude Opus 5.5, judging against the passages (not the blog as a
  whole). Human spot check of 20 blind items: **13/20 three-way agreement, 16/20 on
  faithful-vs-not**, 4/5 on the Haiku arm. Most disagreement is "unsupported" vs
  "non-answer" on answers both consider bad; on the faithful boundary the judge was
  stricter twice and more lenient twice. The gap between the tiny models (≤3/30)
  and Qwen3/Gemma 4/Haiku is far larger than this noise.
- The judge and one arm are both Claude; the judge never saw arm names, and the
  Haiku items in the spot check agreed 4/5.
- Haiku 5.5 can't be run greedily (temperature not settable), and 9/45 of its
  answers hit the 120-token cap; the judge was told not to penalise truncation.
- Single run per arm; no variance estimate.
- The judge saw passages as `[i] title + snippet`; the arms saw `[i] title — heading
  + snippet`. Same text otherwise; unlikely to move any label, but not identical.
- `judge.py` uses the SDK's `output_format=` parse argument (worked with
  `anthropic` 1.13.0; may need updating to `output_config.format` on upgrade).

## 8. Browser numbers (Part 2)

Measured on the author's Mac. WebGPU in the author's Chrome (spike page); WASM in
headless Chromium via `tests/e2e/ask.e2e.mjs`. GitHub Pages can't send COOP/COEP,
so WASM runs single-threaded.

| model | backend | first download → ready | benchmark tok/s | real answer: first token / tok/s |
|---|---|---|---|---|
| Qwen3-0.6B | WebGPU | 16.2 s load (spike) | 19.8 | 1.7 s (short prompt, spike) |
| Qwen3-0.6B | WASM | ~29-36 s | 1.2 | ~16 s / 1.1 (30-60 s per answer) |
| SmolLM2-360M | WASM | ~18 s | 1.5-1.7 | ~9 s / 1.5 |

- q4f16 works on WASM for Qwen3 and SmolLM2, but **not** for Gemma 3 270M or
  LFM2.5-350M (`GatherBlockQuantized` has no CPU kernel); those are WebGPU-only.
- The model file is kept in Cache Storage in a normal Chrome profile; non-persistent
  or low-quota contexts don't keep it (the page says so).
- Stop on WASM: the worker never sees a stop message mid-generation, so Stop
  terminates the worker (≈30 ms); if the model is cached it reloads (2-3.5 s),
  otherwise it offers a "Reload model (N MB download)" button instead of downloading silently.

## 9. Answer length vs faithfulness

Does letting the model say more help? Qwen3-0.6B and Gemma 4 E2B, same 45
questions and passages, system prompt "at most N sentences", `max_new_tokens = 60·N`,
early stop at N sentences (exactly what the page does), judged by Opus 5.5 with
"do not penalise length". Generations: `scripts/ask_eval/results/length/`;
judgements: `results/judgements-length.jsonl`; table: `results/length/report.md`.

| model | N | faithful | unsupported | invented on negatives | mean sentences |
|---|---|---|---|---|---|
| Qwen3-0.6B | 2 | 15/30 (50%) | 15/30 | 5/15 | 1.7 |
| Qwen3-0.6B | 4 | 9/30 (30%) | 21/30 | 7/15 | 2.9 |
| Qwen3-0.6B | 6 | 5/30 (17%) | 24/30 | 6/15 | 3.8 |
| Gemma 4 E2B | 2 | 28/30 (93%) | 2/30 | 0/15 | 1.6 |
| Gemma 4 E2B | 4 | 26/30 (87%) | 4/30 | 0/15 | 2.4 |
| Gemma 4 E2B | 6 | 24/30 (80%) | 6/30 | 0/15 | 2.8 |

- Faithfulness falls with length for both; steeply for the small model
  (50% → 17%), gently for the large one (93% → 80%).
- Gemma 4 barely uses the extra room (2.8 sentences when allowed 6) and never
  invents an answer to a question the blog doesn't cover.
- N=2 reproduces the main eval exactly (Qwen 15/30, Gemma 28/30) with early stop
  on: the page's two-sentence clamp didn't change the measured quality.
- Decision: keep the two-sentence cap; no "longer answer" feature.

## 10. Repetition penalty per model (2026-10-16)

transformers.js applies `repetition_penalty` to every token in the sequence,
prompt included, so 1.15 also pushes a model away from the words in the passages
it should repeat. Found while fine-tuning Qwen3-0.6B for this page (separate repo,
small-rag-finetune). Re-run of the main eval for every local model at 1.0
(`run_local.mjs --repetition-penalty 1.0 --out-dir results/rp1`, judged into
`results/judgements-rp1.jsonl`). Same 45 prompts and judge as §3.

| model | faithful, 1.15 → 1.0 | invented (of 15), 1.15 → 1.0 | looping replies at 1.0 (1.15) |
|---|---|---|---|
| Qwen3-0.6B | 15 → **18** | 5 → 6 | 0 (0) |
| LFM2.5-350M | 2 → **11** | 14 → 13 | 1 (0) |
| SmolLM2-360M | 3 → 8 | 15 → 12 | 10 (1) |
| SmolLM2-135M | 0 → 1 | 14 → 7 | 30 (3) |
| Gemma 3 270M | 3 → 2 | 13 → 12 | 13 (3) |
| Gemma 4 E2B | 28 → 29 | 0 → 0 | 0 (0) |

"Looping" = the reply repeats some four-word sequence 3+ times
(`scripts/ask_eval` has no counter for this; counted on the result files).

- The penalty exists for the smallest models, and they still need it: without
  it SmolLM2 and Gemma 3 270M loop in a quarter to two-thirds of replies.
- Qwen3 and LFM2.5 don't loop either way and answer better without it. LFM2.5
  jumps from 2 to 11; it still invents an answer to almost every off-blog
  question, so it stays a demonstrator.
- Gemma 4 E2B barely changes (28 → 29 is within judge noise on 30 questions).
- One-question differences are noise; 15 → 18 and 2 → 11 are not.

Decision: the penalty is per model. `repetitionPenalty` in `models.js` (default
`REPETITION_PENALTY` = 1.15 in `prompt.js`) is 1.0 for Qwen3-0.6B and
LFM2.5-350M. `candidates.json` carries the same `repetition_penalty`, so
`run_local.mjs` measures what ships, and a test keeps the two in sync. The model
cards show the 1.0 numbers. The post keeps the numbers as published.
