// THE GATE: proof that the JS search pipeline reproduces Python's ranking.
//
// Every module under assets/js/semantic/ can pass its own unit tests while
// the pipeline as a whole disagrees with what sss_eval computed (and what
// the blog post's numbers are based on). This file loads the exact bytes
// static/search/ ships and the exact 36-query fixture
// scripts/gen_parity_fixture.py derived from Python, and checks the two
// never drift.
//
// Reference note: tests/fixtures/parity.json's `semantic_ranking` is
// computed from the *reconstructed int8 table* (tokens[id]*scales[id]),
// which is what the browser actually does -- not from model2vec's
// `StaticModel.encode()`, which reads a different (fp32) table and
// disagrees on ranking for 4 of the 30 eval queries. If a case here fails
// on exactly murmurhash / qwen3 / "letting a language model modernize an
// ancient codebase" / "make an audio version of a blog post", the fixture
// used the wrong reference -- do not "fix" tokenizer.js/embed.js/search.js
// for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WordPiece } from "../../assets/js/semantic/tokenizer.js";
import { embedQuery } from "../../assets/js/semantic/embed.js";
import { cosineScores, rollupToPosts, rrf } from "../../assets/js/semantic/search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const SEARCH_DIR = path.join(ROOT, "static", "search");

// A Buffer from node:fs is a view into Node's pooled allocator for small
// files: its .buffer is NOT necessarily sized to the file. Slicing out
// exactly [byteOffset, byteOffset+byteLength) before handing it to a typed
// array constructor is required, or Int8Array/Float32Array will happily
// read neighboring garbage from the pool.
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// Mirrors the WORDPIECE_OPTS constant in assets/js/semantic/index.js (not
// exported, so duplicated here rather than reaching into module internals).
const WORDPIECE_OPTS = { unkToken: "[UNK]", prefix: "##", maxCharsPerWord: 100 };

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const manifest = readJson(path.join(SEARCH_DIR, "manifest.json"));
const fixture = readJson(path.join(ROOT, "tests", "fixtures", "parity.json"));

// If this fails, static/search was rebuilt (new content hashes) without
// regenerating the fixture -- every case below would then be comparing
// against a stale reference and any pass/fail is meaningless.
test("fixture describes the currently shipped index", () => {
  assert.deepEqual(
    manifest.files,
    fixture.manifest_files,
    "static/search was rebuilt; regenerate tests/fixtures/parity.json"
  );
});

const { docs, tokens, scales, vocab, chunks } = manifest.files;

const vocabJson = readJson(path.join(SEARCH_DIR, vocab));
const chunksJson = readJson(path.join(SEARCH_DIR, chunks));
const tokensArr = new Int8Array(toArrayBuffer(readFileSync(path.join(SEARCH_DIR, tokens))));
const scalesArr = new Float32Array(toArrayBuffer(readFileSync(path.join(SEARCH_DIR, scales))));
const docsArr = new Int8Array(toArrayBuffer(readFileSync(path.join(SEARCH_DIR, docs))));

const wp = new WordPiece(vocabJson, WORDPIECE_OPTS);
const posts = chunksJson.map((c) => c.post);
const dims = manifest.dims;
const nChunks = manifest.n_chunks;

for (const c of fixture.cases) {
  const label = c.query === "" ? "(empty query)" : c.query.length > 50 ? c.query.slice(0, 50) + "..." : c.query;

  test(`tokenizer parity: ${label}`, () => {
    assert.deepEqual(wp.encode(c.query), c.ids);
  });

  test(`ranking + fusion parity: ${label}`, () => {
    const ids = wp.encode(c.query);

    if (ids.length === 0) {
      // A zero vector has no direction; only shape (empty ids/ranking) is
      // meaningful here, not cosine similarity.
      assert.deepEqual(c.ids, []);
      assert.deepEqual(c.semantic_ranking, []);
      const hybrid = rrf([fixture.fuse_rankings[c.query] ?? [], []]).map(([d]) => d);
      assert.deepEqual(hybrid, c.hybrid_ranking);
      return;
    }

    const vector = embedQuery(ids, tokensArr, scalesArr, dims);

    // Vector parity vs the shipped int8 table: same bytes, same arithmetic
    // (mean-pool then L2-normalize), so this should be near-exact. The gap
    // that remains is float32-sequential (JS) vs numpy's pairwise-summation
    // (Python) accumulation, not a real disagreement.
    const cosQuant = cosine(vector, c.vector_quant);
    assert.ok(cosQuant >= 0.99999, `cosine(js, vector_quant) = ${cosQuant} for ${label}`);

    // Vector fidelity vs the real fp32 model: this is the quantization
    // claim itself. Measured worst case across the eval set is 0.999966.
    const cosExact = cosine(vector, c.vector_exact);
    assert.ok(cosExact >= 0.999, `cosine(js, vector_exact) = ${cosExact} for ${label}`);

    const scores = cosineScores(vector, docsArr, nChunks, dims);
    const jsSemanticRanking = rollupToPosts(posts, scores).map(([post]) => post);
    assert.deepEqual(jsSemanticRanking, c.semantic_ranking);

    const hybrid = rrf([fixture.fuse_rankings[c.query] ?? [], jsSemanticRanking]).map(([d]) => d);
    assert.deepEqual(hybrid, c.hybrid_ranking);
  });
}

// The trap, stated as a test: a word longer than max_input_chars_per_word
// (100) tokenizes to [UNK], which model2vec DELETES rather than embeds. So
// "bloom <121 z's> filter" must behave exactly as if the over-long word were
// never typed -- identical ids, identical ranking, to plain "bloom filter".
// If a refactor keeps [UNK] instead of deleting it, the over-long query gets
// a spurious extra token and this equality breaks (while the plain query
// stays fine, isolating the regression to the deletion path).
test("an over-length word is deleted, leaving the query identical to its clean form", () => {
  const overlong = fixture.cases.find((c) => c.query === "bloom " + "z".repeat(120) + " filter");
  const clean = fixture.cases.find((c) => c.query === "bloom filter");
  assert.ok(overlong && clean, "both the over-long and clean 'bloom filter' cases must be in the fixture");

  // Non-empty: this is the "word vanishes but the rest survives" case, not
  // the "whole query is one over-long word -> empty" case.
  assert.deepEqual(overlong.ids, [12432, 10313]);
  assert.ok(overlong.semantic_ranking.length > 0, "over-long case must still rank");
  assert.deepEqual(overlong.semantic_ranking, clean.semantic_ranking);
});
