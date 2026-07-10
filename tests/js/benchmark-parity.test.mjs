// Proves the frozen benchmark doc vectors reproduce Python's ranking.
//
// The widget scores a reader's query against static/search-benchmark/<arm>/docs.bin
// using the SAME cosineScores/rollupToPosts as the shipped search. This gate pins that
// the frozen int8 vectors, read exactly as the browser reads them, rank the 30 eval
// queries identically to Python. Regenerate the fixture only if the artifacts
// legitimately change: uv run python scripts/gen_benchmark_fixture.py
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cosineScores, rollupToPosts } from "../../assets/js/semantic/search.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const benchDir = path.join(root, "static", "search-benchmark");

const manifest = JSON.parse(readFileSync(path.join(benchDir, "manifest.json"), "utf8"));
const chunks = JSON.parse(readFileSync(path.join(benchDir, "chunks.json"), "utf8"));
const fixture = JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "benchmark-parity.json"), "utf8"));

const posts = chunks.map((c) => c.post);

function readInt8(file) {
  const buf = readFileSync(file);
  // Detach from Node's pooled Buffer or we read the whole allocation.
  return new Int8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

test("the benchmark corpus is the frozen 13-post / 313-chunk snapshot", () => {
  assert.equal(chunks.length, 313);
  assert.equal(manifest.n_chunks, 313);
  assert.equal(manifest.frozen, true);
  assert.equal(manifest.arms.potion.docs, null, "potion must reuse the live index, not ship vectors");
});

for (const [arm, meta] of Object.entries(manifest.arms)) {
  if (!meta.docs) continue;

  test(`${arm}: docs.bin is int8 313 x ${meta.dims}`, () => {
    const docs = readInt8(path.join(benchDir, meta.docs));
    assert.equal(docs.length, 313 * meta.dims);
  });

  test(`${arm}: JS ranking over the frozen int8 vectors matches Python for all 30 queries`, () => {
    const docs = readInt8(path.join(benchDir, meta.docs));
    for (const c of fixture.arms[arm]) {
      const scores = cosineScores(Float32Array.from(c.query_vector), docs, 313, meta.dims);
      const ranking = rollupToPosts(posts, scores).map(([p]) => p);
      assert.deepEqual(ranking, c.ranking, `${arm} / ${JSON.stringify(c.query)}`);
    }
  });
}
