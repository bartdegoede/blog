# Ask My Blog, Part 1: Eval + Model Choice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **HARD RULES for every subagent:**
> - **Never pass `--active` to any `uv` command.** A subagent previously ran `uv run --active` and destroyed `~/.virtualenvs/blog`.
> - `public/` is a **git submodule** (separate repo). Never `git add` or commit inside it, never build with `--cleanDestinationDir`.
> - Do not modify `assets/js/semantic/`, `static/search/`, or the existing files in `tests/js/` — they are parity-gated. All existing `node --test` tests must stay green.
> - Run JS tests with `node --test` (no path argument; a directory arg breaks on Node 25).
> - Use `pnpm` (not npm) and `uv` (not pip).
> - Every step that calls the Anthropic API **spends money**: print the estimated cost and ask the user before running the full set. Credentials: run `ant auth status` first; don't ask for a key unless it reports none.

**Goal:** Decide which ≤350 MB model(s) `/ask/` will ship, tune the relevance-gate threshold, and produce the cost/quality table (in-browser vs Gemma 4 E2B vs Claude Haiku 5.5) for the post.

**Spec:** `docs/superpowers/specs/2026-10-12-ask-my-blog-design.md`

**Architecture:** Two pure ES modules (`assets/js/ask/retrieve.js`, `assets/js/ask/prompt.js`) are written now and shared verbatim with the Part 2 browser page, so the eval measures exactly what ships. A Node pipeline builds one prompt per question (`prompts.jsonl`), runs every local candidate through transformers.js on CPU, and a Python side sends the *same* prompts to Haiku, judges every summary with Claude Opus 5.5, and computes the report. Pure decision logic (threshold, model choice, costs) lives in a tested Python module.

**Tech Stack:** Node 25 + `@huggingface/transformers` (ONNX Runtime, CPU in Node) + `yaml`; Python 3.12 via `uv` + `anthropic` SDK (1.x) + `pydantic` + `pytest`.

---

## File map

| File | Responsibility |
|---|---|
| `assets/js/ask/retrieve.js` | Pure: top-k chunks from a score vector |
| `assets/js/ask/prompt.js` | Pure: constants, system prompt, `buildMessages`, `foldSystem` |
| `tests/js/ask-retrieve.test.mjs`, `tests/js/ask-prompt.test.mjs` | Unit tests for the above |
| `scripts/ask_eval/node_index.mjs` | Load `static/search/` from disk in Node; `scoreQuery()` |
| `scripts/ask_eval/questions.yaml` | ~45 questions (30 answerable + ~15 negatives) |
| `scripts/ask_eval/candidates.json` | Arm registry, filled by the feasibility probe |
| `scripts/ask_eval/probe_models.mjs` | Feasibility gate: can each candidate load + generate? size? |
| `scripts/ask_eval/build_prompts.mjs` | questions → `results/prompts.jsonl` |
| `scripts/ask_eval/run_local.mjs` | prompts × local arm → `results/local/<arm>.jsonl` |
| `scripts/ask_eval/__init__.py` | Makes `ask_eval` importable (pytest `pythonpath = ["scripts"]`) |
| `scripts/ask_eval/report_lib.py` | Pure: aggregation, threshold, model choice, costs |
| `tests/ask_eval/test_report_lib.py` | Unit tests for `report_lib` |
| `scripts/ask_eval/run_hosted.py` | prompts → Haiku 5.5 → `results/hosted/haiku-5-5.jsonl` |
| `scripts/ask_eval/judge.py` | every arm's summaries → `results/judgements.jsonl` |
| `scripts/ask_eval/spotcheck.py` | sample 20 judgements for human labelling; agreement |
| `scripts/ask_eval/report.py` | CLI: everything → `results/report.md` |
| `docs/superpowers/specs/2026-10-12-ask-my-blog-results.md` | Human-written results + decisions |

Results under `scripts/ask_eval/results/` are small JSONL and **are committed** (reproducibility, and the post quotes them).

---

### Task 1: `retrieve.js` — top-k chunks

**Files:**
- Create: `assets/js/ask/retrieve.js`
- Test: `tests/js/ask-retrieve.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/js/ask-retrieve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { topChunks } from "../../assets/js/ask/retrieve.js";

const chunks = [
  { post: "a", snippet: "A0" },
  { post: "b", snippet: "B0" },
  { post: "a", snippet: "A1" },
  { post: "c", snippet: "C0" },
];

test("returns the k highest-scoring chunks, best first, with scores", () => {
  const scores = new Float32Array([0.1, 0.9, 0.5, 0.3]);
  const top = topChunks(scores, chunks, 2);
  assert.deepEqual(top.map((t) => t.chunk.snippet), ["B0", "A1"]);
  assert.ok(Math.abs(top[0].score - 0.9) < 1e-6);
});

test("ties break by chunk index ascending (deterministic)", () => {
  const scores = new Float32Array([0.5, 0.5, 0.5, 0.1]);
  assert.deepEqual(topChunks(scores, chunks, 3).map((t) => t.index), [0, 1, 2]);
});

test("k larger than the corpus returns everything", () => {
  const scores = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  assert.equal(topChunks(scores, chunks, 10).length, 4);
});

test("length mismatch throws instead of silently misaligning", () => {
  assert.throws(() => topChunks(new Float32Array(3), chunks, 2), /length/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test`
Expected: FAIL in `ask-retrieve.test.mjs` with `Cannot find module .../assets/js/ask/retrieve.js`.

- [ ] **Step 3: Implement**

```js
// assets/js/ask/retrieve.js
/**
 * Chunk-level retrieval for /ask/.
 *
 * The homepage search rolls chunks up to posts; /ask/ needs the passages
 * themselves, so this keeps chunk granularity. Zero imports: runs in the
 * browser, the Web Worker, and under `node --test` unchanged.
 */

/**
 * @param {Float32Array|number[]} scores - one cosine score per chunk
 * @param {object[]} chunks - chunks.json records, same order as scores
 * @param {number} k
 * @returns {Array<{index: number, score: number, chunk: object}>} best first;
 *   ties broken by chunk index ascending so results are deterministic
 */
export function topChunks(scores, chunks, k) {
  if (scores.length !== chunks.length) {
    throw new Error(`topChunks: scores length ${scores.length} != chunks length ${chunks.length}`);
  }
  const order = Array.from(scores, (score, index) => ({ index, score }));
  order.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
  return order.slice(0, k).map(({ index, score }) => ({ index, score, chunk: chunks[index] }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test`
Expected: all tests pass (existing 107 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add assets/js/ask/retrieve.js tests/js/ask-retrieve.test.mjs
git commit -m "Add chunk-level retrieval for /ask/"
```

---

### Task 2: `prompt.js` — prompt assembly

**Files:**
- Create: `assets/js/ask/prompt.js`
- Test: `tests/js/ask-prompt.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/js/ask-prompt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_PROMPT, TOP_K, MAX_NEW_TOKENS, MAX_PASSAGE_CHARS,
  buildMessages, foldSystem,
} from "../../assets/js/ask/prompt.js";

const passages = [
  { title: "Bloom filters", heading: "Hashing", snippet: "A bloom filter uses k hash functions." },
  { title: "Lunr search", heading: null, snippet: "Lunr builds an index at build time." },
];

test("constants match the spec", () => {
  assert.equal(TOP_K, 4);
  assert.equal(MAX_NEW_TOKENS, 120);
  assert.equal(MAX_PASSAGE_CHARS, 4800);
  assert.match(SYSTEM_PROMPT, /at most 2 sentences/);
});

test("buildMessages: system + one user turn with numbered passages then question", () => {
  const msgs = buildMessages("How do bloom filters work?", passages);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, SYSTEM_PROMPT);
  assert.equal(msgs[1].role, "user");
  const u = msgs[1].content;
  assert.ok(u.indexOf("[1] Bloom filters — Hashing") < u.indexOf("[2] Lunr search"));
  assert.ok(u.trimEnd().endsWith("Question: How do bloom filters work?"));
});

test("buildMessages truncates the passage block to MAX_PASSAGE_CHARS", () => {
  const long = [{ title: "T", heading: null, snippet: "x".repeat(10000) }];
  const u = buildMessages("q?", long)[1].content;
  const block = u.slice(0, u.indexOf("Question:"));
  assert.ok(block.length <= MAX_PASSAGE_CHARS + 200, `block was ${block.length}`);
});

test("buildMessages drops whole passages that start past the budget", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `P${i}`, heading: null, snippet: "y".repeat(600) }));
  const u = buildMessages("q?", many)[1].content;
  assert.ok(!u.includes("[20] P19"));
});

test("foldSystem merges the system prompt into the first user turn", () => {
  const folded = foldSystem(buildMessages("q?", passages));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].role, "user");
  assert.ok(folded[0].content.startsWith(SYSTEM_PROMPT));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test`
Expected: FAIL, `Cannot find module .../assets/js/ask/prompt.js`.

- [ ] **Step 3: Implement**

```js
// assets/js/ask/prompt.js
/**
 * Prompt assembly for /ask/. Shared verbatim by the browser worker (Part 2)
 * and the eval harness, so the eval measures exactly what ships.
 * Zero imports.
 */

export const TOP_K = 4;
export const MAX_NEW_TOKENS = 120;
// ~1,200 tokens at ~4 chars/token. Four chunks average ~1,900 chars, so this
// only bites on unusually long chunks; it exists to keep WASM prefill bounded.
export const MAX_PASSAGE_CHARS = 4800;

export const SYSTEM_PROMPT =
  "You answer questions about a personal technical blog. " +
  "Use only the numbered passages provided. " +
  "Answer in at most 2 sentences. " +
  "If the passages do not answer the question, say that the blog does not seem to cover it.";

function label(p, i) {
  return `[${i + 1}] ${p.title}${p.heading ? ` — ${p.heading}` : ""}`;
}

/**
 * @param {string} question
 * @param {Array<{title: string, heading: string|null, snippet: string}>} passages - best first
 * @returns {Array<{role: "system"|"user", content: string}>}
 */
export function buildMessages(question, passages) {
  const parts = [];
  let used = 0;
  for (let i = 0; i < passages.length; i++) {
    if (used >= MAX_PASSAGE_CHARS) break;
    const head = label(passages[i], i);
    const room = MAX_PASSAGE_CHARS - used - head.length - 2;
    if (room <= 0) break;
    const body = passages[i].snippet.slice(0, room);
    parts.push(`${head}\n${body}`);
    used += head.length + body.length + 2;
  }
  const user = `Passages:\n\n${parts.join("\n\n")}\n\nQuestion: ${question}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/**
 * For chat templates without a system role: prepend the system prompt to the
 * first user message.
 */
export function foldSystem(messages) {
  const [sys, first, ...rest] = messages;
  if (sys.role !== "system") return messages;
  return [{ role: "user", content: `${sys.content}\n\n${first.content}` }, ...rest];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/ask/prompt.js tests/js/ask-prompt.test.mjs
git commit -m "Add shared prompt assembly for /ask/"
```

---

### Task 3: Node dependencies + on-disk index loader

**Files:**
- Modify: `package.json` (via pnpm)
- Create: `scripts/ask_eval/node_index.mjs`

- [ ] **Step 1: Add dependencies**

```bash
pnpm add -D @huggingface/transformers yaml
```

Record the exact resolved `@huggingface/transformers` version in the commit message; the browser page (Part 2) pins the same version from the CDN.

- [ ] **Step 2: Write the loader**

```js
// scripts/ask_eval/node_index.mjs
// Loads the exact bytes static/search/ ships, the same way tests/js/parity.test.mjs does.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WordPiece } from "../../assets/js/semantic/tokenizer.js";
import { embedQuery } from "../../assets/js/semantic/embed.js";
import { cosineScores } from "../../assets/js/semantic/search.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "static", "search");
// Mirrors WORDPIECE_OPTS in assets/js/semantic/index.js (not exported).
const WORDPIECE_OPTS = { unkToken: "[UNK]", prefix: "##", maxCharsPerWord: 100 };

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const json = (f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));

export function loadIndexFromDisk() {
  const manifest = json("manifest.json");
  const f = manifest.files;
  return {
    manifest,
    docs: new Int8Array(ab(readFileSync(path.join(DIR, f.docs)))),
    tokens: new Int8Array(ab(readFileSync(path.join(DIR, f.tokens)))),
    scales: new Float32Array(ab(readFileSync(path.join(DIR, f.scales)))),
    chunks: json(f.chunks),
    wp: new WordPiece(json(f.vocab), WORDPIECE_OPTS),
  };
}

/** @returns {Float32Array} one cosine score per chunk (all zeros for an empty/OOV query) */
export function scoreQuery(idx, query) {
  const ids = idx.wp.encode(query);
  const { dims, n_chunks } = idx.manifest;
  if (ids.length === 0) return new Float32Array(n_chunks);
  return cosineScores(embedQuery(ids, idx.tokens, idx.scales, dims), idx.docs, n_chunks, dims);
}
```

- [ ] **Step 3: Smoke-test it**

Run:
```bash
node -e 'import("./scripts/ask_eval/node_index.mjs").then(async m=>{const {topChunks}=await import("./assets/js/ask/retrieve.js");const i=m.loadIndexFromDisk();console.log(topChunks(m.scoreQuery(i,"how do bloom filters work"),i.chunks,4).map(t=>[t.chunk.post,t.score.toFixed(3)]))})'
```
Expected: 4 rows, the first with post `bloom-filters-bit-arrays-recommendations-caches-bitcoin` (or whatever the bloom post's slug in `chunks.json` is) and a score above 0.4.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/ask_eval/node_index.mjs
git commit -m "Add transformers.js + on-disk index loader for the ask eval (transformers <version>)"
```

---

### Task 4: Feasibility gate — which candidates actually run

**Files:**
- Create: `scripts/ask_eval/candidates.json`, `scripts/ask_eval/probe_models.mjs`

- [ ] **Step 1: Verify repo IDs on Hugging Face before writing anything**

For each candidate, open its Hugging Face page (WebFetch is fine) and record: the exact repo id of a transformers.js-compatible ONNX build (look under `onnx-community/` and `HuggingFaceTB/` first), which `dtype`s exist in its `onnx/` folder (`q4`, `q4f16`, `int8`, …), and the byte size of the q4 decoder files. Candidates (from the spec):

| arm id | look for | tier |
|---|---|---|
| `smollm2-135m` | SmolLM2-135M-Instruct ONNX | browser |
| `smollm2-360m` | SmolLM2-360M-Instruct ONNX | browser |
| `gemma3-270m` | Gemma 3 270M-it ONNX | browser |
| `lfm2.5-350m` | LFM2.5-350M ONNX (may not exist; if not, drop it and record why) | browser |
| `qwen3-0.6b` | `onnx-community/Qwen3-0.6B-ONNX` | browser |
| `qwen2.5-0.5b` | Qwen2.5-0.5B-Instruct ONNX | browser |
| `gemma4-e2b` | Gemma 4 E2B-it ONNX (`onnx-community/gemma-4-e2b-it` or `…-ONNX`; confirm which is live) | large |

Qwen3.5-0.8B is excluded up front (no official ONNX build).

- [ ] **Step 2: Write `candidates.json` with what you verified**

Shape (one object per arm; fill real values from Step 1, never guesses):

```json
[
  {
    "arm": "smollm2-135m",
    "tier": "browser",
    "repo": "HuggingFaceTB/SmolLM2-135M-Instruct",
    "dtype": "q4",
    "download_mb": null,
    "system_role": null,
    "status": "unprobed",
    "note": ""
  }
]
```

`download_mb`, `system_role` and `status` are filled by the probe in Step 4.

- [ ] **Step 3: Write the probe**

```js
// scripts/ask_eval/probe_models.mjs
// Feasibility gate: for each candidate, load it, generate 8 tokens with a
// system+user chat, and record download size and whether the chat template
// accepts a system role. Rewrites candidates.json in place.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline, env } from "@huggingface/transformers";
import { foldSystem } from "../../assets/js/ask/prompt.js";

const FILE = new URL("./candidates.json", import.meta.url);
env.cacheDir = path.join(os.homedir(), ".cache", "ask-eval-transformers");

function dirMB(dir) {
  let total = 0;
  for (const name of readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, name);
    if (statSync(p).isFile()) total += statSync(p).size;
  }
  return Math.round(total / 1e6);
}

const only = process.argv[2]; // optional: probe a single arm
const cands = JSON.parse(readFileSync(FILE, "utf8"));
for (const c of cands) {
  if (only && c.arm !== only) continue;
  const msgs = [{ role: "system", content: "Be brief." }, { role: "user", content: "Say hi." }];
  try {
    const gen = await pipeline("text-generation", c.repo, { dtype: c.dtype, device: "cpu" });
    try {
      await gen(msgs, { max_new_tokens: 8, do_sample: false });
      c.system_role = true;
    } catch {
      await gen(foldSystem(msgs), { max_new_tokens: 8, do_sample: false });
      c.system_role = false;
    }
    c.download_mb = dirMB(path.join(env.cacheDir, c.repo));
    c.status = "ok";
    await gen.dispose();
  } catch (e) {
    c.status = "failed";
    c.note = String(e.message || e).slice(0, 300);
  }
  console.log(c.arm, c.status, c.download_mb ?? "", c.note);
  writeFileSync(FILE, JSON.stringify(cands, null, 2) + "\n");
}
```

- [ ] **Step 4: Run it**

Run: `node scripts/ask_eval/probe_models.mjs` (expect several minutes; `gemma4-e2b` alone downloads ~3 GB, so run it last with `node scripts/ask_eval/probe_models.mjs gemma4-e2b`).
Expected: each line ends `ok <MB>` or `failed <reason>`. For browser-tier arms that are `ok` but have `download_mb > 350`, set `"status": "over-budget"` by hand with a note. If `gemma4-e2b` fails on CPU with `q4f16`, retry with `"dtype": "q4"`; if that fails too, record it as failed and keep going (the post then reports it from the browser run in Part 3 only).

- [ ] **Step 5: Commit**

```bash
git add scripts/ask_eval/candidates.json scripts/ask_eval/probe_models.mjs
git commit -m "Ask eval: feasibility probe and verified candidate list"
```

---

### Task 5: Question set

**Files:**
- Create: `scripts/ask_eval/questions.yaml`

- [ ] **Step 1: Draft the answerable questions**

Read `/Users/bart/projects/static-site-search-eval/examples/degoe-de/queries.yaml`. For each of the 30 entries, write one question a reader would type into `/ask/`, keeping `family` and `relevant` unchanged. Keep the subject term from `exact` queries (a bare `"lunr"` becomes e.g. `"How did the blog use Lunr for search?"`). Conceptual queries stay paraphrases: draft them from the target post's `title`/`description` only, never body prose (same leakage rule as the original set).

- [ ] **Step 2: Draft ~15 negatives**

`family: negative`, `relevant: []`. Three or four far-off questions ("How do I bake sourdough bread?") and eleven or twelve **near-misses** that sound like the blog but aren't answered by it. Check each one with `rg -i` against `content/post/` to confirm that the blog really doesn't answer it. Examples of the shape: "How do I add search to a Jekyll site?", "How much does Algolia cost per month?", "How do I fine-tune Kokoro on my own voice?", "Which GPU should I buy for running Llama 70B?".

- [ ] **Step 3: Write the file**

```yaml
# Eval set for /ask/ (in-browser RAG). Generated by Claude, reviewed by a human.
# Answerable questions are rephrased from the semantic-search eval set
# (static-site-search-eval: examples/degoe-de/queries.yaml); `relevant` is unchanged.
# `negative` questions are NOT answered by the blog; most are deliberate near-misses.

- id: q01
  question: "How did the blog use Lunr for search?"
  family: exact
  relevant: [searching-your-hugo-site-with-lunr]
# ... q01-q30 answerable, n01-n15 negatives ...
- id: n01
  question: "How do I add search to a Jekyll site?"
  family: negative
  relevant: []
```

- [ ] **Step 4: Validate**

Run:
```bash
uv run python -c "import yaml,collections;q=yaml.safe_load(open('scripts/ask_eval/questions.yaml'));print(len(q),collections.Counter(x['family'] for x in q));assert len({x['id'] for x in q})==len(q)"
```
Expected: about `45 Counter({'negative': 15, 'exact': 10, 'conceptual': 10, 'navigational': 10})`, no assertion error.

- [ ] **Step 5: STOP — user review**

Show the user the full question list and wait for their approval/edits before committing. The post claims that the set was human-reviewed, so this step can't be skipped.

- [ ] **Step 6: Commit**

```bash
git add scripts/ask_eval/questions.yaml
git commit -m "Ask eval: question set (30 answerable + negatives), human-reviewed"
```

---

### Task 6: Build prompts

**Files:**
- Create: `scripts/ask_eval/build_prompts.mjs`
- Output: `scripts/ask_eval/results/prompts.jsonl`

- [ ] **Step 1: Write the builder**

```js
// scripts/ask_eval/build_prompts.mjs
// questions.yaml -> results/prompts.jsonl: one row per question with the
// retrieved chunks, the best score (for the relevance gate), whether
// retrieval found a relevant post, and the exact chat messages every arm gets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "yaml";
import { loadIndexFromDisk, scoreQuery } from "./node_index.mjs";
import { topChunks } from "../../assets/js/ask/retrieve.js";
import { TOP_K, buildMessages } from "../../assets/js/ask/prompt.js";

const questions = parse(readFileSync(new URL("./questions.yaml", import.meta.url), "utf8"));
const idx = loadIndexFromDisk();
const out = new URL("./results/", import.meta.url);
mkdirSync(out, { recursive: true });

const rows = questions.map((q) => {
  const top = topChunks(scoreQuery(idx, q.question), idx.chunks, TOP_K);
  const passages = top.map((t) => t.chunk);
  const posts = [...new Set(passages.map((p) => p.post))];
  return {
    id: q.id,
    question: q.question,
    family: q.family,
    relevant: q.relevant,
    best_score: top[0]?.score ?? 0,
    retrieved_posts: posts,
    retrieval_hit: q.relevant.some((r) => posts.includes(r)),
    passages: passages.map(({ post, title, heading, snippet }) => ({ post, title, heading, snippet })),
    messages: buildMessages(q.question, passages),
  };
});
writeFileSync(new URL("prompts.jsonl", out), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const answerable = rows.filter((r) => r.family !== "negative");
console.log(`${rows.length} prompts; retrieval hit@${TOP_K} on answerable: ` +
  `${answerable.filter((r) => r.retrieval_hit).length}/${answerable.length}`);
```

- [ ] **Step 2: Run it**

Run: `node scripts/ask_eval/build_prompts.mjs`
Expected: `45 prompts; retrieval hit@4 on answerable: N/30`. Write N down; it goes in the results doc. Some misses on `exact` questions are expected (semantic search struggles with out-of-vocabulary tokens), but if N < 20, stop and tell the user before continuing: retrieval failures would then dominate the model comparison.

- [ ] **Step 3: Commit**

```bash
git add scripts/ask_eval/build_prompts.mjs scripts/ask_eval/results/prompts.jsonl
git commit -m "Ask eval: build per-question prompts and retrieval hits"
```

---

### Task 7: Run local arms

**Files:**
- Create: `scripts/ask_eval/run_local.mjs`
- Output: `scripts/ask_eval/results/local/<arm>.jsonl`

- [ ] **Step 1: Write the runner**

Every question is run **ungated** (negatives included): the gate is applied later in the report, which lets the post show what the model would have said without it.

```js
// scripts/ask_eval/run_local.mjs
// Usage: node scripts/ask_eval/run_local.mjs <arm> [<arm> ...]   (or "all")
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline, env, TextStreamer } from "@huggingface/transformers";
import { MAX_NEW_TOKENS, foldSystem } from "../../assets/js/ask/prompt.js";

env.cacheDir = path.join(os.homedir(), ".cache", "ask-eval-transformers");
const here = (p) => new URL(p, import.meta.url);
const cands = JSON.parse(readFileSync(here("./candidates.json"), "utf8"))
  .filter((c) => c.status === "ok");
const prompts = readFileSync(here("./results/prompts.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const wanted = process.argv.slice(2);
const arms = wanted[0] === "all" ? cands : cands.filter((c) => wanted.includes(c.arm));
if (arms.length === 0) throw new Error(`no runnable arms match ${wanted.join(" ")}`);
mkdirSync(here("./results/local/"), { recursive: true });

for (const c of arms) {
  const gen = await pipeline("text-generation", c.repo, { dtype: c.dtype, device: "cpu" });
  const rows = [];
  for (const p of prompts) {
    const messages = c.system_role ? p.messages : foldSystem(p.messages);
    const t0 = performance.now();
    let tFirst = null;
    let nTokens = 0;
    const streamer = new TextStreamer(gen.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: () => { nTokens++; if (tFirst === null) tFirst = performance.now(); },
    });
    const out = await gen(messages, { max_new_tokens: MAX_NEW_TOKENS, do_sample: false, streamer });
    const t1 = performance.now();
    const summary = out[0].generated_text.at(-1).content.trim();
    rows.push({
      arm: c.arm, id: p.id, summary,
      ttft_ms: Math.round((tFirst ?? t1) - t0),
      tok_s: nTokens > 1 ? +((nTokens - 1) / ((t1 - tFirst) / 1000)).toFixed(1) : null,
      output_tokens: nTokens,
    });
    process.stdout.write(".");
  }
  writeFileSync(here(`./results/local/${c.arm}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(` ${c.arm}: ${rows.length} rows`);
  await gen.dispose();
}
```

- [ ] **Step 2: Smoke-run the smallest arm**

Run: `node scripts/ask_eval/run_local.mjs smollm2-135m`
Expected: 45 dots, then `smollm2-135m: 45 rows`. Open the JSONL and read 5 summaries: they should be short English text with no chat-template junk (`<|im_start|>` etc.). If the template junk shows up, the `generated_text.at(-1).content` extraction is wrong for that model; fix it before running the rest.

- [ ] **Step 3: Run the rest**

Run: `node scripts/ask_eval/run_local.mjs all` (run `gemma4-e2b` separately if it's slow; it's fine for it to take a while).
Expected: one JSONL per `ok` arm in `results/local/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ask_eval/run_local.mjs scripts/ask_eval/results/local/
git commit -m "Ask eval: local arm runs (CPU, greedy, ungated)"
```

---

### Task 8: `report_lib.py` — pure decision logic (TDD)

**Files:**
- Create: `scripts/ask_eval/__init__.py` (empty), `scripts/ask_eval/report_lib.py`
- Test: `tests/ask_eval/test_report_lib.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/ask_eval/test_report_lib.py
import pytest

from ask_eval.report_lib import (
    arm_summary,
    choose_models,
    choose_threshold,
    cost_per_1k_always_on_gpu,
    cost_per_1k_hosted,
)


def test_choose_threshold_lets_at_most_max_frac_negatives_through():
    neg = [0.10, 0.20, 0.30, 0.40, 0.50, 0.55, 0.60, 0.62, 0.64, 0.70]
    pos = [0.45, 0.60, 0.65, 0.80]
    t = choose_threshold(pos, neg, max_neg_pass=0.10)
    assert sum(s >= t for s in neg) <= 1
    # smallest such threshold: just above the 2nd-highest negative
    assert 0.64 < t <= 0.70


def test_choose_threshold_zero_tolerance_blocks_all_negatives():
    t = choose_threshold([0.9], [0.3, 0.5], max_neg_pass=0.0)
    assert t > 0.5


def test_arm_summary_rates_over_answerable_only():
    judged = [
        {"family": "exact", "label": "faithful"},
        {"family": "exact", "label": "unsupported"},
        {"family": "conceptual", "label": "faithful"},
        {"family": "conceptual", "label": "non-answer"},
        {"family": "negative", "label": "unsupported"},
    ]
    s = arm_summary(judged)
    assert s["faithful"] == pytest.approx(0.5)
    assert s["unsupported"] == pytest.approx(0.25)
    assert s["non_answer"] == pytest.approx(0.25)
    assert s["negative_unsupported_ungated"] == pytest.approx(1.0)


def test_choose_models_small_is_smallest_over_bar_better_is_most_faithful():
    arms = [
        {"arm": "a", "tier": "browser", "download_mb": 100, "faithful": 0.70},
        {"arm": "b", "tier": "browser", "download_mb": 200, "faithful": 0.78},
        {"arm": "c", "tier": "browser", "download_mb": 340, "faithful": 0.86},
        {"arm": "d", "tier": "browser", "download_mb": 400, "faithful": 0.95},
        {"arm": "e", "tier": "large", "download_mb": 2900, "faithful": 0.97},
    ]
    assert choose_models(arms, bar=0.75, max_mb=350) == {"small": "b", "better": "c"}


def test_choose_models_collapses_to_one_when_same_model_wins_both():
    arms = [
        {"arm": "a", "tier": "browser", "download_mb": 100, "faithful": 0.90},
        {"arm": "b", "tier": "browser", "download_mb": 300, "faithful": 0.80},
    ]
    assert choose_models(arms, bar=0.75, max_mb=350) == {"small": "a", "better": "a"}


def test_choose_models_none_over_bar():
    arms = [{"arm": "a", "tier": "browser", "download_mb": 100, "faithful": 0.5}]
    assert choose_models(arms, bar=0.75, max_mb=350) == {"small": None, "better": "a"}


def test_hosted_cost_per_1k():
    # Haiku 5.5: $0.10 / $0.50 per 1M tokens; 600 in + 60 out per question
    rows = [{"input_tokens": 600, "output_tokens": 60}] * 10
    assert cost_per_1k_hosted(rows, in_per_m=0.10, out_per_m=0.50) == pytest.approx(0.09)


def test_always_on_gpu_cost_per_1k():
    # $0.50/h, 730 h/month, 1,000 questions/month -> $365 per 1k questions
    assert cost_per_1k_always_on_gpu(0.50, 1000) == pytest.approx(365.0)
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/ask_eval -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ask_eval'`.

- [ ] **Step 3: Implement**

```python
# scripts/ask_eval/report_lib.py
"""Pure decision logic for the /ask/ eval. No I/O, no API calls."""

from __future__ import annotations

ANSWERABLE = {"exact", "conceptual", "navigational"}
HOURS_PER_MONTH = 730


def choose_threshold(pos: list[float], neg: list[float], max_neg_pass: float) -> float:
    """Smallest gate threshold letting at most `max_neg_pass` of negatives through.

    Candidates are the negative scores themselves (nudged up so the score at
    the threshold is blocked). `pos` is accepted so callers report the
    answerable questions this rejects; it does not influence the choice.
    """
    allowed = int(max_neg_pass * len(neg))
    ranked = sorted(neg, reverse=True)
    if allowed >= len(ranked):
        return min(ranked + pos) if ranked or pos else 0.0
    return ranked[allowed] + 1e-6


def arm_summary(judged: list[dict]) -> dict:
    ans = [j for j in judged if j["family"] in ANSWERABLE]
    neg = [j for j in judged if j["family"] == "negative"]

    def rate(rows: list[dict], label: str) -> float:
        return sum(r["label"] == label for r in rows) / len(rows) if rows else 0.0

    return {
        "faithful": rate(ans, "faithful"),
        "unsupported": rate(ans, "unsupported"),
        "non_answer": rate(ans, "non-answer"),
        "negative_unsupported_ungated": rate(neg, "unsupported"),
    }


def choose_models(arms: list[dict], bar: float, max_mb: int) -> dict:
    """Small = smallest browser arm with faithful >= bar.
    Better = most faithful browser arm within max_mb (ties -> smaller)."""
    browser = [a for a in arms if a["tier"] == "browser" and a["download_mb"] <= max_mb]
    over = sorted((a for a in browser if a["faithful"] >= bar), key=lambda a: a["download_mb"])
    best = sorted(browser, key=lambda a: (-a["faithful"], a["download_mb"]))
    return {
        "small": over[0]["arm"] if over else None,
        "better": best[0]["arm"] if best else None,
    }


def cost_per_1k_hosted(rows: list[dict], in_per_m: float, out_per_m: float) -> float:
    per_q = sum(r["input_tokens"] * in_per_m + r["output_tokens"] * out_per_m for r in rows)
    return per_q / len(rows) / 1e6 * 1000


def cost_per_1k_always_on_gpu(hourly_usd: float, questions_per_month: int) -> float:
    return hourly_usd * HOURS_PER_MONTH / questions_per_month * 1000
```

Note the `choose_models` "collapses to one" test: `a` is both the smallest over the bar and the most faithful, so both slots are `a`; Part 2 then ships a single option.

- [ ] **Step 4: Run to verify they pass**

Run: `uv run pytest tests/ask_eval -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ask_eval/__init__.py scripts/ask_eval/report_lib.py tests/ask_eval/test_report_lib.py
git commit -m "Ask eval: tested decision logic (threshold, model choice, costs)"
```

---

### Task 9: Hosted arm — Claude Haiku 5.5

**Files:**
- Modify: `pyproject.toml` (via uv)
- Create: `scripts/ask_eval/run_hosted.py`
- Output: `scripts/ask_eval/results/hosted/haiku-5-5.jsonl`

- [ ] **Step 1: Add the SDK and check credentials**

```bash
uv add anthropic pydantic
ant auth status
```
Expected: `ant auth status` reports an active credential source. If it doesn't, ask the user to run `! ant auth login` (or export `ANTHROPIC_API_KEY`).

- [ ] **Step 2: Write the runner**

Haiku 5.5 rejects non-default `temperature`, so unlike the local arms it is not greedy; this is noted in the results doc. Thinking is disabled (allowed at effort ≤ high) so that the output budget matches the local arms' 120 tokens.

```python
# scripts/ask_eval/run_hosted.py
"""Send every prompt in results/prompts.jsonl to Claude Haiku 5.5, same messages as local arms."""

import json
import time
from pathlib import Path

import anthropic
import click

HERE = Path(__file__).parent
MODEL = "claude-haiku-5-5"
MAX_NEW_TOKENS = 120  # mirrors assets/js/ask/prompt.js


@click.command()
@click.option("--limit", type=int, default=None, help="Only the first N prompts (dry run).")
def main(limit: int | None) -> None:
    prompts = [json.loads(line) for line in (HERE / "results/prompts.jsonl").read_text().splitlines()]
    prompts = prompts[:limit] if limit else prompts
    client = anthropic.Anthropic()
    out = HERE / "results/hosted"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for p in prompts:
        system, user = p["messages"][0]["content"], p["messages"][1:]
        t0 = time.perf_counter()
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_NEW_TOKENS,
            system=system,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            messages=user,
        )
        if resp.stop_reason == "refusal":
            summary = ""
        else:
            summary = "".join(b.text for b in resp.content if b.type == "text").strip()
        rows.append({
            "arm": "haiku-5-5",
            "id": p["id"],
            "summary": summary,
            "latency_ms": round((time.perf_counter() - t0) * 1000),
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "stop_reason": resp.stop_reason,
        })
        click.echo(".", nl=False)
    name = "haiku-5-5.dryrun.jsonl" if limit else "haiku-5-5.jsonl"
    (out / name).write_text("".join(json.dumps(r) + "\n" for r in rows))
    click.echo(f"\n{len(rows)} rows -> {out / name}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Dry run (3 prompts) and cost estimate**

Run: `uv run python scripts/ask_eval/run_hosted.py --limit 3`
Expected: `3 rows`. From the dry-run token counts, estimate the full run (≈45 × (in·$0.10 + out·$0.50)/1M; expect well under $0.10). Tell the user the estimate and wait for a go-ahead.

- [ ] **Step 4: Full run**

Run: `uv run python scripts/ask_eval/run_hosted.py`
Expected: `45 rows -> .../haiku-5-5.jsonl`. Delete the dry-run file.

- [ ] **Step 5: Commit**

```bash
rm scripts/ask_eval/results/hosted/haiku-5-5.dryrun.jsonl
git add pyproject.toml uv.lock scripts/ask_eval/run_hosted.py scripts/ask_eval/results/hosted/
git commit -m "Ask eval: hosted arm (Claude Haiku 5.5)"
```

---

### Task 10: Judge

**Files:**
- Create: `scripts/ask_eval/judge.py`
- Output: `scripts/ask_eval/results/judgements.jsonl`

- [ ] **Step 1: Write the judge**

The judge is Claude Opus 5.5, a different model from the Haiku arm. It sees only the question, the passages, and the summary; it never sees the arm name (reduces self-preference bias).

```python
# scripts/ask_eval/judge.py
"""Label every arm's summary as faithful / unsupported / non-answer against its passages."""

import json
from pathlib import Path
from typing import Literal

import anthropic
import click
from pydantic import BaseModel

HERE = Path(__file__).parent
JUDGE = "claude-opus-5-5"

INSTRUCTIONS = """You are grading a short answer written by a small language model.
The model was given numbered passages from a blog and a question, and told to answer
in at most 2 sentences using only the passages.

Label the answer:
- "faithful": every factual claim in the answer is supported by the passages, and it
  addresses the question (saying the blog does not cover it counts as faithful ONLY if
  the passages really do not answer the question).
- "unsupported": at least one claim is not supported by the passages (invented,
  contradicted, or from outside knowledge), even if it happens to be true.
- "non-answer": no unsupported claims, but it does not answer the question although the
  passages do (declines wrongly, rambles, repeats the question, empty).

Judge only against the passages, not your own knowledge of the topic."""


class Verdict(BaseModel):
    label: Literal["faithful", "unsupported", "non-answer"]
    unsupported_claims: list[str]
    reason: str


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def render(p: dict, summary: str) -> str:
    passages = "\n\n".join(
        f"[{i + 1}] {x['title']}\n{x['snippet']}" for i, x in enumerate(p["passages"])
    )
    return f"{INSTRUCTIONS}\n\n<passages>\n{passages}\n</passages>\n\n<question>{p['question']}</question>\n\n<answer>{summary}</answer>"


@click.command()
@click.option("--limit", type=int, default=None, help="Judge only the first N rows (dry run).")
def main(limit: int | None) -> None:
    prompts = {p["id"]: p for p in load_jsonl(HERE / "results/prompts.jsonl")}
    runs = sorted((HERE / "results/local").glob("*.jsonl")) + [HERE / "results/hosted/haiku-5-5.jsonl"]
    rows = [r for path in runs for r in load_jsonl(path)]
    out_path = HERE / "results/judgements.jsonl"
    done = {(j["arm"], j["id"]) for j in load_jsonl(out_path)} if out_path.exists() else set()
    todo = [r for r in rows if (r["arm"], r["id"]) not in done][:limit]
    click.echo(f"{len(todo)} to judge ({len(done)} already done)")

    client = anthropic.Anthropic()
    in_tok = out_tok = 0
    with out_path.open("a") as f:
        for r in todo:
            p = prompts[r["id"]]
            # Effort is left at Opus 5.5's default (medium); parse() owns output_config.
            resp = client.messages.parse(
                model=JUDGE,
                max_tokens=16000,
                messages=[{"role": "user", "content": render(p, r["summary"])}],
                output_format=Verdict,
            )
            in_tok += resp.usage.input_tokens
            out_tok += resp.usage.output_tokens
            if resp.stop_reason == "refusal" or resp.parsed_output is None:
                # Recorded, not retried: counts as neither faithful nor unsupported,
                # and shows up in the results doc if it ever happens.
                verdict = {"label": "judge-refused", "unsupported_claims": [], "reason": str(resp.stop_reason)}
            else:
                verdict = resp.parsed_output.model_dump()
            f.write(json.dumps({"arm": r["arm"], "id": r["id"], "family": p["family"], **verdict}) + "\n")
            f.flush()
            click.echo(".", nl=False)
    cost = in_tok * 4.00 / 1e6 + out_tok * 20.00 / 1e6
    click.echo(f"\njudge tokens in={in_tok} out={out_tok} cost=${cost:.2f}")


if __name__ == "__main__":
    main()
```

The output file is appended to and resumable: re-running skips `(arm, id)` pairs already judged.

- [ ] **Step 2: Dry run + cost estimate**

Run: `uv run python scripts/ask_eval/judge.py --limit 5`
Expected: 5 dots and a cost line. Multiply by (total rows / 5) and tell the user the estimate (≈ 8 arms × 45 = 360 rows). Wait for a go-ahead.

- [ ] **Step 3: Full run**

Run: `uv run python scripts/ask_eval/judge.py`
Expected: the remaining rows judged; `wc -l scripts/ask_eval/results/judgements.jsonl` equals the total number of arm rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/ask_eval/judge.py scripts/ask_eval/results/judgements.jsonl
git commit -m "Ask eval: Opus 5.5 judgements for all arms"
```

---

### Task 11: Human spot check

**Files:**
- Create: `scripts/ask_eval/spotcheck.py`
- Output: `scripts/ask_eval/results/spotcheck.jsonl`

- [ ] **Step 1: Write the sampler/scorer**

```python
# scripts/ask_eval/spotcheck.py
"""`sample`: write 20 judgements (>=5 from haiku-5-5) for the human to label.
`score`: agreement between human_label and the judge's label."""

import json
import random
from pathlib import Path

import click

HERE = Path(__file__).parent
OUT = HERE / "results/spotcheck.jsonl"


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


@click.group()
def cli() -> None:
    pass


@cli.command()
@click.option("--seed", default=20261012)
def sample(seed: int) -> None:
    rng = random.Random(seed)
    judged = load(HERE / "results/judgements.jsonl")
    prompts = {p["id"]: p for p in load(HERE / "results/prompts.jsonl")}
    runs = {(r["arm"], r["id"]): r for path in (HERE / "results").glob("*/*.jsonl")
            if not path.name.endswith("dryrun.jsonl") for r in load(path)}
    haiku = [j for j in judged if j["arm"] == "haiku-5-5"]
    rest = [j for j in judged if j["arm"] != "haiku-5-5"]
    picked = rng.sample(haiku, 5) + rng.sample(rest, 15)
    with OUT.open("w") as f:
        for j in picked:
            p = prompts[j["id"]]
            f.write(json.dumps({
                "arm": j["arm"], "id": j["id"], "question": p["question"],
                "passages": [x["snippet"] for x in p["passages"]],
                "summary": runs[(j["arm"], j["id"])]["summary"],
                "judge_label": j["label"], "human_label": None,
            }) + "\n")
    click.echo(f"wrote {OUT}; fill in human_label for each row")


@cli.command()
def score() -> None:
    rows = load(OUT)
    missing = [r["id"] for r in rows if r["human_label"] is None]
    if missing:
        raise click.ClickException(f"{len(missing)} rows still unlabelled")
    agree = sum(r["human_label"] == r["judge_label"] for r in rows)
    h = [r for r in rows if r["arm"] == "haiku-5-5"]
    h_agree = sum(r["human_label"] == r["judge_label"] for r in h)
    click.echo(f"agreement {agree}/{len(rows)}; on haiku-5-5 {h_agree}/{len(h)}")


if __name__ == "__main__":
    cli()
```

- [ ] **Step 2: Sample**

Run: `uv run python scripts/ask_eval/spotcheck.py sample`

- [ ] **Step 3: STOP — the user labels**

Ask the user to fill in `human_label` (`faithful` / `unsupported` / `non-answer`) for all 20 rows in `results/spotcheck.jsonl`, *without* looking at `judge_label` first if they can manage it. Wait for them.

- [ ] **Step 4: Score**

Run: `uv run python scripts/ask_eval/spotcheck.py score`
Expected: `agreement X/20; on haiku-5-5 Y/5`. If X < 15, tell the user before writing any conclusions: the judge isn't trustworthy enough, and the judge instructions need revisiting.

- [ ] **Step 5: Commit**

```bash
git add scripts/ask_eval/spotcheck.py scripts/ask_eval/results/spotcheck.jsonl
git commit -m "Ask eval: human spot check of judge labels"
```

---

### Task 12: Report

**Files:**
- Create: `scripts/ask_eval/report.py`
- Output: `scripts/ask_eval/results/report.md`

- [ ] **Step 1: Look up the GPU price**

Find the current on-demand hourly price of the cheapest single cloud GPU that can serve Gemma 4 E2B (e.g. an L4 or T4 class card) on a mainstream provider's pricing page. Record the price **and the URL** in the results doc. For traffic, ask the user for a realistic monthly `/ask/` question count (GA4 search usage is the best proxy); if they have none, use 1,000/month and say so.

- [ ] **Step 2: Write the report CLI**

```python
# scripts/ask_eval/report.py
"""Aggregate all results into results/report.md (tables the results doc and post quote)."""

import json
import statistics
from pathlib import Path

import click

from ask_eval.report_lib import (
    ANSWERABLE,
    arm_summary,
    choose_models,
    choose_threshold,
    cost_per_1k_always_on_gpu,
    cost_per_1k_hosted,
)

HERE = Path(__file__).parent
HAIKU_IN, HAIKU_OUT = 0.10, 0.50  # USD per 1M tokens, Claude Haiku 5.5


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


@click.command()
@click.option("--gpu-hourly-usd", type=float, required=True)
@click.option("--questions-per-month", type=int, required=True)
@click.option("--max-neg-pass", type=float, default=0.10, show_default=True)
@click.option("--bar", type=float, default=0.75, show_default=True)
@click.option("--max-mb", type=int, default=350, show_default=True)
def main(gpu_hourly_usd, questions_per_month, max_neg_pass, bar, max_mb):
    prompts = load(HERE / "results/prompts.jsonl")
    judged = load(HERE / "results/judgements.jsonl")
    cands = {c["arm"]: c for c in json.loads((HERE / "candidates.json").read_text())}
    runs = {p.stem: load(p) for p in (HERE / "results/local").glob("*.jsonl")}
    hosted = load(HERE / "results/hosted/haiku-5-5.jsonl")
    runs["haiku-5-5"] = hosted

    pos = [p["best_score"] for p in prompts if p["family"] in ANSWERABLE]
    neg = [p["best_score"] for p in prompts if p["family"] == "negative"]
    t = choose_threshold(pos, neg, max_neg_pass)
    lines = [
        "# /ask/ eval report",
        "",
        f"Retrieval hit@4 (answerable): {sum(p['retrieval_hit'] for p in prompts if p['family'] in ANSWERABLE)}/{len(pos)}",
        f"Gate threshold: {t:.3f}; negatives passing: {sum(s >= t for s in neg)}/{len(neg)}; "
        f"answerable rejected: {sum(s < t for s in pos)}/{len(pos)}",
        "",
        "| arm | tier | download MB | faithful | unsupported | non-answer | negatives unsupported (ungated) | median TTFT ms (CPU) | median tok/s (CPU) | USD / 1k questions |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    table = []
    for arm, rows in sorted(runs.items()):
        s = arm_summary([j for j in judged if j["arm"] == arm])
        c = cands.get(arm, {"tier": "hosted", "download_mb": 0})
        if arm == "haiku-5-5":
            cost = cost_per_1k_hosted(rows, HAIKU_IN, HAIKU_OUT)
            ttft = statistics.median(r["latency_ms"] for r in rows)
            toks = "n/a"
        else:
            cost = cost_per_1k_always_on_gpu(gpu_hourly_usd, questions_per_month) if c["tier"] == "large" else 0.0
            ttft = statistics.median(r["ttft_ms"] for r in rows)
            rates = [r["tok_s"] for r in rows if r["tok_s"]]
            toks = statistics.median(rates) if rates else "n/a"
        table.append({"arm": arm, "tier": c["tier"], "download_mb": c["download_mb"], **s})
        lines.append(
            f"| {arm} | {c['tier']} | {c['download_mb']} | {s['faithful']:.0%} | {s['unsupported']:.0%} | "
            f"{s['non_answer']:.0%} | {s['negative_unsupported_ungated']:.0%} | {ttft} | {toks} | ${cost:.2f} |"
        )
    picks = choose_models(table, bar=bar, max_mb=max_mb)
    lines += ["", f"Shipped models: small = {picks['small']}, better = {picks['better']}",
              f"(bar {bar:.0%} faithful, max {max_mb} MB; hosted latency is end-to-end incl. network)", ""]
    (HERE / "results/report.md").write_text("\n".join(lines))
    click.echo("\n".join(lines))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it**

Run: `uv run python scripts/ask_eval/report.py --gpu-hourly-usd <price from Step 1> --questions-per-month <number from Step 1>`
Expected: the markdown table printed and written to `results/report.md`, ending with a `Shipped models:` line.

- [ ] **Step 4: Commit**

```bash
git add scripts/ask_eval/report.py scripts/ask_eval/results/report.md
git commit -m "Ask eval: report with gate threshold, model picks and cost/quality table"
```

---

### Task 13: Results doc

**Files:**
- Create: `docs/superpowers/specs/2026-10-12-ask-my-blog-results.md`

- [ ] **Step 1: Write it**

Follow the structure of `docs/superpowers/specs/2026-07-08-browser-semantic-search-results.md`. It must contain:

1. **Decisions**: shipped model(s) with repo id + dtype + download MB; gate threshold value. Part 2 reads these.
2. **Feasibility**: every candidate and its status/notes from `candidates.json` (including dropped ones and why).
3. **The table** from `results/report.md`.
4. **Retrieval**: hit@4 and which answerable questions missed (retrieval failures vs model failures).
5. **Cost/quality answer**: in plain words, what Gemma 4 E2B and Haiku 5.5 buy over the shipped model, and at what price (GPU price + URL + traffic assumption).
6. **Examples for the post**: 3 good summaries, 3 unsupported ones, and 2 negatives where the ungated model made something up (copy them verbatim from the JSONL).
7. **Honesty caveats**: the question set was generated by Claude and reviewed by a human; the judge is Claude (Opus 5.5) and agreed with the human on X/20 (Y/5 on Haiku); Haiku isn't greedy (temperature can't be set); local numbers are CPU-in-Node, and browser WebGPU/WASM numbers come in Part 3.

- [ ] **Step 2: STOP — user review**

Show the user the decisions section and wait for confirmation before committing. Part 2 is built on these choices.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-ask-my-blog-results.md
git commit -m "Ask eval: results and model decisions"
```

---

## Done when

- `node --test` and `uv run pytest tests/ask_eval -v` are green.
- `results/` holds prompts, every arm's runs, judgements, spot check, and report.
- The results doc names the shipped model(s) and the gate threshold, and the user has approved it.
