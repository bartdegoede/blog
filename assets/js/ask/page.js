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

const state = { backend: null, model: null, worker: null, progress: null, fromCache: false, busy: false, nextId: 1, currentId: null };

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

function modelCard(m, backend) {
  const blocked = backend === "wasm" && m.webgpuOnly;
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

function renderIdle(cap) {
  const def = MODELS.filter((m) => m.role === "default");
  const demos = MODELS.filter((m) => m.role === "demo");
  const backend =
    cap.device === "webgpu"
      ? "Your browser supports WebGPU: the model runs on your GPU."
      : "No WebGPU with 16-bit support here, so the model runs on your CPU (slower mode): expect roughly 30–60 seconds per answer.";
  // Measured in Task 1: WebGPU 19.8 tok/s; single-threaded WASM 1.2 tok/s
  // (GitHub Pages can't send COOP/COEP, so no WASM threads).
  root.innerHTML = `
    <p class="ask-capability">${esc(backend)}${cap.memoryGb ? ` Device memory: ~${cap.memoryGb} GB.` : ""}</p>
    ${def.map((m) => modelCard(m, cap.device)).join("")}
    <details class="ask-demos">
      <summary>See why size matters: three smaller models</summary>
      <p>These are smaller, but in my eval they were almost never faithful to the passages. Try one to see what that looks like.</p>
      ${demos.map((m) => modelCard(m, cap.device)).join("")}
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
  $(".ask-progress-label").textContent = pct >= 100 ? "Preparing model…" : state.fromCache ? "Loading from cache" : p.label();
  const tiles = root.querySelectorAll(".ask-tile");
  const filled = Math.floor(p.fraction * tiles.length);
  tiles.forEach((t, i) => t.classList.toggle("is-filled", i < filled));
}

async function startWorker(model, device) {
  state.worker?.terminate();
  state.model = model;
  state.progress = new DownloadProgress(model.files);
  state.fromCache = await isCached(model);
  renderLoading(model);
  if (state.fromCache) $(".ask-progress-label").textContent = "Loading from cache";
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
    ${device === "webgpu" && !state.model?.webgpuOnly ? '<button type="button" class="ask-retry-wasm">Try slower mode (CPU)</button>' : ""}`;
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
