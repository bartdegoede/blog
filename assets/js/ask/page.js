// assets/js/ask/page.js
/**
 * /ask/ page controller: question bar, model status strip, download
 * progress, question → sources → gated, streamed summary. All rules and
 * numbers live in the sibling pure modules; the model lives in worker.js.
 *
 * The question bar works from the start: without a ready model it shows the
 * retrieved passages only (sources-only mode).
 */
import { loadIndex } from "../semantic/index.js";
import { scoreQuery, topChunks } from "./retrieve.js";
import { TOP_K, buildMessages, passesGate } from "./prompt.js";
import { MODELS, DEFAULT_MODEL_ID, CACHE_NAME, fileUrl, totalBytes, modelById } from "./models.js";
import { DownloadProgress, tileCount } from "./progress.js";
import { cleanSnippet, linkCitations } from "./display.js";

const WASM_DTYPE = "q4f16"; // confirmed in Part 2 Task 1
const root = document.getElementById("ask-app");
const page = root?.closest(".ask-page") ?? root; // includes the small-print footer
const WORKER_URL = root?.dataset.worker;

const EXAMPLES = [
  "What is a bloom filter?",
  "Which model does the local coding agent run?",
  "How do I add OpenSearch to my website?",
];

const state = {
  cap: null,
  backend: null, // "webgpu" | "wasm"; becomes "wasm" after "Try slower mode"
  model: null,
  worker: null,
  progress: null,
  fromCache: false,
  loading: false,
  ready: false,
  busy: false,
  quarter: 0, // last announced download quarter (0–4)
  nextId: 1,
  currentId: null,
  partial: "", // streamed text so far, for a hard stop
  passages: 0, // passages in the current prompt, for [n] citation links
  bench: null, // last benchmark {ttft_ms, tok_s} for state.model
  afterStop: false, // the current load is the reload after a WASM Stop
};
let persistAsked = false;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
const $ = (sel) => page.querySelector(sel);
const backendLabel = () => (state.backend === "webgpu" ? "WebGPU" : "CPU (WASM)");
const backendShort = () => (state.backend === "webgpu" ? "GPU" : "CPU");

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

async function storageEstimate() {
  try {
    return (await navigator.storage?.estimate?.()) ?? null;
  } catch {
    return null;
  }
}

/** Screen-reader announcement (a separate live region, not the fast-changing label). */
function announce(text) {
  const el = $(".ask-announce");
  if (el) el.textContent = text;
}

const blockedOnBackend = (m) => state.backend === "wasm" && m.webgpuOnly;

// ---------------------------------------------------------------- shell

function renderShell() {
  root.innerHTML = `
    <form class="ask-bar" role="search">
      <div class="ask-bar-field">
        <input type="search" class="ask-input" placeholder="Ask a question about the blog…" aria-label="Your question" autocomplete="off" required>
        <button type="button" class="ask-stop ask-btn ask-btn-secondary" hidden>Stop</button>
        <button type="submit" class="ask-submit ask-btn ask-btn-primary">Ask</button>
      </div>
    </form>
    <div class="ask-examples" aria-label="Example questions">
      ${EXAMPLES.map((q) => `<button type="button" class="ask-example" data-q="${esc(q)}">${esc(q)}</button>`).join("")}
    </div>
    <section class="ask-strip" aria-label="Summary model"></section>
    <div class="ask-answer" aria-live="polite" aria-busy="false" hidden></div>
    <section class="ask-sources-wrap" hidden>
      <h2 class="ask-sources-title">From the blog</h2>
      <ol class="ask-sources"></ol>
    </section>
    <p class="ask-announce ask-visually-hidden" aria-live="polite"></p>`;
  renderStripIdle();
}

// ---------------------------------------------------------------- strip

function statChips(m) {
  return `
    <span class="ask-pill" title="In my eval: ${m.faithful} of 30 answers were faithful to the passages">${m.faithful}/30 faithful</span>
    <span class="ask-pill" title="In my eval: made something up for ${m.invented} of 15 questions the blog doesn't answer">invented ${m.invented}/15</span>`;
}

function demoRow(m) {
  const action = blockedOnBackend(m)
    ? '<span class="ask-demo-blocked">Needs WebGPU (not available in this browser)</span>'
    : `<button type="button" class="ask-load ask-btn ask-btn-link" data-model="${m.id}" aria-label="Load ${esc(m.name)} (${mb(totalBytes(m))})">Load</button>`;
  return `
    <li class="ask-demo" data-model="${m.id}">
      <span class="ask-demo-name">${esc(m.name)}</span>
      <span class="ask-demo-size">${mb(totalBytes(m))}</span>
      <span class="ask-pill" title="In my eval: ${m.faithful} of 30 answers were faithful to the passages">${m.faithful}/30 faithful</span>
      <span class="ask-pill ask-model-cached" hidden>Cached</span>
      <span class="ask-demo-action">${action}</span>
    </li>`;
}

function renderStripIdle() {
  const strip = $(".ask-strip");
  strip.dataset.state = "idle";
  const def = modelById(DEFAULT_MODEL_ID);
  const demos = MODELS.filter((m) => m.role === "demo");
  // Measured in Task 1: WebGPU 19.8 tok/s; single-threaded WASM 1.2 tok/s
  // (GitHub Pages can't send COOP/COEP, so no WASM threads).
  const cpu = state.backend === "wasm";
  strip.innerHTML = `
    <div class="ask-strip-row">
      <span class="ask-dot" aria-hidden="true"></span>
      <span class="ask-strip-title">Summaries off</span>
      <span class="ask-strip-actions">
        <button type="button" class="ask-load ask-btn ask-btn-primary" data-model="${def.id}">Load ${esc(def.name)} · ${mb(totalBytes(def))}</button>
        <span class="ask-pill ask-pill-backend" title="${cpu ? "No WebGPU with 16-bit support: runs on your CPU" : "WebGPU: runs on your GPU"}">${cpu ? "CPU · slow" : "GPU"}</span>
      </span>
    </div>
    <div class="ask-strip-sub ask-model" data-model="${def.id}">
      ${statChips(def)}
      <span class="ask-pill ask-model-cached" hidden>Cached</span>
      ${cpu ? '<span class="ask-strip-note">Runs on your CPU here: ~30 to 60 s per answer.</span>' : ""}
    </div>
    <details class="ask-demos">
      <summary>Other models (compare)</summary>
      <p class="ask-demos-intro">Qwen3-0.6B before fine-tuning, and three smaller models. In my eval they made more things up: try one to see what that looks like.</p>
      <ul class="ask-demo-list">${demos.map(demoRow).join("")}</ul>
    </details>`;
  markCached();
}

async function markCached() {
  for (const m of MODELS) {
    const kept = await isCached(m);
    page.querySelectorAll(`[data-model="${m.id}"] .ask-model-cached`).forEach((el) => (el.hidden = !kept));
  }
}

/** Disable every control that would start or disturb a load while one is in flight. */
function setLoading(loading) {
  state.loading = loading;
  page.querySelectorAll(".ask-load").forEach((b) => {
    b.disabled = loading || blockedOnBackend(modelById(b.dataset.model));
  });
  page.querySelectorAll(".ask-retry, .ask-retry-wasm, .ask-reload, .ask-delete").forEach((b) => (b.disabled = loading));
}

function renderStripLoading(model) {
  const strip = $(".ask-strip");
  strip.dataset.state = "loading";
  const tiles = tileCount(totalBytes(model));
  strip.innerHTML = `
    <div class="ask-strip-row">
      <span class="ask-dot" aria-hidden="true"></span>
      <span class="ask-strip-title">Loading ${esc(model.name)} <span class="ask-muted">(${model.params} parameters)</span></span>
    </div>
    <div class="ask-loading">
      <p class="ask-storage-note" hidden></p>
      <div class="ask-map" role="progressbar" aria-label="Model download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${'<span class="ask-tile"></span>'.repeat(tiles)}</div>
      <p class="ask-progress-label">Starting download…</p>
      <p class="ask-error" hidden></p>
    </div>`;
}

function renderStripReady(device, bench) {
  const strip = $(".ask-strip");
  strip.dataset.state = "ready";
  const speed = bench.tok_s ? ` · ${bench.tok_s.toFixed(1)} tok/s` : "";
  const ttft = bench.ttft_ms !== null && bench.ttft_ms !== undefined ? `First token in ${bench.ttft_ms} ms on ${device === "webgpu" ? "WebGPU" : "CPU (WASM)"}` : "";
  strip.innerHTML = `
    <div class="ask-strip-row">
      <span class="ask-dot" aria-hidden="true"></span>
      <span class="ask-strip-title ask-machine" title="${esc(ttft)}">Summaries on · ${esc(state.model.name)} · ${device === "webgpu" ? "GPU" : "CPU"}${speed}</span>
      <button type="button" class="ask-switch ask-btn ask-btn-link"${state.busy ? " disabled" : ""}>Switch</button>
    </div>`;
}

function backToIdle() {
  state.worker?.terminate();
  state.worker = null;
  state.ready = false;
  state.loading = false;
  renderStripIdle();
  setLoading(false);
  $(`.ask-load[data-model="${DEFAULT_MODEL_ID}"]`)?.focus();
}

// ---------------------------------------------------------------- loading

function paintProgress() {
  const p = state.progress;
  const pct = Math.floor(p.fraction * 100);
  const bar = $(".ask-map");
  if (!bar) return;
  const tiles = page.querySelectorAll(".ask-tile");
  const filled = Math.floor(p.fraction * tiles.length);
  tiles.forEach((t, i) => t.classList.toggle("is-filled", i < filled));
  if (pct >= 100) {
    bar.removeAttribute("aria-valuenow");
    $(".ask-progress-label").textContent = "Preparing model…";
  } else {
    bar.setAttribute("aria-valuenow", String(pct));
    $(".ask-progress-label").textContent = state.fromCache ? "Loading from cache" : p.label();
  }
  const quarter = Math.min(4, Math.floor(pct / 25));
  if (quarter > state.quarter) {
    state.quarter = quarter;
    announce(quarter === 4 ? "Preparing model" : `${quarter * 25}% loaded`);
  }
}

function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    navigator.storage?.persist?.().catch(() => {}); // best effort, never awaited
  } catch {
    /* ignore */
  }
}

async function checkStorage(model, worker) {
  const est = await storageEstimate();
  if (!est || worker !== state.worker) return;
  const free = est.quota - est.usage;
  console.info(`[ask] storage estimate: quota ${mb(est.quota)}, usage ${mb(est.usage)}, free ${mb(free)}, model ${mb(totalBytes(model))}`);
  const note = $(".ask-storage-note");
  if (note && !state.fromCache && free < totalBytes(model) * 1.1) {
    note.hidden = false;
    note.textContent = `Your browser only allows ~${mb(Math.max(0, free))} of storage for this site, so the model probably won't be kept and will download again next visit.`;
  }
}

function startWorker(model, device, { skipBench = false } = {}) {
  // Synchronously replace the worker before any await, so a second click
  // can never leave two workers running.
  state.worker?.terminate();
  const worker = new Worker(WORKER_URL, { type: "module" });
  state.worker = worker;
  state.model = model;
  state.ready = false;
  state.fromCache = false;
  state.quarter = 0;
  state.progress = new DownloadProgress(model.files);
  if (!skipBench) state.bench = null;
  state.afterStop = skipBench;
  renderStripLoading(model);
  setLoading(true);
  worker.onmessage = ({ data }) => {
    if (worker === state.worker) onWorker(data, device);
  };
  worker.onerror = (e) => {
    if (worker === state.worker) onWorkerCrash(e.message || "The model worker failed.", device);
  };
  worker.postMessage({
    type: "load",
    model: { repo: model.repo, revision: model.revision, dtype: device === "wasm" ? WASM_DTYPE : model.dtype },
    device,
    skipBench,
  });
  askPersist();
  // Both run alongside the load; neither delays it.
  isCached(model).then((cached) => {
    if (worker !== state.worker || !cached) return;
    state.fromCache = true;
    const label = $(".ask-progress-label");
    if (label?.textContent === "Starting download…") label.textContent = "Loading from cache";
    $(".ask-storage-note")?.setAttribute("hidden", "");
  });
  checkStorage(model, worker);
}

function showLoadError(message, device) {
  setLoading(false);
  const el = $(".ask-error");
  el.hidden = false;
  el.innerHTML = `<span class="ask-error-text">Loading failed: ${esc(message)}</span>
    <span class="ask-error-actions">
      <button type="button" class="ask-retry ask-btn ask-btn-secondary">Retry</button>
      ${device === "webgpu" && !state.model?.webgpuOnly ? '<button type="button" class="ask-retry-wasm ask-btn ask-btn-secondary">Try slower mode (CPU)</button>' : ""}
      <button type="button" class="ask-choose ask-btn ask-btn-link">Choose another model</button>
    </span>`;
  announce(`Loading failed: ${message}`);
  $(".ask-retry").focus();
}

function onWorkerCrash(message, device) {
  state.worker = null;
  if (!state.ready) {
    showLoadError(message, device);
    return;
  }
  // The worker died after the model was ready (e.g. out of memory mid-answer).
  state.ready = false;
  if (state.busy) onGenerateError(`the model stopped (${message})`);
  setBusy(false);
  const strip = $(".ask-strip");
  strip.dataset.state = "error";
  $(".ask-switch")?.remove();
  strip.insertAdjacentHTML(
    "beforeend",
    `<p class="ask-error"><span class="ask-error-text">The model stopped working.</span>
      <span class="ask-error-actions">
        <button type="button" class="ask-reload ask-btn ask-btn-secondary">Reload model</button>
        <button type="button" class="ask-choose ask-btn ask-btn-link">Choose another model</button>
      </span></p>`
  );
  announce("The model stopped working");
}

function onWorker(msg, device) {
  if (msg.type === "progress") {
    state.progress.update(msg.file, msg.loaded);
    paintProgress();
  } else if (msg.type === "file-done") {
    state.progress.complete(msg.file);
    paintProgress();
  } else if (msg.type === "status") {
    const label = $(".ask-progress-label");
    if (label) label.textContent = msg.text;
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

function onReady(msg) {
  // A reload after Stop skips the benchmark (bench: null): keep the old numbers.
  const bench = msg.bench ?? state.bench ?? { ttft_ms: null, tok_s: null };
  state.bench = bench;
  state.ready = true;
  const active = document.activeElement;
  const focusWasInStrip = !active || active === document.body || $(".ask-strip").contains(active);
  renderStripReady(msg.device, bench);
  setLoading(false);
  if (state.afterStop) {
    const meta = $(".ask-meta");
    if (meta && (/Reloading/.test(meta.textContent) || meta.querySelector(".ask-reload"))) meta.textContent = "Stopped.";
    state.afterStop = false;
  }
  announce(`${state.model.name} is ready`);
  if (!state.busy && focusWasInStrip) $(".ask-input").focus();
  if (!state.fromCache) {
    const model = state.model;
    isCached(model).then((kept) => {
      if (!kept && state.model === model && state.ready) {
        $(".ask-strip").insertAdjacentHTML(
          "beforeend",
          `<p class="ask-kept-note">Your browser didn't keep the model (storage limit or private window), so it will download again next time.</p>`
        );
      }
    });
  }
}

// ---------------------------------------------------------------- asking

/** Group top chunks by post, in the order of each post's best chunk. */
function groupByPost(top) {
  const posts = new Map();
  top.forEach(({ chunk }, i) => {
    const key = chunk.post ?? chunk.href;
    if (!posts.has(key)) posts.set(key, { title: chunk.title, href: chunk.href, chunks: [], passages: [] });
    posts.get(key).chunks.push(chunk);
    posts.get(key).passages.push(i + 1); // passage n in the prompt
  });
  return [...posts.values()];
}

function sectionItem(chunk, postHref) {
  const snippet = cleanSnippet(chunk.snippet, chunk.heading);
  const href = chunk.heading && chunk.anchor ? `${chunk.href}#${chunk.anchor}` : postHref;
  return `<li class="ask-section">
    ${chunk.heading ? `<a class="ask-section-heading" href="${esc(href)}">${esc(chunk.heading)}</a>` : ""}
    ${snippet ? `<span class="ask-section-snippet">${esc(snippet)}</span>` : ""}
  </li>`;
}

// Display only: the prompt still gets the raw chunks in score order.
function renderSources(top) {
  $(".ask-sources-wrap").hidden = false;
  $(".ask-sources").innerHTML = groupByPost(top)
    .map(
      (post, k) => `<li class="ask-source${post.chunks.length > 1 ? " is-multi" : ""}" id="ask-card-${k + 1}">
        ${post.passages.map((n) => `<span class="ask-src-anchor" id="ask-src-${n}"></span>`).join("")}
        <a class="ask-source-title" href="${esc(post.href)}">${esc(post.title)}</a>
        <ul class="ask-sections">${post.chunks.map((c) => sectionItem(c, post.href)).join("")}</ul>
      </li>`
    )
    .join("");
}

/** Escape first, then turn [n] markers into links to the source cards. */
const summaryHtml = (text) => linkCitations(esc(text), state.passages);

const info = (text, cls = "") => `<p class="ask-info ${cls}">${text}</p>`;

function setBusy(busy) {
  state.busy = busy;
  $(".ask-submit").disabled = busy;
  page.querySelectorAll(".ask-example").forEach((b) => (b.disabled = busy));
  const sw = $(".ask-switch");
  if (sw) sw.disabled = busy;
  if (!busy) {
    $(".ask-stop").hidden = true;
    $(".ask-submit").hidden = false;
    $(".ask-answer").setAttribute("aria-busy", "false");
    $(".ask-input").focus();
  }
}

async function ask(question) {
  if (state.busy) return;
  setBusy(true);
  const answer = $(".ask-answer");
  answer.hidden = false;
  answer.setAttribute("aria-busy", "true");
  answer.innerHTML = info("Searching the blog…");
  let top;
  try {
    const idx = await loadIndex();
    top = topChunks(scoreQuery(idx, question), idx.chunks, TOP_K);
  } catch (e) {
    $(".ask-sources-wrap").hidden = true;
    answer.innerHTML = info(`Couldn't load the search index (${esc(e?.message ?? e)}). Reload the page to try again.`, "is-error");
    setBusy(false);
    return;
  }
  renderSources(top);
  if (!passesGate(top)) {
    answer.innerHTML = info("I couldn't find this on the blog. These are the closest passages, but they probably don't answer it.");
    setBusy(false);
    return;
  }
  if (!state.ready) {
    answer.innerHTML = info(
      state.loading
        ? "The model is still loading: ask again once it's ready for a summary."
        : "Load a model above to get a generated summary of these passages."
    );
    setBusy(false);
    return;
  }
  answer.innerHTML = `
    <div class="ask-summary-card">
      <div class="ask-summary-head">
        <span class="ask-badge">AI summary</span>
        <span class="ask-summary-model">${esc(state.model.name)}</span>
        <span class="ask-summary-warn">may be wrong · check the passages below</span>
      </div>
      <p class="ask-summary"><span class="ask-skeleton"></span><span class="ask-skeleton"></span></p>
      <p class="ask-meta">Reading ${top.length} passages…</p>
    </div>`;
  $(".ask-sources").classList.add("is-reading");
  state.currentId = state.nextId++;
  state.passages = top.length;
  state.partial = "";
  state.worker.postMessage({ type: "generate", id: state.currentId, messages: buildMessages(question, top.map((t) => t.chunk)) });
  $(".ask-submit").hidden = true;
  $(".ask-stop").hidden = false;
}

function onToken({ id, text, tok_s }) {
  if (id !== state.currentId) return;
  state.partial = text;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").innerHTML = `${summaryHtml(text)}<span class="ask-cursor" aria-hidden="true"></span>`;
  if (tok_s) $(".ask-meta").textContent = `${tok_s.toFixed(1)} tok/s · ${backendLabel()}`;
}

function onDone({ id, text, tokens, ttft_ms, tok_s }) {
  if (id !== state.currentId) return;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").innerHTML = text ? summaryHtml(text) : "(no answer)";
  const speed = tok_s ? ` · ${tok_s.toFixed(1)} tok/s` : "";
  $(".ask-meta").textContent = `${tokens} tokens · first token ${ttft_ms} ms${speed} · ${backendLabel()}`;
  setBusy(false);
}

function onGenerateError(message) {
  $(".ask-sources").classList.remove("is-reading");
  const summary = $(".ask-summary");
  if (summary) summary.textContent = `Generating failed: ${message}. The passages below still answer from the blog itself.`;
  announce("Generating failed");
  setBusy(false);
}

/**
 * WebGPU: ask the worker to interrupt. WASM: the worker is stuck inside
 * synchronous inference and never sees the stop message (measured: the
 * answer ran to its end ~40 s after Stop), so terminate it, keep the partial
 * text, and reload the same model only when that costs no download.
 */
async function stop() {
  if (state.backend !== "wasm") {
    state.worker?.postMessage({ type: "stop" });
    return;
  }
  state.worker?.terminate();
  state.worker = null;
  state.ready = false;
  state.currentId = null;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").innerHTML = `${summaryHtml(state.partial || "")} (stopped)`.trim();
  announce("Stopped");
  setBusy(false);
  const model = state.model;
  // Never let the strip claim "ready" while we check the cache.
  const strip = $(".ask-strip");
  strip.dataset.state = "stopped";
  $(".ask-switch")?.remove();
  strip.querySelector(".ask-strip-title").textContent = `Stopped · ${model.name}`;
  if (await isCached(model)) {
    const meta = $(".ask-meta");
    if (meta) meta.textContent = "Stopped. Reloading the model…";
    startWorker(model, state.backend, { skipBench: true });
  } else {
    $(".ask-strip .ask-strip-title").textContent = `Summaries off · ${model.name} stopped`;
    $(".ask-strip .ask-strip-row").insertAdjacentHTML("beforeend", '<button type="button" class="ask-choose ask-btn ask-btn-link">Switch</button>');
    const meta = $(".ask-meta");
    if (meta) meta.innerHTML = `Stopped. <button type="button" class="ask-reload ask-btn ask-btn-secondary ask-btn-small">Reload model (${mb(totalBytes(model))} download)</button>`;
  }
}

// ---------------------------------------------------------------- storage

async function deleteModels() {
  const btn = $(".ask-delete");
  const status = $(".ask-manage-status");
  btn.disabled = true;
  status.textContent = "Deleting…";
  try {
    const before = await storageEstimate();
    await caches.delete(CACHE_NAME);
    const after = await storageEstimate();
    // estimate() can lag behind the delete; only claim a number we measured.
    const freed = before && after ? before.usage - after.usage : 0;
    status.textContent = freed >= 1e6 ? `Deleted, freed ~${mb(freed)}.` : "Deleted.";
  } catch (e) {
    status.textContent = `Couldn't delete: ${e?.message ?? e}`;
  } finally {
    btn.disabled = state.loading;
  }
  await markCached();
}

// ---------------------------------------------------------------- main

async function main() {
  if (!root || !WORKER_URL) return;
  state.cap = await probe();
  state.backend = state.cap.device;
  renderShell();
  const manage = $(".ask-manage");
  if (manage) manage.hidden = false;
  page.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.disabled || !page.contains(t)) return;
    if (t.matches(".ask-load")) startWorker(modelById(t.dataset.model), state.backend);
    else if (t.matches(".ask-retry")) startWorker(state.model, state.backend);
    else if (t.matches(".ask-reload")) startWorker(state.model, state.backend, { skipBench: !!state.bench });
    else if (t.matches(".ask-retry-wasm")) {
      state.backend = "wasm";
      startWorker(state.model, "wasm");
    } else if (t.matches(".ask-stop")) stop();
    else if (t.matches(".ask-switch, .ask-choose")) backToIdle();
    else if (t.matches(".ask-delete")) deleteModels();
    else if (t.matches(".ask-example")) {
      $(".ask-input").value = t.dataset.q;
      ask(t.dataset.q);
    }
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $(".ask-input").value.trim();
    if (q) ask(q);
  });
}

main();
