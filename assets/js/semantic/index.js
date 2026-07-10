/**
 * Lazy-loading reader for the browser search index in `static/search/`.
 *
 * The five artifact files are content-hashed and therefore immutable once
 * published (docs.<hash>.bin never changes contents under a given hash), so
 * only `manifest.json` - the one file whose name never changes - needs to
 * be cache-busted. Everything it names can be fetched with normal HTTP
 * caching.
 *
 * Zero imports of third-party code; only sibling modules in this directory.
 */

import { WordPiece } from "./tokenizer.js";
import { embedQuery } from "./embed.js";
import { cosineScores, rollupToPosts, rrf } from "./search.js";

// The tokenizer config baked into potion-base-8M's tokenizer.json (BERT
// WordPiece defaults): unk token, "##" continuation prefix for non-leading
// subwords, and a 100-char ceiling per word before giving up and emitting
// [UNK] outright.
const WORDPIECE_OPTS = { unkToken: "[UNK]", prefix: "##", maxCharsPerWord: 100 };

// Memoize the in-flight *promise*, not its resolved value: two concurrent
// callers (e.g. two `focus` events firing before the first fetch lands)
// must share one fetch, not each kick off their own.
let indexPromise = null;

function assertByteLength(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `search index corrupt: ${label} byte length is ${actual}, expected ${expected} ` +
        "(a truncated or misaligned fetch shifts every vector by a row and produces " +
        "plausible-looking nonsense - refusing to proceed)"
    );
  }
}

function assertLength(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`search index corrupt: ${label} has ${actual} entries, expected ${expected}`);
  }
}

async function fetchIndex(base) {
  const manifestRes = await fetch(`${base}/manifest.json`, { cache: "no-cache" });
  if (!manifestRes.ok) {
    throw new Error(`failed to fetch ${base}/manifest.json: HTTP ${manifestRes.status}`);
  }
  const manifest = await manifestRes.json();

  if (manifest.sss_eval_version !== "0.1.0") {
    console.warn(
      `search index manifest declares sss_eval_version "${manifest.sss_eval_version}", ` +
        'but this reader was written against "0.1.0" - artifacts and reader have drifted'
    );
  }

  const { docs, tokens, scales, vocab, chunks } = manifest.files;

  const [docsBuf, tokensBuf, scalesBuf, vocabJson, chunksJson] = await Promise.all([
    fetch(`${base}/${docs}`).then((r) => r.arrayBuffer()),
    fetch(`${base}/${tokens}`).then((r) => r.arrayBuffer()),
    fetch(`${base}/${scales}`).then((r) => r.arrayBuffer()),
    fetch(`${base}/${vocab}`).then((r) => r.json()),
    fetch(`${base}/${chunks}`).then((r) => r.json()),
  ]);

  const docsArr = new Int8Array(docsBuf);
  const tokensArr = new Int8Array(tokensBuf);
  // scales.bin is little-endian float32; Float32Array reads little-endian
  // on every platform browsers ship on, so this is correct as-is.
  const scalesArr = new Float32Array(scalesBuf);

  assertByteLength(docsArr.byteLength, manifest.n_chunks * manifest.dims, "docs.bin");
  assertByteLength(tokensArr.byteLength, manifest.vocab_size * manifest.dims, "tokens.bin");
  assertByteLength(scalesArr.byteLength, manifest.vocab_size * 4, "scales.bin");
  assertLength(vocabJson.length, manifest.vocab_size, "vocab.json");
  assertLength(chunksJson.length, manifest.n_chunks, "chunks.json");

  const wp = new WordPiece(vocabJson, WORDPIECE_OPTS);

  return {
    manifest,
    docs: docsArr,
    tokens: tokensArr,
    scales: scalesArr,
    vocab: vocabJson,
    chunks: chunksJson,
    wp,
  };
}

/**
 * @param {string} [base="/search"]
 * @returns {Promise<object>} memoized - the fetch only ever happens once
 */
export function loadIndex(base = "/search") {
  if (!indexPromise) {
    indexPromise = fetchIndex(base);
  }
  return indexPromise;
}

/**
 * @param {string} query
 * @returns {Promise<Array<[post: any, score: number]>>}
 */
export async function searchSemantic(query) {
  const idx = await loadIndex();
  const ids = idx.wp.encode(query);
  // An empty query, or one that's entirely out-of-vocabulary, must return
  // no results - not 313 posts all tied at score 0.
  if (ids.length === 0) return [];

  const vector = embedQuery(ids, idx.tokens, idx.scales, idx.manifest.dims);
  const scores = cosineScores(vector, idx.docs, idx.manifest.n_chunks, idx.manifest.dims);
  const posts = idx.chunks.map((chunk) => chunk.post);
  return rollupToPosts(posts, scores);
}

/**
 * @param {string} query
 * @param {any[]} keywordRanking - post ids, best first, from the existing
 *   Fuse.js search
 * @returns {Promise<Array<[post: any, score: number]>>}
 */
export async function searchHybrid(query, keywordRanking) {
  const semanticRanking = (await searchSemantic(query)).map(([post]) => post);
  return rrf([keywordRanking, semanticRanking]);
}

/**
 * @returns {Promise<Array<object>>} the chunks.json records, in docs.bin row order
 */
export async function getChunks() {
  const idx = await loadIndex();
  return idx.chunks;
}
