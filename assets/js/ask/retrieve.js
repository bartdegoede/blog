// assets/js/ask/retrieve.js
/**
 * Chunk-level retrieval for /ask/.
 *
 * The homepage search rolls chunks up to posts; /ask/ needs the passages
 * themselves, so this keeps chunk granularity. Zero imports: runs in the
 * browser, the Web Worker, and under `node --test` unchanged.
 */

/**
 * @param {Float32Array|number[]} scores - one cosine score per chunk
 * @param {object[]} chunks - chunks.json records, same order as scores
 * @param {number} k
 * @returns {Array<{index: number, score: number, chunk: object}>} best first;
 *   ties broken by chunk index ascending so results are deterministic
 */
export function topChunks(scores, chunks, k) {
  if (scores.length !== chunks.length) {
    throw new Error(`topChunks: scores length ${scores.length} != chunks length ${chunks.length}`);
  }
  const order = Array.from(scores, (score, index) => ({ index, score }));
  order.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
  return order.slice(0, k).map(({ index, score }) => ({ index, score, chunk: chunks[index] }));
}
