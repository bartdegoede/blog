// Loads the exact bytes static/search/ ships, the same way tests/js/parity.test.mjs does.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WordPiece } from "../../assets/js/semantic/tokenizer.js";
import { embedQuery } from "../../assets/js/semantic/embed.js";
import { cosineScores } from "../../assets/js/semantic/search.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "static", "search");
// Mirrors WORDPIECE_OPTS in assets/js/semantic/index.js (not exported).
const WORDPIECE_OPTS = { unkToken: "[UNK]", prefix: "##", maxCharsPerWord: 100 };

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const json = (f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));

export function loadIndexFromDisk() {
  const manifest = json("manifest.json");
  const f = manifest.files;
  return {
    manifest,
    docs: new Int8Array(ab(readFileSync(path.join(DIR, f.docs)))),
    tokens: new Int8Array(ab(readFileSync(path.join(DIR, f.tokens)))),
    scales: new Float32Array(ab(readFileSync(path.join(DIR, f.scales)))),
    chunks: json(f.chunks),
    wp: new WordPiece(json(f.vocab), WORDPIECE_OPTS),
  };
}

/** @returns {Float32Array} one cosine score per chunk (all zeros for an empty/OOV query) */
export function scoreQuery(idx, query) {
  const ids = idx.wp.encode(query);
  const { dims, n_chunks } = idx.manifest;
  if (ids.length === 0) return new Float32Array(n_chunks);
  return cosineScores(embedQuery(ids, idx.tokens, idx.scales, dims), idx.docs, n_chunks, dims);
}
