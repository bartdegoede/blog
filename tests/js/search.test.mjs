import { test } from "node:test";
import assert from "node:assert/strict";
import { embedQuery } from "../../assets/js/semantic/embed.js";
import { cosineScores, rollupToPosts, rrf } from "../../assets/js/semantic/search.js";

test("a doc ranked third by both engines beats a doc ranked first by one", () => {
  const fused = rrf([["x", "p", "q"], ["y", "r", "q"]], 60);
  assert.equal(fused[0][0], "q");
  assert.ok(Math.abs(fused[0][1] - (1 / 63 + 1 / 63)) < 1e-12);
});

test("rrf ignores documents absent from a list rather than penalizing them", () => {
  const fused = Object.fromEntries(rrf([["a"], ["b"]], 60));
  assert.ok(Math.abs(fused.a - 1 / 61) < 1e-12);
  assert.equal(fused.a, fused.b);
});

test("rrf with a single engine preserves that engine's order", () => {
  assert.deepEqual(rrf([["a", "b", "c"]], 60).map(([d]) => d), ["a", "b", "c"]);
});

test("rrf with no engines returns empty", () => { assert.deepEqual(rrf([], 60), []); });

test("rrf breaks ties lexicographically by doc id", () => {
  assert.deepEqual(rrf([["b", "a"]], 60).map(([d]) => d), ["b", "a"]);
  const tied = rrf([["b"], ["a"]], 60).map(([d]) => d);
  assert.deepEqual(tied, ["a", "b"]);
});

test("rollup keeps the best chunk per post and sorts descending", () => {
  assert.deepEqual(rollupToPosts(["a","b","a","b"], [0.1,0.9,0.7,0.2]), [["b",0.9],["a",0.7]]);
});

test("rollup breaks score ties by post id ascending", () => {
  assert.deepEqual(rollupToPosts(["b","a"], [0.5,0.5]), [["a",0.5],["b",0.5]]);
});

test("a zero query vector scores zero, not NaN", () => {
  const s = cosineScores(new Float32Array([0, 0]), Int8Array.from([127, 0]), 1, 2);
  assert.equal(s[0], 0);
});

test("a zero doc row scores zero, not NaN", () => {
  const s = cosineScores(Float32Array.from([1, 0]), Int8Array.from([0, 0]), 1, 2);
  assert.equal(s[0], 0);
});

test("scoring raw int8 docs matches scoring dequantized float docs", () => {
  const q = Float32Array.from([0.6, -0.4, 0.2]);
  const i8 = Int8Array.from([100, -100, 50]);
  const f32 = Float32Array.from([100/127, -100/127, 50/127]);
  const a = cosineScores(q, i8, 1, 3)[0];
  const b = cosineScores(q, f32, 1, 3)[0];
  assert.ok(Math.abs(a - b) < 1e-6);
});

test("embedQuery of an empty id list is a zero vector, not NaN", () => {
  const v = embedQuery([], Int8Array.from([1,2,3,4]), Float32Array.from([0.5,0.5]), 2);
  assert.equal(v.length, 2);
  assert.ok(v.every((x) => x === 0));
});

test("embedQuery applies the PER-ROW scale before pooling", () => {
  // two rows: [1,0] scaled 1.0, and [0,1] scaled 100.0
  // mean is dominated by the second row, so the result points at +y
  const tokens = Int8Array.from([1, 0, 0, 1]);
  const scales = Float32Array.from([1.0, 100.0]);
  const v = embedQuery([0, 1], tokens, scales, 2);
  assert.ok(v[1] > 0.99, `expected +y dominance, got ${v}`);
});

test("embedQuery returns a unit vector", () => {
  const tokens = Int8Array.from([3, 4, 1, 1]);
  const scales = Float32Array.from([1.0, 1.0]);
  const v = embedQuery([0, 1], tokens, scales, 2);
  assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-6);
});
