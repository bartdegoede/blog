// assets/js/ask/page.js
/**
 * /ask/ page controller: capability probe, model cards, download progress,
 * question → sources → gated, streamed summary. All rules and numbers live
 * in the sibling pure modules; the model lives in worker.js.
 *
 * The question form works from the start: without a ready model it shows
 * the retrieved passages only (sources-only mode).
 */
import { loadIndex } from "../semantic/index.js";
import { scoreQuery, topChunks } from "./retrieve.js";
import { TOP_K, buildMessages, passesGate } from "./prompt.js";
import { MODELS, CACHE_NAME, fileUrl, totalBytes, modelById } from "./models.js";
import { DownloadProgress, tileCount } from "./progress.js";

const WASM_DTYPE = "q4f16"; // confirmed in Part 2 Task 1
const root = document.getElementById("ask-app");
const WORKER_URL = root?.dataset.worker;

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
  bench: null, // last benchmark {ttft_ms, tok_s, device} for state.model
  afterStop: false, // the current load is the reload after a WASM Stop
};
let persistAsked = false;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
const $ = (sel) => root.querySelector(sel);
const backendLabel = () => (state.backend === "webgpu" ? "WebGPU" : "CPU (WASM)");

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

function modelCard(m) {
  const blocked = blockedOnBackend(m);
  const stats = `In my eval: <strong>${m.faithful}/30</strong> faithful answers; made something up for <strong>${m.invented}/15</strong> questions the blog doesn't answer.`;
  return `
    <div class="ask-model" data-model="${m.id}">
      <div class="ask-model-head">
        <span class="ask-model-name">${esc(m.name)}</span>
        <span class="ask-model-size">${mb(totalBytes(m))}</span>
        <span class="ask-model-cached" hidden>Cached, loads instantly</span>
      </div>
      <p class="ask-model-stats">${stats}</p>
      <button type="button" class="ask-load" data-model="${m.id}"${blocked ? " disabled" : ""}>Load ${esc(m.name)} (${mb(totalBytes(m))})</button>
      ${blocked ? '<p class="ask-model-blocked">Needs WebGPU (not available in this browser)</p>' : ""}
    </div>`;
}

function renderIdle() {
  const cap = state.cap;
  const def = MODELS.filter((m) => m.role === "default");
  const demos = MODELS.filter((m) => m.role === "demo");
  // Measured in Task 1: WebGPU 19.8 tok/s; single-threaded WASM 1.2 tok/s
  // (GitHub Pages can't send COOP/COEP, so no WASM threads).
  const backend =
    state.backend === "webgpu"
      ? "Your browser supports WebGPU: the model runs on your GPU."
      : cap.device === "webgpu"
        ? "Running on your CPU (slower mode): expect roughly 30–60 seconds per answer."
        : "No WebGPU with 16-bit support here, so the model runs on your CPU (slower mode): expect roughly 30–60 seconds per answer.";
  root.innerHTML = `
    <div class="ask-models">
      <p class="ask-capability">${esc(backend)}${cap.memoryGb ? ` Device memory: ~${cap.memoryGb} GB.` : ""}</p>
      ${def.map(modelCard).join("")}
      <details class="ask-demos">
        <summary>See why size matters: three smaller models</summary>
        <p>These are smaller, but in my eval they were almost never faithful to the passages. Try one to see what that looks like.</p>
        ${demos.map(modelCard).join("")}
      </details>
    </div>
    <div class="ask-loading" hidden></div>
    <div class="ask-machine" hidden></div>
    <form class="ask-form">
      <input type="search" class="ask-input" placeholder="Ask a question about the blog…" aria-label="Your question" autocomplete="off" required>
      <button type="submit" class="ask-submit">Ask</button>
      <button type="button" class="ask-stop" hidden>Stop</button>
      <button type="button" class="ask-switch" hidden>Switch model</button>
    </form>
    <div class="ask-answer" aria-live="polite" aria-busy="false" hidden></div>
    <ol class="ask-sources" hidden></ol>
    <p class="ask-manage">
      <button type="button" class="ask-delete">Delete downloaded models (all models this site downloaded)</button>
      <span class="ask-manage-status" role="status"></span>
    </p>
    <p class="ask-announce visually-hidden" aria-live="polite"></p>`;
  markCached();
}

async function markCached() {
  for (const m of MODELS) {
    const card = root.querySelector(`.ask-model[data-model="${m.id}"]`);
    if (card) card.querySelector(".ask-model-cached").hidden = !(await isCached(m));
  }
}

/** Disable every control that would start or disturb a load while one is in flight. */
function setLoading(loading) {
  state.loading = loading;
  root.querySelectorAll(".ask-load").forEach((b) => {
    b.disabled = loading || blockedOnBackend(modelById(b.dataset.model));
  });
  root.querySelectorAll(".ask-retry, .ask-retry-wasm, .ask-reload, .ask-delete").forEach((b) => (b.disabled = loading));
}

function renderLoading(model) {
  const tiles = tileCount(totalBytes(model));
  const box = $(".ask-loading");
  box.hidden = false;
  box.innerHTML = `
    <p class="ask-loading-title">Loading ${esc(model.name)} (${model.params} parameters)</p>
    <p class="ask-storage-note" hidden></p>
    <div class="ask-progress" role="progressbar" aria-label="Model download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="ask-progress-fill"></div>
    </div>
    <p class="ask-progress-label">Starting download…</p>
    <div class="ask-map" aria-hidden="true">${'<span class="ask-tile"></span>'.repeat(tiles)}</div>
    <p class="ask-error" hidden></p>`;
}

function paintProgress() {
  const p = state.progress;
  const pct = Math.floor(p.fraction * 100);
  const bar = $(".ask-progress");
  $(".ask-progress-fill").style.width = `${pct}%`;
  const tiles = root.querySelectorAll(".ask-tile");
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

async function checkStorage(model) {
  const est = await storageEstimate();
  if (!est) return;
  const free = est.quota - est.usage;
  console.info(`[ask] storage estimate: quota ${mb(est.quota)}, usage ${mb(est.usage)}, free ${mb(free)}, model ${mb(totalBytes(model))}`);
  if (!state.fromCache && free < totalBytes(model) * 1.1) {
    const note = $(".ask-storage-note");
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
  $(".ask-machine").hidden = true;
  $(".ask-switch").hidden = true;
  renderLoading(model);
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
  checkStorage(model);
}

function showLoadError(message, device) {
  setLoading(false);
  const el = $(".ask-error");
  el.hidden = false;
  el.innerHTML = `Loading failed: ${esc(message)}
    <button type="button" class="ask-retry">Retry</button>
    ${device === "webgpu" && !state.model?.webgpuOnly ? '<button type="button" class="ask-retry-wasm">Try slower mode (CPU)</button>' : ""}
    <button type="button" class="ask-choose">Choose another model</button>`;
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
  $(".ask-switch").hidden = true;
  const machine = $(".ask-machine");
  machine.insertAdjacentHTML(
    "beforeend",
    ` <span class="ask-error">The model stopped working. <button type="button" class="ask-reload">Reload model</button> <button type="button" class="ask-choose">Choose another model</button></span>`
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

function onReady(msg) {
  const device = msg.device;
  // A reload after Stop skips the benchmark (bench: null): keep the old numbers.
  const bench = msg.bench ?? state.bench ?? { ttft_ms: null, tok_s: null };
  state.bench = bench;
  state.ready = true;
  setLoading(false);
  $(".ask-loading").hidden = true;
  if (state.afterStop) {
    const meta = $(".ask-meta");
    if (meta && (/Reloading/.test(meta.textContent) || meta.querySelector(".ask-reload"))) meta.textContent = "Stopped.";
    state.afterStop = false;
  }
  const machine = $(".ask-machine");
  machine.hidden = false;
  const speed = bench.tok_s ? `${bench.tok_s.toFixed(1)} tokens/s` : "n/a";
  machine.innerHTML = `<strong>Your machine:</strong> ${esc(state.model.name)} on ${device === "webgpu" ? "WebGPU" : "CPU (WASM)"} · ${speed}${bench.ttft_ms !== null ? ` · first token in ${bench.ttft_ms} ms` : ""}`;
  $(".ask-models").hidden = true;
  $(".ask-switch").hidden = false;
  announce(`${state.model.name} is ready`);
  const active = document.activeElement;
  if (!state.busy && (!active || active === document.body || $(".ask-loading").contains(active))) $(".ask-input").focus();
  markCached();
  if (!state.fromCache) {
    const model = state.model;
    isCached(model).then((kept) => {
      if (!kept && state.model === model && state.ready) {
        machine.insertAdjacentHTML(
          "beforeend",
          `<p class="ask-kept-note">Note: your browser didn't keep the model (storage limit or private window), so it will download again next time.</p>`
        );
      }
    });
  }
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
  $(".ask-switch").disabled = busy;
  if (!busy) {
    $(".ask-stop").hidden = true;
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
  answer.innerHTML = '<p class="ask-searching">Searching the blog…</p>';
  let top;
  try {
    const idx = await loadIndex();
    top = topChunks(scoreQuery(idx, question), idx.chunks, TOP_K);
  } catch (e) {
    $(".ask-sources").hidden = true;
    answer.innerHTML = `<p class="ask-error">Couldn't load the search index (${esc(e?.message ?? e)}). Reload the page to try again.</p>`;
    setBusy(false);
    return;
  }
  renderSources(top);
  if (!passesGate(top)) {
    answer.innerHTML = `<p class="ask-notfound">I couldn't find this on the blog. These are the closest passages, but they probably don't answer it.</p>`;
    setBusy(false);
    return;
  }
  if (!state.ready) {
    answer.innerHTML = state.loading
      ? `<p class="ask-note">These are the most relevant passages. The model is still loading: ask again once it's ready for a summary.</p>`
      : `<p class="ask-note">These are the most relevant passages. Load a model above to get a generated summary.</p>`;
    setBusy(false);
    return;
  }
  answer.innerHTML = `
    <p class="ask-label">Summary, generated by ${esc(state.model.name)} in your browser. It may be wrong; check the passages below.</p>
    <p class="ask-summary"><span class="ask-skeleton"></span><span class="ask-skeleton"></span></p>
    <p class="ask-meta">Reading ${top.length} passages…</p>`;
  $(".ask-sources").classList.add("is-reading");
  state.currentId = state.nextId++;
  state.partial = "";
  state.worker.postMessage({ type: "generate", id: state.currentId, messages: buildMessages(question, top.map((t) => t.chunk)) });
  $(".ask-stop").hidden = false;
}

function onToken({ id, text, tok_s }) {
  if (id !== state.currentId) return;
  state.partial = text;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").innerHTML = `${esc(text)}<span class="ask-cursor" aria-hidden="true"></span>`;
  if (tok_s) $(".ask-meta").textContent = `${tok_s.toFixed(1)} tok/s · ${backendLabel()}`;
}

function onDone({ id, text, tokens, ttft_ms, tok_s }) {
  if (id !== state.currentId) return;
  $(".ask-sources").classList.remove("is-reading");
  $(".ask-summary").textContent = text || "(no answer)";
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
 * text, and reload the same model (from cache when the browser kept it).
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
  $(".ask-summary").textContent = `${state.partial || ""} (stopped)`.trim();
  announce("Stopped");
  setBusy(false);
  const model = state.model;
  // Only reload on our own when it costs no download.
  if (await isCached(model)) {
    $(".ask-meta").textContent = "Stopped. Reloading the model…";
    startWorker(model, state.backend, { skipBench: true });
  } else {
    $(".ask-switch").hidden = true;
    $(".ask-meta").innerHTML = `Stopped. <button type="button" class="ask-reload">Reload model (${mb(totalBytes(model))} download)</button>`;
  }
}

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

async function main() {
  if (!root || !WORKER_URL) return;
  state.cap = await probe();
  state.backend = state.cap.device;
  renderIdle();
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.disabled) return;
    if (t.matches(".ask-load")) startWorker(modelById(t.dataset.model), state.backend);
    else if (t.matches(".ask-retry")) startWorker(state.model, state.backend);
    else if (t.matches(".ask-reload")) startWorker(state.model, state.backend, { skipBench: !!state.bench });
    else if (t.matches(".ask-retry-wasm")) {
      state.backend = "wasm";
      startWorker(state.model, "wasm");
    } else if (t.matches(".ask-stop")) stop();
    else if (t.matches(".ask-switch, .ask-choose")) {
      state.worker?.terminate();
      state.worker = null;
      state.ready = false;
      state.loading = false;
      renderIdle();
      root.querySelector(`.ask-load[data-model="${MODELS.find((m) => m.role === "default").id}"]`)?.focus();
    } else if (t.matches(".ask-delete")) deleteModels();
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $(".ask-input").value.trim();
    if (q) ask(q);
  });
}

main();
