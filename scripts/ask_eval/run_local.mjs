// scripts/ask_eval/run_local.mjs
// Run every eval prompt through each local arm: CPU, greedy + repetition penalty, ungated (negatives
// included; the relevance gate is applied later, in the report).
//
//   node scripts/ask_eval/run_local.mjs <arm> [<arm> ...]   # or "all"
//   node scripts/ask_eval/run_local.mjs <arm> ... --sentences N [--out-dir DIR]
//
// Writes scripts/ask_eval/results/local/<arm>.jsonl, one row per prompt.
//
// --sentences N (answer-length experiment) mirrors the browser worker for an
// N-sentence limit: system prompt "at most N sentences" (messages rebuilt from
// each prompt row's question + passages), max_new_tokens = 60*N, generation
// interrupted once N sentences are complete, and the saved summary is
// formatAnswer(raw, N). Rows get arm "<arm>-s<N>", max_sentences, raw and
// stop_reason (early-stop | token-cap | eos); the file is
// <out-dir>/<arm>-s<N>.jsonl. --out-dir is relative to scripts/ask_eval/
// (default results/local). Without --sentences the behaviour
// is unchanged: stored messages, MAX_NEW_TOKENS, no early stop, no clamp.
// Each arm runs at its candidates.json repetition_penalty (default
// REPETITION_PENALTY), the value models.js ships.
// --repetition-penalty P overrides it for every arm; rows get arm "<arm>-rp<P>"
// and the file is <out-dir>/<arm>-rp<P>.jsonl (P as given, e.g. 1.0).
// Each arm's file is written as soon as it finishes; with --sentences, an arm
// whose output file already has one row per prompt is skipped unless --force.
//
// Token counting (verified against transformers.js 4.3.1 source):
// generate() calls streamer.put() once with the prompt ids, then once per
// sampled token. TextStreamer returns early on the prompt put when
// skip_prompt is set, *before* token_callback_function fires, so the callback
// counts generated tokens only: one per decode step, including the terminating
// EOS/end-of-turn token when generation stops on its own.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { pipeline, env, TextStreamer, InterruptableStoppingCriteria } from "@huggingface/transformers";
import {
  MAX_NEW_TOKENS, MAX_SENTENCES, REPETITION_PENALTY, buildMessages, foldSystem,
} from "../../assets/js/ask/prompt.js";
import { clampSentences, formatAnswer, stripLeadingMarkers } from "../../assets/js/ask/display.js";

env.cacheDir = path.join(os.homedir(), ".cache", "ask-eval-transformers");
const here = (p) => new URL(p, import.meta.url);

// Same as probe_models.mjs: turns off Qwen3's <think> block; other templates ignore it.
const TEMPLATE_KWARGS = { enable_thinking: false };
const TEMPLATE_JUNK = /<\|im_start\|>|<\|im_end\|>|<start_of_turn>|<end_of_turn>|<\|endoftext\|>|<\|startoftext\|>|<eos>|<bos>|<turn\|>|<\|turn>/;

const cands = JSON.parse(readFileSync(here("./candidates.json"), "utf8")).filter((c) => c.status === "ok");
const prompts = readFileSync(here("./results/prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const { values: opts, positionals: wanted } = parseArgs({
  allowPositionals: true,
  options: {
    sentences: { type: "string" },
    "out-dir": { type: "string", default: "results/local" },
    force: { type: "boolean", default: false },
    "repetition-penalty": { type: "string" },
  },
});
const sentences = opts.sentences === undefined ? null : Number(opts.sentences);
if (sentences !== null && !(Number.isInteger(sentences) && sentences > 0)) {
  throw new Error(`--sentences must be a positive integer, got ${opts.sentences}`);
}
const penaltyArg = opts["repetition-penalty"];
const override = penaltyArg === undefined ? null : Number(penaltyArg);
if (override !== null && !(override >= 1)) throw new Error(`--repetition-penalty must be >= 1, got ${penaltyArg}`);
const suffix = penaltyArg === undefined ? "" : `-rp${penaltyArg}`;
const maxNewTokens = sentences === null ? MAX_NEW_TOKENS : 60 * sentences;
const arms = wanted[0] === "all" ? cands : cands.filter((c) => wanted.includes(c.arm));
if (arms.length === 0) throw new Error(`no runnable arms match ${wanted.join(" ")}`);
const outDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), opts["out-dir"]);
mkdirSync(outDir, { recursive: true });

// Rebuilding from question + passages must reproduce the stored (N = 2) messages exactly.
for (const p of prompts) {
  assert.deepEqual(buildMessages(p.question, p.passages, { maxSentences: MAX_SENTENCES }), p.messages, p.id);
}
const messagesFor = (p) =>
  sentences === null ? p.messages : buildMessages(p.question, p.passages, { maxSentences: sentences });

/** Strip an (empty) Qwen3 think block if the template left one in the reply. */
function clean(text) {
  return text.replace(/^\s*<think>\s*<\/think>\s*/, "").trim();
}

async function generate(gen, messages, penalty) {
  const t0 = performance.now();
  let tFirst = null;
  let nTokens = 0;
  let streamed = "";
  let interrupted = false;
  // Same early stop as assets/js/ask/worker.js, only with --sentences.
  const stopper = sentences === null ? null : new InterruptableStoppingCriteria();
  const streamer = new TextStreamer(gen.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => {
      if (stopper === null) return; // default writes every token to stdout
      streamed += chunk;
      if (clampSentences(stripLeadingMarkers(streamed).trimStart(), sentences, false).complete) {
        interrupted = true;
        stopper.interrupt();
      }
    },
    token_callback_function: () => {
      nTokens++;
      if (tFirst === null) tFirst = performance.now();
    },
  });
  const out = await gen(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
    repetition_penalty: penalty,
    tokenizer_encode_kwargs: TEMPLATE_KWARGS,
    streamer,
    ...(stopper ? { stopping_criteria: stopper } : {}),
  });
  const t1 = performance.now();
  const stopReason = interrupted ? "early-stop" : nTokens >= maxNewTokens ? "token-cap" : "eos";
  return { raw: out[0].generated_text.at(-1).content, t0, t1, tFirst, nTokens, stopReason };
}

for (const c of arms) {
  const name = (sentences === null ? c.arm : `${c.arm}-s${sentences}`) + suffix;
  const outFile = path.join(outDir, `${name}.jsonl`);
  if (sentences !== null && !opts.force && existsSync(outFile)) {
    const n = readFileSync(outFile, "utf8").split("\n").filter((l) => l.trim()).length;
    if (n === prompts.length) {
      console.log(`${name}: ${outFile} already has ${n} rows, skipping (--force to re-run)`);
      continue;
    }
  }
  const tArm = performance.now();
  const gen = await pipeline("text-generation", c.repo, { dtype: c.dtype, device: "cpu" });
  const prep = (msgs) => (c.system_role ? msgs : foldSystem(msgs));

  // Untimed warm-up so row 1's TTFT excludes session init.
  const penalty = override ?? c.repetition_penalty ?? REPETITION_PENALTY;
  await generate(gen, prep(messagesFor(prompts[0])), penalty);

  const rows = [];
  let thinkStripped = 0;
  for (const p of prompts) {
    const { raw, t0, t1, tFirst, nTokens, stopReason } = await generate(gen, prep(messagesFor(p)), penalty);
    const cleaned = clean(raw);
    if (cleaned !== raw.trim()) thinkStripped++;
    const summary = sentences === null ? cleaned : formatAnswer(cleaned, sentences);
    if (/<think>|<\/think>/.test(summary)) throw new Error(`${c.arm} ${p.id}: think block in reply`);
    if (TEMPLATE_JUNK.test(summary)) throw new Error(`${c.arm} ${p.id}: template token in reply: ${summary}`);
    const row = {
      arm: name,
      id: p.id,
      summary,
      ttft_ms: Math.round((tFirst ?? t1) - t0),
      tok_s: nTokens > 1 ? +((nTokens - 1) / ((t1 - tFirst) / 1000)).toFixed(1) : null,
      output_tokens: nTokens,
    };
    if (sentences !== null) {
      Object.assign(row, { max_sentences: sentences, raw, stop_reason: stopReason, wall_ms: Math.round(t1 - t0) });
    }
    rows.push(row);
    process.stdout.write(".");
  }
  writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const wall = ((performance.now() - tArm) / 1000).toFixed(0);
  console.log(` ${c.arm}: ${rows.length} rows, ${wall}s wall (incl. load + warm-up), think blocks stripped: ${thinkStripped}`);
  await gen.dispose();
}
