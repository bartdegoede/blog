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

test("label shows 100% and no ETA once every byte is in", () => {
  const now = clock();
  const p = new DownloadProgress([{ path: "a", bytes: 258451784 }], now);
  p.update("a", 0);
  now.advance(1000);
  p.update("a", 100000000);
  now.advance(1000);
  p.update("a", 258451784); // exact size, via update()
  assert.equal(p.loadedBytes, p.total);
  assert.equal(p.label(), "258 / 258 MB · 100%");
});

test("label never shows the full MB total before every byte is in", () => {
  const p = new DownloadProgress([{ path: "a", bytes: 258451784 }], clock());
  p.update("a", 257900000); // 99.8%: rounding the MB would read "258 / 258 MB · 99%"
  assert.match(p.label(), /^257 \/ 258 MB · 99%/);
});
