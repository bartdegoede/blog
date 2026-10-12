// scripts/ask_eval/run_local.mjs
// Run every eval prompt through each local arm: CPU, greedy + repetition penalty, ungated (negatives
// included; the relevance gate is applied later, in the report).
//
//   node scripts/ask_eval/run_local.mjs <arm> [<arm> ...]   # or "all"
//
// Writes scripts/ask_eval/results/local/<arm>.jsonl, one row per prompt.
//
// Token counting (verified against transformers.js 4.3.1 source):
// generate() calls streamer.put() once with the prompt ids, then once per
// sampled token. TextStreamer returns early on the prompt put when
// skip_prompt is set, *before* token_callback_function fires, so the callback
// counts generated tokens only: one per decode step, including the terminating
// EOS/end-of-turn token when generation stops on its own.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline, env, TextStreamer } from "@huggingface/transformers";
import { MAX_NEW_TOKENS, REPETITION_PENALTY, foldSystem } from "../../assets/js/ask/prompt.js";

env.cacheDir = path.join(os.homedir(), ".cache", "ask-eval-transformers");
const here = (p) => new URL(p, import.meta.url);

// Same as probe_models.mjs: turns off Qwen3's <think> block; other templates ignore it.
const TEMPLATE_KWARGS = { enable_thinking: false };
const TEMPLATE_JUNK = /<\|im_start\|>|<\|im_end\|>|<start_of_turn>|<end_of_turn>|<\|endoftext\|>|<\|startoftext\|>|<eos>|<bos>|<turn\|>|<\|turn>/;

const cands = JSON.parse(readFileSync(here("./candidates.json"), "utf8")).filter((c) => c.status === "ok");
const prompts = readFileSync(here("./results/prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const wanted = process.argv.slice(2);
const arms = wanted[0] === "all" ? cands : cands.filter((c) => wanted.includes(c.arm));
if (arms.length === 0) throw new Error(`no runnable arms match ${wanted.join(" ")}`);
mkdirSync(here("./results/local/"), { recursive: true });

/** Strip an (empty) Qwen3 think block if the template left one in the reply. */
function clean(text) {
  return text.replace(/^\s*<think>\s*<\/think>\s*/, "").trim();
}

async function generate(gen, messages) {
  const t0 = performance.now();
  let tFirst = null;
  let nTokens = 0;
  const streamer = new TextStreamer(gen.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: () => {}, // default writes every token to stdout
    token_callback_function: () => {
      nTokens++;
      if (tFirst === null) tFirst = performance.now();
    },
  });
  const out = await gen(messages, {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    repetition_penalty: REPETITION_PENALTY,
    tokenizer_encode_kwargs: TEMPLATE_KWARGS,
    streamer,
  });
  const t1 = performance.now();
  return { raw: out[0].generated_text.at(-1).content, t0, t1, tFirst, nTokens };
}

for (const c of arms) {
  const tArm = performance.now();
  const gen = await pipeline("text-generation", c.repo, { dtype: c.dtype, device: "cpu" });
  const prep = (msgs) => (c.system_role ? msgs : foldSystem(msgs));

  // Untimed warm-up so row 1's TTFT excludes session init.
  await generate(gen, prep(prompts[0].messages));

  const rows = [];
  let thinkStripped = 0;
  for (const p of prompts) {
    const { raw, t0, t1, tFirst, nTokens } = await generate(gen, prep(p.messages));
    const summary = clean(raw);
    if (summary !== raw.trim()) thinkStripped++;
    if (/<think>|<\/think>/.test(summary)) throw new Error(`${c.arm} ${p.id}: think block in reply`);
    if (TEMPLATE_JUNK.test(summary)) throw new Error(`${c.arm} ${p.id}: template token in reply: ${summary}`);
    rows.push({
      arm: c.arm,
      id: p.id,
      summary,
      ttft_ms: Math.round((tFirst ?? t1) - t0),
      tok_s: nTokens > 1 ? +((nTokens - 1) / ((t1 - tFirst) / 1000)).toFixed(1) : null,
      output_tokens: nTokens,
    });
    process.stdout.write(".");
  }
  writeFileSync(here(`./results/local/${c.arm}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const wall = ((performance.now() - tArm) / 1000).toFixed(0);
  console.log(` ${c.arm}: ${rows.length} rows, ${wall}s wall (incl. load + warm-up), think blocks stripped: ${thinkStripped}`);
  await gen.dispose();
}
