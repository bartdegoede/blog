// tests/js/ask-retrieve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { topChunks } from "../../assets/js/ask/retrieve.js";

const chunks = [
  { post: "a", snippet: "A0" },
  { post: "b", snippet: "B0" },
  { post: "a", snippet: "A1" },
  { post: "c", snippet: "C0" },
];

test("returns the k highest-scoring chunks, best first, with scores", () => {
  const scores = new Float32Array([0.1, 0.9, 0.5, 0.3]);
  const top = topChunks(scores, chunks, 2);
  assert.deepEqual(top.map((t) => t.chunk.snippet), ["B0", "A1"]);
  assert.ok(Math.abs(top[0].score - 0.9) < 1e-6);
});

test("ties break by chunk index ascending (deterministic)", () => {
  const scores = new Float32Array([0.5, 0.5, 0.5, 0.1]);
  assert.deepEqual(topChunks(scores, chunks, 3).map((t) => t.index), [0, 1, 2]);
});

test("k larger than the corpus returns everything", () => {
  const scores = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  assert.equal(topChunks(scores, chunks, 10).length, 4);
});

test("length mismatch throws instead of silently misaligning", () => {
  assert.throws(() => topChunks(new Float32Array(3), chunks, 2), /length/);
});
