# Ask My Blog, Part 2: The `/ask/` Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **HARD RULES for every subagent:**
> - **Never pass `--active` to any `uv` command.**
> - `public/` is a **git submodule**. Never `git add`/commit inside it; never build with `--cleanDestinationDir`. Build with plain `hugo` or run `hugo server`.
> - Do not modify `assets/js/semantic/`, `static/search/`, or the existing parity tests in `tests/js/`. `node --test` (no path argument) must stay green.
> - Use `pnpm` (not npm). No Claude attribution lines in commits. If a commit is blocked by a permission check, report it and stop.
> - Never deploy (`deploy.sh`). Part 3 ships the page together with the post.

**Goal:** A working `/ask/` page: a reader picks a model (Qwen3-0.6B by default, three labelled demonstrators), downloads it on an explicit click with an accurate progress bar, and gets the blog's own passages plus a streamed ≤2-sentence summary generated in their browser.

**Spec:** `docs/superpowers/specs/2026-10-12-ask-my-blog-design.md` (Decisions, Page and load flow, Question → summary pipeline, Loading UX).
**Results:** `docs/superpowers/specs/2026-10-12-ask-my-blog-results.md` (models, revisions, gate 0.45, notes for Part 2).

**Architecture:** Pure, tested ES modules (`retrieve.js`, `prompt.js`, `display.js`, `progress.js`, `models.js`) hold every rule and number. A module Web Worker (`worker.js`) owns transformers.js (loaded from jsDelivr at runtime, pinned version), model loading, the on-load benchmark and streaming generation. `page.js` owns the DOM and talks to the worker by `postMessage`. Hugo builds both with `js.Build`; `content/ask.md` + `layouts/_default/ask.html` mount it.

**Tech Stack:** transformers.js 4.3.1 (ONNX Runtime Web; WebGPU / WASM), Hugo 0.155 `js.Build`, PaperMod CSS variables, `node --test`, Playwright (headless Chromium, already in `~/Library/Caches/ms-playwright`) for end-to-end checks.

## Decisions made while planning (confirm with the author before Task 2)

1. **Stop at two sentences.** The worker interrupts generation once the streamed text holds two complete sentences, and the page shows only those. Answers in the eval routinely ran past two sentences; this only removes text, so faithfulness can't get worse, and it saves generation time. (A "Show full answer" toggle is YAGNI.)
2. **`/ask/` is `noindex`, unlisted and out of the sitemap.** It's a thin interactive page; during the de-indexing recovery we don't want thin pages in the index. The post links to it.
3. **`scoreQuery` moves into `assets/js/ask/retrieve.js`** so the browser and the eval share it; `scripts/ask_eval/node_index.mjs` re-exports it.
4. **Backend choice:** WebGPU when the adapter has `shader-f16`, otherwise WASM. The dtype per backend is whatever Task 1 proves works.

---

## File map

| File | Responsibility |
|---|---|
| `assets/js/ask/retrieve.js` (modify) | + `scoreQuery(idx, query)` |
| `scripts/ask_eval/node_index.mjs` (modify) | re-export `scoreQuery` instead of its own copy |
| `assets/js/ask/prompt.js` (modify) | + `GATE_THRESHOLD`, `MAX_SENTENCES`, `passesGate(top)` |
| `assets/js/ask/display.js` (new) | `stripLeadingMarkers`, `clampSentences`, `formatAnswer` |
| `assets/js/ask/progress.js` (new) | `DownloadProgress` (known totals, ETA), `formatEta`, `tileCount` |
| `assets/js/ask/models.js` (new) | model registry (repo, revision, dtype, files, eval numbers), `fileUrl`, `totalBytes`, `CACHE_NAME` |
| `assets/js/ask/worker.js` (new) | transformers.js, load + progress, benchmark, generate/stop |
| `assets/js/ask/page.js` (new) | capability probe, model cards, progress UI, Q&A, sources, stop/switch/delete |
| `layouts/_default/ask.html` (new) | mounts the app, builds both bundles |
| `content/ask.md` (new) | title, intro copy, noindex/unlisted front matter |
| `assets/css/extended/custom.css` (modify) | `/ask/` styles (append a section) |
| `layouts/index.html` (modify) | "Ask a question instead →" link under the search box |
| `tests/js/ask-*.test.mjs` | unit tests for the pure modules |
| `tests/e2e/ask.e2e.mjs` (new) | Playwright end-to-end check (run explicitly, not by `node --test`) |

---

### Task 1: Browser spike — prove the runtime assumptions (STOP gate)

Nothing in Part 1 ran in a real browser. Before building on them, verify five things with a throwaway page **in the scratchpad, never in the repo**.

**Files:** none in the repo. Scratch: `<scratchpad>/spike/index.html`.

- [ ] **Step 1: Write the spike page**

```html
<!doctype html>
<meta charset="utf-8">
<title>ask spike</title>
<pre id="log"></pre>
<button id="go-wasm">WASM</button> <button id="go-webgpu">WebGPU</button>
<script type="module">
const TF = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm";
const M = { repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "1e0a4a196ecabdf9a879664110574563d3f372d3" };
const log = (...a) => { document.getElementById("log").textContent += a.join(" ") + "\n"; console.log(...a); };
window.spike = async (device, dtype) => {
  const tf = await import(TF);
  log("transformers", tf.env.version, "device", device, "dtype", dtype);
  if (navigator.gpu) {
    const ad = await navigator.gpu.requestAdapter();
    log("webgpu adapter", !!ad, "shader-f16", ad ? ad.features.has("shader-f16") : "n/a");
  }
  const files = new Set();
  const t0 = performance.now();
  const gen = await tf.pipeline("text-generation", M.repo, {
    revision: M.revision, dtype, device,
    progress_callback: (e) => { if (e.status === "done") files.add(e.file); },
  });
  log("loaded in", Math.round(performance.now() - t0), "ms; files", [...files].join(","));
  const stop = new tf.InterruptableStoppingCriteria();
  let n = 0, first = null;
  const t1 = performance.now();
  const streamer = new tf.TextStreamer(gen.tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: () => {},
    token_callback_function: () => { n++; if (first === null) first = performance.now(); if (n === 20) stop.interrupt(); },
  });
  const out = await gen([{ role: "user", content: "Name three fruits." }], {
    max_new_tokens: 60, do_sample: false, repetition_penalty: 1.15,
    tokenizer_encode_kwargs: { enable_thinking: false }, streamer, stopping_criteria: stop,
  });
  const t2 = performance.now();
  log("tokens", n, "(interrupt at 20 worked:", n <= 21, ") ttft", Math.round(first - t1), "ms tok/s", ((n - 1) / ((t2 - first) / 1000)).toFixed(1));
  log("reply", JSON.stringify(out[0].generated_text.at(-1).content));
  const names = await caches.keys();
  log("cache names", names.join(","));
  for (const name of names) {
    const keys = await (await caches.open(name)).keys();
    log("cache", name, "keys", keys.slice(0, 8).map((r) => r.url).join(" | "));
  }
  log("crossOriginIsolated", self.crossOriginIsolated, "hardwareConcurrency", navigator.hardwareConcurrency);
  log("DONE");
};
document.getElementById("go-wasm").onclick = () => spike("wasm", "q4f16").catch((e) => log("ERROR", e.message));
document.getElementById("go-webgpu").onclick = () => spike("webgpu", "q4f16").catch((e) => log("ERROR", e.message));
</script>
```

Serve it: `python3 -m http.server 8765 --directory <scratchpad>/spike` (background).

- [ ] **Step 2: WASM in headless Chromium**

Install Playwright in the scratchpad (`cd <scratchpad> && pnpm init -y && pnpm add playwright`), then run a script that opens `http://localhost:8765/`, calls `await page.evaluate(() => spike("wasm", "q4f16"))` with a 15-minute timeout, and prints the `#log` text. If q4f16 fails on WASM, rerun with `"q4"` and record both.

- [ ] **Step 3: WebGPU in a real Chrome (controller does this, not a subagent)**

Headless Chromium usually has no WebGPU. The controller opens `http://localhost:8765/` in the author's Chrome with the claude-in-chrome tools, clicks **WebGPU**, and reads `#log`. If the adapter lacks `shader-f16`, rerun with `"q4"`.

- [ ] **Step 4: Record and decide**

Write `<scratchpad>/spike/RESULTS.md` with, per backend: dtype that worked, load time, TTFT, tok/s, whether `interrupt()` stopped generation at ~20 tokens, the exact `files` list, the cache name(s) and the exact cache key URL format, `crossOriginIsolated`, and whether `generated_text.at(-1).content` held the reply.

**STOP — report to the author.** The constants below depend on it:

| constant (used in later tasks) | expected | if the spike says otherwise |
|---|---|---|
| `TRANSFORMERS_URL` | `…@4.3.1/+esm` | use the URL that worked |
| `WASM_DTYPE` | `q4f16` | if only `q4` works on WASM: WASM loads a different, larger file set (not in `models.js`) → **ask the author** whether no-WebGPU readers get q4 (and a second size table) or sources-only |
| `CACHE_NAME` | `transformers-cache` | use the observed name |
| cache key format | `https://huggingface.co/<repo>/resolve/<revision>/<path>` | update `fileUrl` |
| early stop | `InterruptableStoppingCriteria` via `stopping_criteria` | ask before inventing a workaround |

WASM will be single-threaded (`crossOriginIsolated` is false on GitHub Pages: no COOP/COEP headers). Record the tok/s; the page labels WASM "slower mode" regardless.

---

### Task 2: Share `scoreQuery`; gate and sentence constants

**Files:**
- Modify: `assets/js/ask/retrieve.js`, `scripts/ask_eval/node_index.mjs`, `assets/js/ask/prompt.js`
- Test: `tests/js/ask-retrieve.test.mjs`, `tests/js/ask-prompt.test.mjs`

- [ ] **Step 1: Failing tests**

Append to `tests/js/ask-retrieve.test.mjs` (add `scoreQuery` to the existing import from `retrieve.js`):

```js
import { loadIndexFromDisk } from "../../scripts/ask_eval/node_index.mjs";

test("scoreQuery returns one score per chunk and ranks the bloom post first", () => {
  const idx = loadIndexFromDisk();
  const scores = scoreQuery(idx, "how do bloom filters work");
  assert.equal(scores.length, idx.chunks.length);
  const top = topChunks(scores, idx.chunks, 1)[0];
  assert.match(top.chunk.post, /bloom/);
  assert.ok(top.score > 0.4);
});

test("scoreQuery on an empty query returns all zeros", () => {
  const idx = loadIndexFromDisk();
  const scores = scoreQuery(idx, "");
  assert.ok(scores.every((s) => s === 0));
});
```

Append to `tests/js/ask-prompt.test.mjs` (extend the import with `GATE_THRESHOLD, MAX_SENTENCES, passesGate`):

```js
test("gate constants match the results doc", () => {
  assert.equal(GATE_THRESHOLD, 0.45);
  assert.equal(MAX_SENTENCES, 2);
});

test("passesGate needs at least one passage scoring >= threshold", () => {
  assert.equal(passesGate([]), false);
  assert.equal(passesGate([{ score: 0.449 }]), false);
  assert.equal(passesGate([{ score: 0.45 }]), true);
  assert.equal(passesGate([{ score: 0.7 }, { score: 0.1 }]), true);
});
```

- [ ] **Step 2: Run `node --test`** — expect the new tests to fail (missing exports).

- [ ] **Step 3: Implement**

In `assets/js/ask/retrieve.js`, replace the "Zero imports" sentence in the header with "Imports only the sibling semantic-search modules (no third-party code)." and add:

```js
import { embedQuery } from "../semantic/embed.js";
import { cosineScores } from "../semantic/search.js";

/**
 * Cosine score of `query` against every chunk. `idx` is what
 * `assets/js/semantic/index.js` `loadIndex()` returns (or the eval's
 * on-disk equivalent): {manifest, docs, tokens, scales, chunks, wp}.
 * @returns {Float32Array} all zeros for an empty or fully out-of-vocabulary query
 */
export function scoreQuery(idx, query) {
  const ids = idx.wp.encode(query);
  const { dims, n_chunks } = idx.manifest;
  if (ids.length === 0) return new Float32Array(n_chunks);
  return cosineScores(embedQuery(ids, idx.tokens, idx.scales, dims), idx.docs, n_chunks, dims);
}
```

In `scripts/ask_eval/node_index.mjs`, delete its `scoreQuery` function and the now-unused `embedQuery` / `cosineScores` imports, and add `export { scoreQuery } from "../../assets/js/ask/retrieve.js";`.

In `assets/js/ask/prompt.js`, after `REPETITION_PENALTY`:

```js
// Best-chunk cosine below this: don't call the model at all. Chosen in the
// eval (results doc §3): blocks clearly off-topic questions only; near-miss
// questions score like answerable ones and still reach the model.
export const GATE_THRESHOLD = 0.45;
// The system prompt asks for at most 2 sentences; the worker stops there.
export const MAX_SENTENCES = 2;

/** @param {Array<{score: number}>} top - topChunks() output, best first */
export function passesGate(top) {
  return top.length > 0 && top[0].score >= GATE_THRESHOLD;
}
```

- [ ] **Step 4: `node --test`** — all pass. Also run `node scripts/ask_eval/build_prompts.mjs` and confirm `git diff --stat scripts/ask_eval/results/prompts.jsonl` shows **no change** (the refactor must not move a single score).

- [ ] **Step 5: Commit** — `git add assets/js/ask/retrieve.js assets/js/ask/prompt.js scripts/ask_eval/node_index.mjs tests/js/ask-retrieve.test.mjs tests/js/ask-prompt.test.mjs && git commit -m "Ask: share scoreQuery with the browser; add gate and sentence constants"`

---

### Task 3: `display.js` — clean and clamp answers

**Files:** Create `assets/js/ask/display.js`; Test `tests/js/ask-display.test.mjs`

- [ ] **Step 1: Failing tests**

```js
// tests/js/ask-display.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripLeadingMarkers, clampSentences, formatAnswer } from "../../assets/js/ask/display.js";

test("strips leading passage markers only", () => {
  assert.equal(stripLeadingMarkers("[3] Bloom filters use bits."), "Bloom filters use bits.");
  assert.equal(stripLeadingMarkers("[1] [2] Text"), "Text");
  assert.equal(stripLeadingMarkers("Text with [1] inside"), "Text with [1] inside");
});

test("clampSentences counts sentence ends followed by whitespace", () => {
  const t = "First one. Second one! Third one?";
  assert.deepEqual(clampSentences(t, 2, false), { text: "First one. Second one!", complete: true });
});

test("streaming: a trailing period is not yet a sentence end", () => {
  assert.equal(clampSentences("It needs version 3.", 1, false).complete, false);
  assert.equal(clampSentences("It needs version 3.5 now. Next", 1, false).text, "It needs version 3.5 now.");
});

test("final: end of text counts as a sentence end", () => {
  assert.deepEqual(clampSentences("Only one.", 2, true), { text: "Only one.", complete: false });
  assert.equal(clampSentences("One. Two.", 2, true).complete, true);
});

test("abbreviations and list numbers are not sentence ends", () => {
  const t = "Use a filter, e.g. a Bloom filter, for sets. Done. More.";
  assert.equal(clampSentences(t, 2, false).text, "Use a filter, e.g. a Bloom filter, for sets. Done.");
  const list = "Steps:\n1. Add the XML file. 2. Refresh the page. 3. Done.";
  assert.equal(clampSentences(list, 2, false).text, "Steps:\n1. Add the XML file. 2. Refresh the page.");
});

test("formatAnswer strips markers, trims, clamps (final)", () => {
  assert.equal(formatAnswer("  [1] A. B. C.  ", 2), "A. B.");
  assert.equal(formatAnswer("No terminal punctuation", 2), "No terminal punctuation");
});
```

- [ ] **Step 2: `node --test`** — fails (module not found).

- [ ] **Step 3: Implement**

```js
// assets/js/ask/display.js
/**
 * Post-processing for generated answers. The eval found small models emit
 * leading passage markers ("[3] ...") and run past the requested two
 * sentences; the worker uses clampSentences() to stop generating early and
 * the page shows formatAnswer(). Zero imports.
 */

const ABBREVIATION = /(?:\b(?:e\.g|i\.e|etc|vs|cf|approx|Mr|Mrs|Dr)\.)$/i;
const LIST_NUMBER = /(?:^|\s)\d+\.$/;

export function stripLeadingMarkers(text) {
  return text.replace(/^\s*(?:\[\d+\]\s*)+/, "");
}

/**
 * Cut `text` after its `n`th sentence.
 * @param {boolean} final - true when generation has finished: end of text then
 *   counts as a sentence end. While streaming, a "." with nothing after it may
 *   still become "3.5", so it doesn't count yet.
 * @returns {{text: string, complete: boolean}} complete = n sentences found
 */
export function clampSentences(text, n, final) {
  const re = final ? /[.!?](?=\s|$)/g : /[.!?](?=\s)/g;
  let count = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const upto = text.slice(0, m.index + 1);
    if (ABBREVIATION.test(upto) || LIST_NUMBER.test(upto)) continue;
    count++;
    if (count === n) return { text: upto, complete: true };
  }
  return { text, complete: false };
}

export function formatAnswer(raw, n) {
  return clampSentences(stripLeadingMarkers(raw).trim(), n, true).text;
}
```

- [ ] **Step 4: `node --test`** — all pass.
- [ ] **Step 5: Commit** — `git add assets/js/ask/display.js tests/js/ask-display.test.mjs && git commit -m "Ask: answer post-processing (strip markers, clamp to two sentences)"`

---

### Task 4: `progress.js` — download progress with known totals

**Files:** Create `assets/js/ask/progress.js`; Test `tests/js/ask-progress.test.mjs`

- [ ] **Step 1: Failing tests**

```js
// tests/js/ask-progress.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DownloadProgress, formatEta, tileCount } from "../../assets/js/ask/progress.js";

const files = [
  { path: "config.json", bytes: 1000 },
  { path: "onnx/model_q4f16.onnx", bytes: 99000 },
];

function clock() { let t = 0; const now = () => t; now.advance = (ms) => { t += ms; }; return now; }

test("total is known before any event", () => {
  const p = new DownloadProgress(files, clock());
  assert.equal(p.total, 100000);
  assert.equal(p.fraction, 0);
});

test("per-file loaded is clamped, monotonic, and unknown files are ignored", () => {
  const p = new DownloadProgress(files, clock());
  p.update("onnx/model_q4f16.onnx", 50000);
  p.update("onnx/model_q4f16.onnx", 40000); // out-of-order event
  p.update("onnx/model_q4f16.onnx", 999999); // over-report
  p.update("tokenizer.json", 5000); // not in the list
  assert.equal(p.loadedBytes, 99000);
});

test("complete() fills a file (cache hits report no bytes)", () => {
  const p = new DownloadProgress(files, clock());
  p.complete("config.json");
  p.complete("onnx/model_q4f16.onnx");
  assert.equal(p.fraction, 1);
});

test("ETA from a smoothed rate", () => {
  const now = clock();
  const p = new DownloadProgress(files, now);
  p.update("onnx/model_q4f16.onnx", 0);
  now.advance(1000);
  p.update("onnx/model_q4f16.onnx", 10000); // 10 kB/s
  assert.ok(Math.abs(p.etaSeconds - 9) < 0.01); // 90 kB left
  assert.equal(p.label(), "0 / 0 MB · 10% · ~9 s left");
});

test("label omits ETA when done or unknown", () => {
  const p = new DownloadProgress([{ path: "a", bytes: 579000000 }], clock());
  p.update("a", 212000000);
  assert.equal(p.label(), "212 / 579 MB · 36%");
});

test("formatEta and tileCount", () => {
  assert.equal(formatEta(0.2), "1 s");
  assert.equal(formatEta(42), "42 s");
  assert.equal(formatEta(150), "3 min");
  assert.equal(tileCount(578918281), 145);
  assert.equal(tileCount(1), 1);
});
```

- [ ] **Step 2: `node --test`** — fails.

- [ ] **Step 3: Implement**

```js
// assets/js/ask/progress.js
/**
 * Download progress for /ask/. The total comes from the model registry
 * (pinned file list + byte sizes), so the bar is accurate from the first
 * byte instead of growing as transformers.js discovers files. Zero imports.
 */

const MIN_SAMPLE_MS = 250;
const SMOOTHING = 0.3; // weight of the newest rate sample
export const TILE_BYTES = 4e6;

export function formatEta(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  return `${Math.round(seconds / 60)} min`;
}

/** Number of model-map tiles for a download of `bytes` (one per 4 MB). */
export function tileCount(bytes) {
  return Math.max(1, Math.ceil(bytes / TILE_BYTES));
}

export class DownloadProgress {
  /** @param {Array<{path: string, bytes: number}>} files */
  constructor(files, now = () => performance.now()) {
    this.sizes = new Map(files.map((f) => [f.path, f.bytes]));
    this.total = files.reduce((sum, f) => sum + f.bytes, 0);
    this.loaded = new Map();
    this.now = now;
    this.rate = null; // bytes per second, smoothed
    this.last = null;
  }

  update(path, loaded) {
    if (!this.sizes.has(path)) return;
    const prev = this.loaded.get(path) ?? 0;
    this.loaded.set(path, Math.min(Math.max(prev, loaded), this.sizes.get(path)));
    this.sample();
  }

  complete(path) {
    if (!this.sizes.has(path)) return;
    this.loaded.set(path, this.sizes.get(path));
    this.sample();
  }

  get loadedBytes() {
    let sum = 0;
    for (const v of this.loaded.values()) sum += v;
    return sum;
  }

  get fraction() {
    return this.total ? this.loadedBytes / this.total : 0;
  }

  get etaSeconds() {
    if (!this.rate || this.rate <= 0) return null;
    return (this.total - this.loadedBytes) / this.rate;
  }

  sample() {
    const t = this.now();
    const b = this.loadedBytes;
    if (this.last === null) {
      this.last = { t, b };
      return;
    }
    const dt = t - this.last.t;
    if (dt < MIN_SAMPLE_MS) return;
    const instant = ((b - this.last.b) / dt) * 1000;
    this.rate = this.rate === null ? instant : (1 - SMOOTHING) * this.rate + SMOOTHING * instant;
    this.last = { t, b };
  }

  label() {
    const mb = (x) => Math.round(x / 1e6);
    const pct = Math.floor(this.fraction * 100);
    const eta = this.etaSeconds;
    const tail = eta !== null && pct < 100 ? ` · ~${formatEta(eta)} left` : "";
    return `${mb(this.loadedBytes)} / ${mb(this.total)} MB · ${pct}%${tail}`;
  }
}
```

- [ ] **Step 4: `node --test`** — all pass.
- [ ] **Step 5: Commit** — `git add assets/js/ask/progress.js tests/js/ask-progress.test.mjs && git commit -m "Ask: download progress with known totals and smoothed ETA"`

---

### Task 5: `models.js` — the registry, guarded against drift

**Files:** Create `assets/js/ask/models.js`; Test `tests/js/ask-models.test.mjs`

- [ ] **Step 1: Failing test** (the registry must match the eval's `candidates.json` exactly)

```js
// tests/js/ask-models.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODELS, DEFAULT_MODEL_ID, totalBytes, fileUrl } from "../../assets/js/ask/models.js";

const candidates = JSON.parse(readFileSync(new URL("../../scripts/ask_eval/candidates.json", import.meta.url), "utf8"));
const byArm = new Map(candidates.map((c) => [c.arm, c]));

test("registry matches the evaluated candidates (repo, revision, dtype, files)", () => {
  for (const m of MODELS) {
    const c = byArm.get(m.id);
    assert.ok(c, `${m.id} missing from candidates.json`);
    assert.equal(m.repo, c.repo);
    assert.equal(m.revision, c.revision);
    assert.equal(m.dtype, c.dtype);
    assert.deepEqual(m.files, c.files);
    assert.equal(totalBytes(m), c.total_bytes);
  }
});

test("one default, three demonstrators, default first", () => {
  assert.equal(MODELS[0].id, DEFAULT_MODEL_ID);
  assert.equal(MODELS.filter((m) => m.role === "default").length, 1);
  assert.equal(MODELS.filter((m) => m.role === "demo").length, 3);
});

test("fileUrl pins the revision", () => {
  const m = MODELS[0];
  assert.equal(fileUrl(m, "config.json"), `https://huggingface.co/${m.repo}/resolve/${m.revision}/config.json`);
});
```

- [ ] **Step 2: `node --test`** — fails.

- [ ] **Step 3: Implement** (copy `files` and revisions from `scripts/ask_eval/candidates.json`; the test enforces it; eval numbers from the results doc §3)

```js
// assets/js/ask/models.js
/**
 * Models offered on /ask/. Pinned to the exact Hugging Face revisions and
 * files the eval measured (scripts/ask_eval/candidates.json; a test keeps
 * them in sync). `faithful` / `invented` are the eval's numbers, shown on
 * the model cards. Zero imports.
 */

export const DEFAULT_MODEL_ID = "qwen3-0.6b";
export const CACHE_NAME = "transformers-cache"; // confirmed in Part 2 Task 1

export const MODELS = [
  {
    id: "qwen3-0.6b", name: "Qwen3-0.6B", role: "default", params: "0.6B",
    repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "1e0a4a196ecabdf9a879664110574563d3f372d3", dtype: "q4f16",
    faithful: 15, invented: 5,
    files: [
      { path: "config.json", bytes: 912 },
      { path: "generation_config.json", bytes: 219 },
      { path: "onnx/model_q4f16.onnx", bytes: 569789750 },
      { path: "tokenizer.json", bytes: 9117040 },
      { path: "tokenizer_config.json", bytes: 10360 },
    ],
  },
  {
    id: "smollm2-360m", name: "SmolLM2-360M", role: "demo", params: "360M",
    repo: "HuggingFaceTB/SmolLM2-360M-Instruct", revision: "a10cc1512eabd3dde888204e902eca88bddb4951", dtype: "q4f16",
    faithful: 3, invented: 15,
    files: [
      { path: "config.json", bytes: 846 },
      { path: "generation_config.json", bytes: 132 },
      { path: "onnx/model_q4f16.onnx", bytes: 272737275 },
      { path: "tokenizer.json", bytes: 2104556 },
      { path: "tokenizer_config.json", bytes: 3764 },
    ],
  },
  {
    id: "gemma3-270m", name: "Gemma 3 270M", role: "demo", params: "270M",
    repo: "onnx-community/gemma-3-270m-it-ONNX", revision: "2dbbfdb1b59bd034eb959428c6a7da9dd7ea27f0", dtype: "q4f16",
    faithful: 3, invented: 13,
    files: [
      { path: "config.json", bytes: 1652 },
      { path: "generation_config.json", bytes: 202 },
      { path: "onnx/model_q4f16.onnx", bytes: 330717 },
      { path: "onnx/model_q4f16.onnx_data", bytes: 272626176 },
      { path: "tokenizer.json", bytes: 20323013 },
      { path: "tokenizer_config.json", bytes: 2313 },
    ],
  },
  {
    id: "lfm2.5-350m", name: "LFM2.5-350M", role: "demo", params: "350M",
    repo: "onnx-community/LFM2.5-350M-ONNX", revision: "7dd4999565b0342c381ba90a3d8fc467d6df19c4", dtype: "q4f16",
    faithful: 2, invented: 14,
    files: [
      { path: "config.json", bytes: 1443 },
      { path: "generation_config.json", bytes: 136 },
      { path: "onnx/model_q4f16.onnx", bytes: 182827 },
      { path: "onnx/model_q4f16.onnx_data", bytes: 254965760 },
      { path: "tokenizer.json", bytes: 3297793 },
      { path: "tokenizer_config.json", bytes: 3825 },
    ],
  },
];

export function totalBytes(model) {
  return model.files.reduce((sum, f) => sum + f.bytes, 0);
}

/** The URL transformers.js fetches (and caches under) for a pinned file. */
export function fileUrl(model, path) {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${path}`;
}

export function modelById(id) {
  return MODELS.find((m) => m.id === id);
}
```

If Task 1 found a different cache name or URL format, use those here.

- [ ] **Step 4: `node --test`** — all pass.
- [ ] **Step 5: Commit** — `git add assets/js/ask/models.js tests/js/ask-models.test.mjs && git commit -m "Ask: pinned model registry with eval numbers"`

---

### Task 6: `worker.js` — load, benchmark, generate

**Files:** Create `assets/js/ask/worker.js`. (No unit test: it needs a browser and a model. Covered by Task 9.)

Message protocol (page ⇄ worker):

| direction | message |
|---|---|
| page → worker | `{type: "load", model: {repo, revision, dtype}, device: "webgpu"\|"wasm"}` |
| page → worker | `{type: "generate", id, messages}` |
| page → worker | `{type: "stop"}` |
| worker → page | `{type: "progress", file, loaded}` · `{type: "file-done", file}` · `{type: "status", text}` |
| worker → page | `{type: "ready", device, bench: {ttft_ms, tok_s}}` |
| worker → page | `{type: "token", id, text, tokens, tok_s}` (text already cleaned + clamped) |
| worker → page | `{type: "done", id, text, tokens, ttft_ms, tok_s}` · `{type: "error", message, phase}` |

- [ ] **Step 1: Implement**

```js
// assets/js/ask/worker.js
/**
 * /ask/ model worker. Owns transformers.js (fetched from jsDelivr at
 * runtime, pinned), the loaded pipeline, the on-load benchmark and
 * streaming generation. Text it posts is already cleaned and clamped to
 * MAX_SENTENCES; it interrupts generation once that many sentences exist.
 */
import { MAX_NEW_TOKENS, MAX_SENTENCES, REPETITION_PENALTY } from "./prompt.js";
import { clampSentences, formatAnswer, stripLeadingMarkers } from "./display.js";

// Confirmed working in Part 2 Task 1. Kept in a variable so esbuild leaves
// the import() alone instead of trying to bundle a URL.
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm";
const BENCH_MESSAGES = [{ role: "user", content: "In one paragraph, explain what a search index is." }];
const BENCH_TOKENS = 64;

let tf = null;
let generator = null;
let stopper = null;

const post = (msg) => self.postMessage(msg);

async function lib() {
  if (!tf) tf = await import(TRANSFORMERS_URL);
  return tf;
}

async function generate(messages, maxNewTokens, onText) {
  const { TextStreamer, InterruptableStoppingCriteria } = await lib();
  stopper = new InterruptableStoppingCriteria();
  let text = "";
  let tokens = 0;
  let tFirst = null;
  const t0 = performance.now();
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: () => {
      tokens++;
      if (tFirst === null) tFirst = performance.now();
    },
    callback_function: (chunk) => {
      text += chunk;
      onText?.(text, tokens, tFirst);
    },
  });
  await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
    repetition_penalty: REPETITION_PENALTY,
    tokenizer_encode_kwargs: { enable_thinking: false }, // Qwen3; other templates ignore it
    streamer,
    stopping_criteria: stopper,
  });
  const t1 = performance.now();
  return {
    text,
    tokens,
    ttft_ms: Math.round((tFirst ?? t1) - t0),
    tok_s: tokens > 1 && tFirst !== null ? (tokens - 1) / ((t1 - tFirst) / 1000) : null,
  };
}

const rate = (tokens, tFirst) =>
  tokens > 1 && tFirst !== null ? (tokens - 1) / ((performance.now() - tFirst) / 1000) : null;

async function load({ model, device }) {
  const { pipeline } = await lib();
  generator = await pipeline("text-generation", model.repo, {
    revision: model.revision,
    dtype: model.dtype,
    device,
    progress_callback: (e) => {
      if (e.status === "progress") post({ type: "progress", file: e.file, loaded: e.loaded });
      else if (e.status === "done") post({ type: "file-done", file: e.file });
    },
  });
  post({ type: "status", text: "Warming up…" });
  await generate(BENCH_MESSAGES, 1); // untimed: compiles shaders / initialises kernels
  const bench = await generate(BENCH_MESSAGES, BENCH_TOKENS);
  post({ type: "ready", device, bench: { ttft_ms: bench.ttft_ms, tok_s: bench.tok_s } });
}

async function answer({ id, messages }) {
  const out = await generate(messages, MAX_NEW_TOKENS, (text, tokens, tFirst) => {
    const clamped = clampSentences(stripLeadingMarkers(text).trimStart(), MAX_SENTENCES, false);
    post({ type: "token", id, text: clamped.text, tokens, tok_s: rate(tokens, tFirst) });
    if (clamped.complete) stopper.interrupt();
  });
  post({ type: "done", id, text: formatAnswer(out.text, MAX_SENTENCES), tokens: out.tokens, ttft_ms: out.ttft_ms, tok_s: out.tok_s });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await load(data);
    else if (data.type === "generate") await answer(data);
    else if (data.type === "stop") stopper?.interrupt();
  } catch (e) {
    post({ type: "error", message: String(e?.message ?? e), phase: data.type });
  }
};
```

If Task 1 changed `TRANSFORMERS_URL` or the early-stop mechanism, apply that here.

- [ ] **Step 2: Bundle check** — `hugo` must still build (the worker isn't referenced yet, so instead run `pnpm dlx esbuild assets/js/ask/worker.js --bundle --format=esm --outfile=/dev/null` and expect no errors).
- [ ] **Step 3: Commit** — `git add assets/js/ask/worker.js && git commit -m "Ask: model worker (load, benchmark, streaming generation with early stop)"`

---

### Task 7: `page.js`, the template, the content page, and styles

**Files:**
- Create: `assets/js/ask/page.js`, `layouts/_default/ask.html`, `content/ask.md`
- Modify: `assets/css/extended/custom.css` (append), `layouts/index.html`

- [ ] **Step 1: `content/ask.md`**

```markdown
---
title: "Ask my blog"
layout: ask
description: "Ask a question about the blog; a small language model running in your browser answers from the posts themselves."
robotsNoIndex: true
build:
  list: never
sitemap:
  disable: true
---

Ask a question about anything I've written here. My search finds the most relevant passages, and a small language model running entirely in your browser summarises them in a sentence or two. Nothing you type leaves your machine.

Small models get things wrong, and I [measured how often](/). The passages it read are always shown underneath; trust those over the summary.

Loading a model downloads it once from Hugging Face (your browser keeps it for next time).
```

(The `(/)` link is a placeholder for the Part 3 post URL; Part 3 replaces it. Leave it pointing at the homepage until then.)

- [ ] **Step 2: `layouts/_default/ask.html`**

```html
{{- define "main" }}
<article class="post-single ask-page">
  <header class="post-header">
    <h1 class="post-title">{{ .Title }}</h1>
  </header>
  <div class="post-content">{{ .Content }}</div>
  {{- $build := dict "minify" true "target" "es2020" "format" "esm" -}}
  {{- $worker := resources.Get "js/ask/worker.js" | js.Build $build | fingerprint -}}
  {{- $app := resources.Get "js/ask/page.js" | js.Build $build | fingerprint -}}
  <div id="ask-app" data-worker="{{ $worker.RelPermalink }}">
    <noscript><p>This page needs JavaScript: the model runs in your browser.</p></noscript>
  </div>
  <script type="module" src="{{ $app.RelPermalink }}" integrity="{{ $app.Data.Integrity }}" data-cf-async="false"></script>
</article>
{{- end }}
```

- [ ] **Step 3: `assets/js/ask/page.js`**

```js
// assets/js/ask/page.js
/**
 * /ask/ page controller: capability probe, model cards, download progress,
 * question → sources → gated, streamed summary. All rules and numbers live
 * in the sibling pure modules; the model lives in worker.js.
 */
import { loadIndex } from "../semantic/index.js";
import { scoreQuery, topChunks } from "./retrieve.js";
import { TOP_K, buildMessages, passesGate } from "./prompt.js";
import { MODELS, CACHE_NAME, fileUrl, totalBytes, modelById } from "./models.js";
import { DownloadProgress, tileCount } from "./progress.js";

const WASM_DTYPE = "q4f16"; // confirmed in Part 2 Task 1
const root = document.getElementById("ask-app");
const WORKER_URL = root?.dataset.worker;

const state = { backend: null, model: null, worker: null, progress: null, busy: false, nextId: 1, currentId: null };

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
const $ = (sel) => root.querySelector(sel);

async function probe() {
  let webgpu = false;
  let f16 = false;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    webgpu = !!adapter;
    f16 = !!adapter?.features.has("shader-f16");
  } catch {
    /* no WebGPU */
  }
  const device = webgpu && f16 ? "webgpu" : "wasm";
  return { device, webgpu, f16, memoryGb: navigator.deviceMemory ?? null };
}

async function isCached(model) {
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const f of model.files) if (!(await cache.match(fileUrl(model, f.path)))) return false;
    return true;
  } catch {
    return false;
  }
}

function modelCard(m) {
  const stats = `In my eval: <strong>${m.faithful}/30</strong> faithful answers; made something up for <strong>${m.invented}/15</strong> questions the blog doesn't answer.`;
  return `
    <div class="ask-model" data-model="${m.id}">
      <div class="ask-model-head">
        <span class="ask-model-name">${esc(m.name)}</span>
        <span class="ask-model-size">${mb(totalBytes(m))}</span>
        <span class="ask-model-cached" hidden>Cached, loads instantly</span>
      </div>
      <p class="ask-model-stats">${stats}</p>
      <button type="button" class="ask-load" data-model="${m.id}">Load ${esc(m.name)} (${mb(totalBytes(m))})</button>
    </div>`;
}

function renderIdle(cap) {
  const def = MODELS.filter((m) => m.role === "default");
  const demos = MODELS.filter((m) => m.role === "demo");
  const backend =
    cap.device === "webgpu"
      ? "Your browser supports WebGPU: the model runs on your GPU."
      : "No WebGPU with 16-bit support here, so the model runs on your CPU (slower mode).";
  root.innerHTML = `
    <p class="ask-capability">${esc(backend)}${cap.memoryGb ? ` Device memory: ~${cap.memoryGb} GB.` : ""}</p>
    ${def.map(modelCard).join("")}
    <details class="ask-demos">
      <summary>See why size matters: three smaller models</summary>
      <p>These are smaller, but in my eval they were almost never faithful to the passages. Try one to see what that looks like.</p>
      ${demos.map(modelCard).join("")}
    </details>
    <p class="ask-manage"><button type="button" class="ask-delete">Delete downloaded models</button></p>
    <div class="ask-loading" hidden></div>
    <div class="ask-machine" hidden></div>
    <form class="ask-form" hidden>
      <input type="search" class="ask-input" placeholder="Ask a question about the blog…" autocomplete="off" required>
      <button type="submit" class="ask-submit">Ask</button>
      <button type="button" class="ask-stop" hidden>Stop</button>
      <button type="button" class="ask-switch">Switch model</button>
    </form>
    <div class="ask-answer" hidden></div>
    <ol class="ask-sources" hidden></ol>`;
  markCached();
}

async function markCached() {
  for (const m of MODELS) {
    const card = root.querySelector(`.ask-model[data-model="${m.id}"]`);
    if (card) card.querySelector(".ask-model-cached").hidden = !(await isCached(m));
  }
}

function renderLoading(model) {
  const tiles = tileCount(totalBytes(model));
  const box = $(".ask-loading");
  box.hidden = false;
  box.innerHTML = `
    <p class="ask-loading-title">Loading ${esc(model.name)} (${model.params} parameters)</p>
    <div class="ask-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="ask-progress-fill"></div>
    </div>
    <p class="ask-progress-label" aria-live="polite">Starting download…</p>
    <div class="ask-map" aria-hidden="true">${'<span class="ask-tile"></span>'.repeat(tiles)}</div>
    <p class="ask-error" hidden></p>`;
}

function paintProgress() {
  const p = state.progress;
  const pct = Math.floor(p.fraction * 100);
  $(".ask-progress").setAttribute("aria-valuenow", String(pct));
  $(".ask-progress-fill").style.width = `${pct}%`;
  $(".ask-progress-label").textContent = pct >= 100 ? "Preparing model…" : p.label();
  const tiles = root.querySelectorAll(".ask-tile");
  const filled = Math.floor(p.fraction * tiles.length);
  tiles.forEach((t, i) => t.classList.toggle("is-filled", i < filled));
}

function startWorker(model, device) {
  state.worker?.terminate();
  state.model = model;
  state.progress = new DownloadProgress(model.files);
  renderLoading(model);
  const worker = new Worker(WORKER_URL, { type: "module" });
  state.worker = worker;
  worker.onmessage = ({ data }) => onWorker(data, device);
  worker.onerror = (e) => showLoadError(e.message || "The model worker failed to start.", device);
  worker.postMessage({
    type: "load",
    model: { repo: model.repo, revision: model.revision, dtype: device === "wasm" ? WASM_DTYPE : model.dtype },
    device,
  });
}

function showLoadError(message, device) {
  const el = $(".ask-error");
  el.hidden = false;
  el.innerHTML = `Loading failed: ${esc(message)}
    <button type="button" class="ask-retry">Retry</button>
    ${device === "webgpu" ? '<button type="button" class="ask-retry-wasm">Try slower mode (CPU)</button>' : ""}`;
}

function onWorker(msg, device) {
  if (msg.type === "progress") {
    state.progress.update(msg.file, msg.loaded);
    paintProgress();
  } else if (msg.type === "file-done") {
    state.progress.complete(msg.file);
    paintProgress();
  } else if (msg.type === "status") {
    $(".ask-progress-label").textContent = msg.text;
  } else if (msg.type === "ready") {
    onReady(msg);
  } else if (msg.type === "token") {
    onToken(msg);
  } else if (msg.type === "done") {
    onDone(msg);
  } else if (msg.type === "error") {
    if (msg.phase === "load") showLoadError(msg.message, device);
    else onGenerateError(msg.message);
  }
}

function onReady({ device, bench }) {
  $(".ask-loading").hidden = true;
  const machine = $(".ask-machine");
  machine.hidden = false;
  const speed = bench.tok_s ? `${bench.tok_s.toFixed(1)} tokens/s` : "n/a";
  machine.innerHTML = `<strong>Your machine:</strong> ${esc(state.model.name)} on ${device === "webgpu" ? "WebGPU" : "CPU (WASM)"} · ${speed} · first token in ${bench.ttft_ms} ms`;
  $(".ask-form").hidden = false;
  root.querySelectorAll(".ask-model, .ask-demos, .ask-manage").forEach((el) => (el.hidden = true));
  $(".ask-input").focus();
  markCached();
}

function renderSources(top) {
  const list = $(".ask-sources");
  list.hidden = false;
  list.innerHTML = top
    .map(({ chunk }) => {
      const href = chunk.anchor ? `${chunk.href}#${chunk.anchor}` : chunk.href;
      const heading = chunk.heading ? ` · ${esc(chunk.heading)}` : "";
      return `<li class="ask-source"><a href="${esc(href)}">${esc(chunk.title)}${heading}</a><blockquote>${esc(chunk.snippet)}</blockquote></li>`;
    })
    .join("");
}

function setBusy(busy) {
  state.busy = busy;
  $(".ask-submit").disabled = busy;
  $(".ask-stop").hidden = !busy;
  $(".ask-switch").disabled = busy;
}

async function ask(question) {
  if (state.busy) return;
  setBusy(true);
  const answer = $(".ask-answer");
  answer.hidden = false;
  answer.innerHTML = '<p class="ask-searching">Searching the blog…</p>';
  const idx = await loadIndex();
  const top = topChunks(scoreQuery(idx, question), idx.chunks, TOP_K);
  renderSources(top);
  if (!passesGate(top)) {
    answer.innerHTML = `<p class="ask-notfound">I couldn't find this on the blog. These are the closest passages, but they probably don't answer it.</p>`;
    setBusy(false);
    return;
  }
  answer.innerHTML = `
    <p class="ask-label">Summary, generated by ${esc(state.model.name)} in your browser. It may be wrong; check the passages below.</p>
    <p class="ask-summary"><span class="ask-skeleton"></span><span class="ask-skeleton"></span></p>
    <p class="ask-meta">Reading ${top.length} passages…</p>`;
  $(".ask-sources").classList.add("is-reading");
  state.currentId = state.nextId++;
  state.worker.postMessage({ type: "generate", id: state.currentId, messages: buildMessages(question, top.map((t) => t.chunk)) });
}

function onToken({ id, text, tok_s }) {
  if (id !== state.currentId) return;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").innerHTML = `${esc(text)}<span class="ask-cursor" aria-hidden="true"></span>`;
  if (tok_s) $(".ask-meta").textContent = `${tok_s.toFixed(1)} tok/s · ${state.backendLabel}`;
}

function onDone({ id, text, tokens, ttft_ms, tok_s }) {
  if (id !== state.currentId) return;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").textContent = text || "(no answer)";
  const speed = tok_s ? ` · ${tok_s.toFixed(1)} tok/s` : "";
  $(".ask-meta").textContent = `${tokens} tokens · first token ${ttft_ms} ms${speed} · ${state.backendLabel}`;
  setBusy(false);
}

function onGenerateError(message) {
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").textContent = `Generating failed: ${message}. The passages below still answer from the blog itself.`;
  setBusy(false);
}

async function deleteModels() {
  await caches.delete(CACHE_NAME).catch(() => {});
  await markCached();
}

async function main() {
  if (!root || !WORKER_URL) return;
  const cap = await probe();
  state.backend = cap.device;
  state.backendLabel = cap.device === "webgpu" ? "WebGPU" : "CPU (WASM)";
  renderIdle(cap);
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.matches(".ask-load")) startWorker(modelById(t.dataset.model), state.backend);
    else if (t.matches(".ask-retry")) startWorker(state.model, state.backend);
    else if (t.matches(".ask-retry-wasm")) {
      state.backend = "wasm";
      state.backendLabel = "CPU (WASM)";
      startWorker(state.model, "wasm");
    } else if (t.matches(".ask-stop")) state.worker?.postMessage({ type: "stop" });
    else if (t.matches(".ask-switch")) {
      state.worker?.terminate();
      state.worker = null;
      renderIdle(cap);
    } else if (t.matches(".ask-delete")) deleteModels();
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $(".ask-input").value.trim();
    if (q) ask(q);
  });
}

main();
```

- [ ] **Step 4: Styles** — append to `assets/css/extended/custom.css`:

```css
/* ---------- /ask/ page ---------- */
.ask-capability, .ask-machine, .ask-meta, .ask-model-stats, .ask-label { font-size: 0.9rem; color: var(--secondary); }
.ask-model { border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin: 1rem 0; background: var(--entry); }
.ask-model-head { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
.ask-model-name { font-weight: 600; }
.ask-model-size, .ask-model-cached { font-size: 0.85rem; color: var(--secondary); }
.ask-model-cached { color: var(--primary); }
.ask-page button { border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.8rem; background: var(--theme); color: var(--primary); cursor: pointer; }
.ask-page button:disabled { opacity: 0.5; cursor: default; }
.ask-demos { margin: 1rem 0; }
.ask-demos summary { cursor: pointer; }

.ask-progress { height: 10px; border-radius: 5px; background: var(--border); overflow: hidden; }
.ask-progress-fill { height: 100%; width: 0; background: var(--primary); transition: width 0.2s linear; }
.ask-progress-label { font-variant-numeric: tabular-nums; font-size: 0.9rem; margin: 0.5rem 0; }
.ask-map { display: grid; grid-template-columns: repeat(auto-fill, minmax(10px, 1fr)); gap: 3px; margin: 0.75rem 0; }
.ask-tile { aspect-ratio: 1; border-radius: 2px; background: var(--border); transition: background 0.3s; }
.ask-tile.is-filled { background: var(--primary); }
.ask-error { color: #c0392b; }

.ask-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; }
.ask-input { flex: 1 1 16rem; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-radius: 8px; background: var(--entry); color: var(--primary); }
.ask-answer { border-left: 3px solid var(--primary); padding: 0.25rem 0 0.25rem 1rem; margin: 1rem 0; }
.ask-summary { font-size: 1.05rem; }
.ask-skeleton { display: block; height: 0.9em; margin: 0.4em 0; border-radius: 4px; background: var(--border); animation: ask-pulse 1.2s ease-in-out infinite; }
.ask-skeleton + .ask-skeleton { width: 60%; }
.ask-cursor { display: inline-block; width: 0.5em; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: var(--primary); animation: ask-blink 1s steps(1) infinite; }

.ask-sources { padding-left: 1.25rem; }
.ask-source { margin: 0.75rem 0; border-radius: 6px; }
.ask-source blockquote { font-size: 0.9rem; margin: 0.25rem 0 0; }
.ask-sources.is-reading .ask-source { background: linear-gradient(90deg, transparent 0%, var(--border) 50%, transparent 100%); background-size: 200% 100%; animation: ask-sweep 1.6s linear infinite; }
.ask-sources.is-reading .ask-source:nth-child(2) { animation-delay: 0.2s; }
.ask-sources.is-reading .ask-source:nth-child(3) { animation-delay: 0.4s; }
.ask-sources.is-reading .ask-source:nth-child(4) { animation-delay: 0.6s; }

@keyframes ask-pulse { 50% { opacity: 0.4; } }
@keyframes ask-blink { 50% { opacity: 0; } }
@keyframes ask-sweep { from { background-position: 100% 0; } to { background-position: -100% 0; } }

@media (prefers-reduced-motion: reduce) {
  .ask-map { display: none; }
  .ask-skeleton, .ask-cursor, .ask-sources.is-reading .ask-source { animation: none; }
  .ask-progress-fill, .ask-tile { transition: none; }
}
```

- [ ] **Step 5: Homepage link** — in `layouts/index.html`, directly after the `<div id="searchResults" …></div>` line inside `.search-container`, add:

```html
    <p class="ask-link" style="margin: 0.5rem 0 0; font-size: 0.9rem;"><a href="/ask/">Ask a question instead →</a></p>
```

- [ ] **Step 6: Build and smoke-check**

Run `hugo` (plain). Expect no errors. Then check:
- `public/ask/index.html` exists, contains `id="ask-app"` and a `data-worker="/js/ask/worker.min.<hash>.js"`-style path, and its `<meta name="robots"` is `noindex` (PaperMod only emits robots in production: run `HUGO_ENV=production hugo` into a temp dir with `--destination <scratchpad>/prodcheck` and grep there).
- `rg -c "/ask/" public/index.json public/index.xml public/sitemap.xml` reports **0** for all three.
- The homepage contains the "Ask a question instead" link.
- `node --test` still passes.

Do not commit anything under `public/`.

- [ ] **Step 7: Commit** — `git add assets/js/ask/page.js layouts/_default/ask.html content/ask.md assets/css/extended/custom.css layouts/index.html && git commit -m "Ask: /ask/ page, template, styles and homepage link"`

---

### Task 8: Code review checkpoint

Dispatch the code-quality reviewer on the Task 2–7 diff (pure modules, worker, page, template). Fix findings before the end-to-end run.

---

### Task 9: End-to-end check (Playwright WASM + real-Chrome WebGPU)

**Files:** Create `tests/e2e/ask.e2e.mjs`; Modify `package.json` (dev dependency).

- [ ] **Step 1: Add Playwright** — `pnpm add -D playwright` (the Chromium build is already in `~/Library/Caches/ms-playwright`; if Playwright asks for a different revision, run `pnpm exec playwright install chromium`).

- [ ] **Step 2: Write the script** (named `*.e2e.mjs` so `node --test` doesn't pick it up)

```js
// tests/e2e/ask.e2e.mjs
// Usage: hugo server --port 1314 (in another shell), then
//   BASE_URL=http://localhost:1314 MODEL=lfm2.5-350m node tests/e2e/ask.e2e.mjs
// Runs the /ask/ page end to end in headless Chromium (no WebGPU -> WASM path).
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:1314";
const MODEL = process.env.MODEL ?? "lfm2.5-350m"; // smallest offered download
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
await page.goto(`${BASE}/ask/`);

await page.waitForSelector(".ask-model");
assert.match(await page.textContent(".ask-capability"), /slower mode|WebGPU/);
await page.click("summary");
await page.click(`.ask-load[data-model="${MODEL}"]`);
await page.waitForSelector(".ask-progress-label");
const firstLabel = await page.textContent(".ask-progress-label");
console.log("progress label:", firstLabel);
await page.waitForSelector(".ask-form:not([hidden])", { timeout: 15 * 60_000 });
console.log("machine:", await page.textContent(".ask-machine"));

// Answerable question: sources render, summary streams, finishes.
await page.fill(".ask-input", "How do I add OpenSearch support to my website?");
await page.click(".ask-submit");
await page.waitForSelector(".ask-source");
assert.equal(await page.locator(".ask-source").count(), 4);
await page.waitForFunction(() => !document.querySelector(".ask-submit").disabled, null, { timeout: 5 * 60_000 });
const summary = await page.textContent(".ask-summary");
console.log("summary:", summary);
assert.ok(summary.trim().length > 0);
assert.ok((summary.match(/[.!?](\s|$)/g) ?? []).length <= 2, "clamped to two sentences");

// Off-topic question: the gate fires, no generation.
await page.fill(".ask-input", "How do I bake sourdough bread at home?");
await page.click(".ask-submit");
await page.waitForSelector(".ask-notfound");
console.log("gate: ok");

// Reload: the model now shows as cached.
await page.reload();
await page.click("summary");
await page.waitForFunction((id) => !document.querySelector(`.ask-model[data-model="${id}"] .ask-model-cached`).hidden, MODEL);
console.log("cached badge: ok");
await browser.close();
console.log("E2E PASS");
```

- [ ] **Step 3: Run** — `hugo server --port 1314` in the background, then `BASE_URL=http://localhost:1314 MODEL=lfm2.5-350m node tests/e2e/ask.e2e.mjs`. Expect `E2E PASS`. Paste the console lines (progress label, machine, summary) in the report. Then run once more with `MODEL=qwen3-0.6b` and record the WASM tok/s from `.ask-machine` (it goes in the post).

- [ ] **Step 4: WebGPU (controller, real Chrome)** — the controller opens `http://localhost:1314/ask/` in the author's Chrome with the claude-in-chrome tools, loads Qwen3-0.6B, asks the OpenSearch question and the sourdough question, checks: progress bar shows `… / 579 MB · N% · ~… left` from the first update, "Preparing model…" after 100%, "Your machine" panel says WebGPU with tok/s, summary streams with the cursor and tok/s, stops at two sentences, gate fires for sourdough, "Delete downloaded models" clears the cached badge. Record a GIF with `gif_creator` named `ask-page-webgpu.gif` (useful for the post). Also toggle the OS "reduce motion" setting if convenient, or emulate it in DevTools, and check the map is hidden.

- [ ] **Step 5: Commit** — `git add tests/e2e/ask.e2e.mjs package.json pnpm-lock.yaml && git commit -m "Ask: Playwright end-to-end check (WASM path)"`

---

### Task 10: Docs

- [ ] Add a short "/ask/ page" subsection to `CLAUDE.md` under Architecture: what the files are, that weights come from Hugging Face pinned in `assets/js/ask/models.js` (kept in sync with `scripts/ask_eval/candidates.json` by a test), how to run the e2e check, and that the page is noindex/unlisted.
- [ ] Append to the results doc a "Browser numbers (Part 2)" section with the WASM and WebGPU TTFT / tok/s measured in Task 9.
- [ ] Commit: `git commit -m "Docs: /ask/ page notes and browser measurements"` (only those two files).

## Done when

- `node --test` passes (existing + new unit tests).
- `hugo` builds; `/ask/` is absent from `index.json`, RSS and the sitemap, and is `noindex` in production.
- The Playwright e2e passes on the WASM path; the WebGPU path is verified in real Chrome with a GIF.
- Nothing deployed; Part 3 ships the page with the post.
