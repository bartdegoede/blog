// End-to-end check of /ask/ on the CPU/WASM path (headless Chromium, no WebGPU).
//
// Usage:
//   1. In another shell:   hugo server --port 1314
//   2. Then:               BASE_URL=http://localhost:1314 node tests/e2e/ask.e2e.mjs
//
// Optional env: MODEL=<id from assets/js/ask/models.js> (default smollm2-360m;
// try MODEL=qwen3-0.6b-small-rag for the default model). The first run downloads the
// model from Hugging Face (minutes). Not picked up by `node --test`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:1314").replace(/\/$/, "");
const MODEL_ID = process.env.MODEL ?? "smollm2-360m";
const { MODELS, DEFAULT_MODEL_ID, totalBytes } = await import(
  pathToFileURL(join(import.meta.dirname, "../../assets/js/ask/models.js")).href
);
const model = MODELS.find((m) => m.id === MODEL_ID);
assert.ok(model, `unknown MODEL ${MODEL_ID}`);
const isDefault = model.id === DEFAULT_MODEL_ID;
const modelMb = Math.round(totalBytes(model) / 1e6);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const text = async (page, sel) =>
  ((await page.locator(sel).first().textContent().catch(() => null)) ?? "").trim().replace(/\s+/g, " ");
const MIN = 60_000;

const dir = mkdtempSync(join(tmpdir(), "ask-e2e-"));
const errors = [];
let context;
let failed = false;

function watch(page) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
}

async function openAsk(page) {
  await page.goto(`${BASE}/ask/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ask-load");
}

async function ask(page, q) {
  await page.fill(".ask-input", q);
  await page.click(".ask-submit");
}

const idle = (page, timeout) =>
  page.waitForFunction(() => !document.querySelector(".ask-submit")?.disabled, null, { timeout, polling: 200 });

async function clickLoad(page) {
  if (isDefault) await page.click(`.ask-strip-actions .ask-load[data-model="${model.id}"]`);
  else {
    await page.evaluate(() => (document.querySelector("details.ask-demos").open = true));
    await page.click(`.ask-demo .ask-load[data-model="${model.id}"]`);
  }
}

try {
  context = await chromium.launchPersistentContext(dir, { headless: true });
  const page = context.pages()[0] ?? (await context.newPage());
  watch(page);

  // 1. Page + slow-mode text + WebGPU-only demos disabled
  log("1. open /ask/");
  await openAsk(page);
  assert.match(await text(page, ".ask-pill-backend"), /CPU · slow/);
  assert.match(await text(page, ".ask-strip-note"), /Runs on your CPU/);
  await page.evaluate(() => (document.querySelector("details.ask-demos").open = true));
  for (const m of MODELS.filter((m) => m.webgpuOnly)) {
    const row = page.locator(`.ask-demo[data-model="${m.id}"]`);
    assert.match(await row.textContent(), /Needs WebGPU/, `${m.id} row should say Needs WebGPU`);
    assert.equal(await row.locator(".ask-load").count(), 0, `${m.id} should have no Load button`);
  }
  log("   ok: CPU slow mode, WebGPU-only demos disabled");

  // 2. Sources-only mode
  log("2. sources-only");
  await page.click('.ask-example:has-text("What is a bloom filter?")');
  await idle(page, 60_000);
  assert.ok((await page.locator(".ask-source").count()) >= 1, "expected source cards");
  assert.match(await text(page, ".ask-answer"), /Load a model above/);
  log(`   ok: ${await page.locator(".ask-source").count()} source cards; "${await text(page, ".ask-answer")}"`);

  // 3. Relevance gate
  log("3. gate");
  await ask(page, "How do I bake sourdough bread at home?");
  await idle(page, 60_000);
  assert.match(await text(page, ".ask-answer"), /couldn't find this on the blog/);
  log("   ok: off-topic question gated");

  // 4. Load the model
  log(`4. load ${model.id} (${modelMb} MB)`);
  await clickLoad(page);
  const firstLabel = await page
    .waitForFunction(
      () => {
        const t = document.querySelector(".ask-progress-label")?.textContent ?? "";
        return /MB/.test(t) ? t : null;
      },
      null,
      { timeout: 5 * MIN, polling: 50 }
    )
    .then((h) => h.jsonValue());
  log(`   first progress label: "${firstLabel}"`);
  const m = firstLabel.match(/^(\d+) \/ (\d+) MB · \d+%/);
  assert.ok(m, `progress label format: ${firstLabel}`);
  assert.equal(Number(m[2]), modelMb, "label total MB should equal models.js total");
  const t0 = Date.now();
  await page.waitForSelector('.ask-strip[data-state="ready"]', { timeout: 15 * MIN });
  log(`   ready after ${((Date.now() - t0) / 1000).toFixed(0)} s: "${await text(page, ".ask-strip-title")}"`);
  log(`   first-token tooltip: "${await page.getAttribute(".ask-machine", "title")}"`);

  // 5. Answer
  log("5. answer");
  await ask(page, "How do I add OpenSearch support to my website?");
  await page.waitForFunction(() => document.querySelector(".ask-summary-card") !== null, null, { timeout: 60_000 });
  await idle(page, 5 * MIN);
  const summary = await text(page, ".ask-summary");
  const meta = await text(page, ".ask-meta");
  log(`   summary: ${summary}`);
  log(`   meta: ${meta}`);
  assert.ok(summary.length > 0 && summary !== "(no answer)", "summary should be non-empty");
  const ends = (summary.match(/(?<!\d)[.!?](\s|$)/g) ?? []).length;
  assert.ok(ends <= 2, `expected <= 2 sentence ends, got ${ends}`);
  assert.ok((await page.locator(".ask-source").count()) >= 1, "expected source cards under the answer");

  // 6. Stop (terminates the worker; cached model auto-reloads)
  log("6. stop");
  await ask(page, "What is a bloom filter?");
  await page.waitForSelector(".ask-cursor", { timeout: 5 * MIN, polling: 50 });
  const tStop = Date.now();
  await page.click(".ask-stop");
  await page.waitForFunction(() => /\(stopped\)/.test(document.querySelector(".ask-summary")?.textContent ?? ""), null, {
    timeout: 5000,
    polling: 50,
  });
  log(`   "(stopped)" after ${Date.now() - tStop} ms: "${await text(page, ".ask-summary")}"`);
  // The strip stays "ready" until the cache check finishes: wait for the reload to start first.
  await page.waitForSelector('.ask-strip[data-state="loading"]', { timeout: 10_000 });
  await page.waitForSelector('.ask-strip[data-state="ready"]', { timeout: 5 * MIN });
  log(`   auto-reloaded in ${((Date.now() - tStop) / 1000).toFixed(1)} s: "${await text(page, ".ask-strip-title")}"`);

  // 7. Cache marker + load from cache after a page reload
  log("7. cache");
  await openAsk(page);
  await page.evaluate(() => (document.querySelector("details.ask-demos").open = true));
  await page.waitForSelector(`[data-model="${model.id}"] .ask-model-cached:not([hidden])`, { timeout: 15_000 });
  log("   Cached marker shown");
  await page.evaluate(() => {
    window.__labels = [];
    new MutationObserver(() => {
      const t = document.querySelector(".ask-progress-label")?.textContent;
      if (t && window.__labels.at(-1) !== t) window.__labels.push(t);
    }).observe(document.getElementById("ask-app"), { subtree: true, childList: true, characterData: true });
  });
  await clickLoad(page);
  await page.waitForFunction(() => window.__labels.some((t) => t === "Loading from cache"), null, { timeout: 30_000, polling: 50 });
  log(`   labels seen: ${JSON.stringify(await page.evaluate(() => window.__labels.slice(0, 5)))}`);
  await page.waitForSelector('.ask-strip[data-state="ready"]', { timeout: 5 * MIN });
  log(`   ready from cache: "${await text(page, ".ask-strip-title")}"`);

  assert.deepEqual(errors, [], `page console errors:\n${errors.join("\n")}`);
  console.log("E2E PASS");
} catch (e) {
  failed = true;
  console.error("E2E FAIL:", e?.stack ?? e);
  if (errors.length) console.error("page console errors:\n" + errors.join("\n"));
} finally {
  await context?.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
