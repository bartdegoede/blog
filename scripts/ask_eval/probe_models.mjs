// scripts/ask_eval/probe_models.mjs
// Feasibility gate: for each candidate, load it on CPU, generate 8 tokens with a
// system+user chat, and record download size and whether the chat template
// accepts a system role. Rewrites candidates.json in place.
//
//   node scripts/ask_eval/probe_models.mjs            # every arm
//   node scripts/ask_eval/probe_models.mjs <arm>      # one arm
//
// Weights are cached in ~/.cache/ask-eval-transformers (outside the repo).
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline, env } from "@huggingface/transformers";
import { foldSystem } from "../../assets/js/ask/prompt.js";

const FILE = new URL("./candidates.json", import.meta.url);
const BROWSER_BUDGET_MB = 350;
const SYS = "Be brief.";
const MSGS = [
  { role: "system", content: SYS },
  { role: "user", content: "Say hi." },
];
// Passed to apply_chat_template. Turns off Qwen3's <think> block; templates
// that don't reference the variable ignore it.
const TEMPLATE_KWARGS = { enable_thinking: false };
const GEN = { max_new_tokens: 8, do_sample: false, tokenizer_encode_kwargs: TEMPLATE_KWARGS };

// transformers.js' FileCache stores each file at <cacheDir>/<repo>/<filename>.
env.cacheDir = path.join(os.homedir(), ".cache", "ask-eval-transformers");

/**
 * Does the template accept a system message and actually render its content?
 * A template can drop the system turn silently instead of throwing, so check the
 * rendered prompt rather than relying on an exception.
 */
function systemRole(tokenizer) {
  const opts = { tokenize: false, add_generation_prompt: true, ...TEMPLATE_KWARGS };
  try {
    const rendered = tokenizer.apply_chat_template(MSGS, opts);
    return { ok: rendered.includes(SYS), rendered };
  } catch (e) {
    return { ok: false, rendered: `<template threw: ${e.message}>` };
  }
}

/** Notes are human-curated; the probe only ever appends to them (and never twice). */
function appendNote(c, msg) {
  if (c.note.includes(msg)) return;
  c.note = c.note ? `${c.note} | ${msg}` : msg;
}

const only = process.argv[2]; // optional: probe a single arm
const cands = JSON.parse(readFileSync(FILE, "utf8"));
if (only && !cands.some((c) => c.arm === only)) throw new Error(`unknown arm: ${only}`);

for (const c of cands) {
  if (only && c.arm !== only) continue;
  if (c.status === "unavailable") continue;

  // Only the files this load actually fetched (one dtype), so download_mb is
  // what a browser would pull, not every variant sitting in the cache.
  const files = new Set();
  const progress_callback = (p) => {
    if (p.status === "done" && p.name === c.repo) files.add(p.file);
  };

  let gen;
  try {
    gen = await pipeline("text-generation", c.repo, { dtype: c.dtype, device: "cpu", progress_callback });
    const sr = systemRole(gen.tokenizer);
    c.system_role = sr.ok;
    const out = await gen(sr.ok ? MSGS : foldSystem(MSGS), GEN);
    const reply = out[0].generated_text.at(-1).content;

    c.download_mb = Math.round(
      [...files].reduce((sum, f) => sum + statSync(path.join(env.cacheDir, c.repo, f)).size, 0) / 1e6,
    );
    c.status = "ok";
    // Only browser-tier arms are budgeted; midsize/large arms are references.
    if (c.tier === "browser" && c.download_mb > BROWSER_BUDGET_MB) {
      c.status = "over-budget";
      appendNote(c, `${c.dtype} download is ${c.download_mb} MB (> ${BROWSER_BUDGET_MB} MB browser budget)`);
    }
    console.log(`\n== ${c.arm} [${c.status}] ${c.download_mb} MB, system_role=${c.system_role}`);
    console.log(`files: ${[...files].sort().join(", ")}`);
    console.log(`rendered prompt:\n${sr.rendered}`);
    console.log(`8 tokens: ${JSON.stringify(reply)}`);
  } catch (e) {
    c.status = "failed";
    appendNote(c, `probe failed (${c.dtype}): ${String(e.message || e).slice(0, 300)}`);
    console.log(`\n== ${c.arm} [failed] ${c.note}`);
  } finally {
    await gen?.dispose();
  }
  writeFileSync(FILE, JSON.stringify(cands, null, 2) + "\n");
}
