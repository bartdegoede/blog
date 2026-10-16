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
// Single-threaded WASM runs ~1.2 tok/s, so 64 tokens would mean ~50 s of waiting.
const BENCH_TOKENS_WEBGPU = 64;
const BENCH_TOKENS_WASM = 16;

let tf = null;
let generator = null;
let stopper = null;
let penalty = REPETITION_PENALTY;

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
    repetition_penalty: penalty,
    tokenizer_encode_kwargs: { enable_thinking: false }, // Qwen3; other templates ignore it
    streamer,
    stopping_criteria: stopper,
  });
  const t1 = performance.now();
  return {
    text,
    tokens,
    ttft_ms: Math.round((tFirst ?? t1) - t0),
    tok_s: rateAt(tokens, tFirst, t1),
  };
}

// Tokens/s after the first token. null until there is a second token and at
// least MIN_RATE_MS since the first, so a burst can't report a huge rate.
const MIN_RATE_MS = 50;
function rateAt(tokens, tFirst, t) {
  if (tokens < 2 || tFirst === null) return null;
  const dt = t - tFirst;
  return dt > 0 && dt >= MIN_RATE_MS ? (tokens - 1) / (dt / 1000) : null;
}
const rate = (tokens, tFirst) => rateAt(tokens, tFirst, performance.now());

async function load({ model, device, skipBench }) {
  const { pipeline } = await lib();
  penalty = model.repetitionPenalty ?? REPETITION_PENALTY;
  generator = await pipeline("text-generation", model.repo, {
    revision: model.revision,
    dtype: model.dtype,
    device,
    progress_callback: (e) => {
      if (e.status === "progress") post({ type: "progress", file: e.file, loaded: e.loaded });
      else if (e.status === "done") post({ type: "file-done", file: e.file });
    },
  });
  if (skipBench) {
    // Reload after a hard Stop: the page keeps its earlier numbers.
    post({ type: "ready", device, bench: null });
    return;
  }
  post({ type: "status", text: "Warming up…" });
  await generate(BENCH_MESSAGES, 1); // untimed: compiles shaders / initialises kernels
  post({ type: "status", text: "Measuring speed on your machine…" });
  const bench = await generate(BENCH_MESSAGES, device === "wasm" ? BENCH_TOKENS_WASM : BENCH_TOKENS_WEBGPU);
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
