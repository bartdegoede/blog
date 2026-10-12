// assets/js/ask/display.js
/**
 * Post-processing for generated answers. The eval found small models emit
 * leading passage markers ("[3] ...") and run past the requested two
 * sentences; the worker uses clampSentences() to stop generating early and
 * the page shows formatAnswer(). Zero imports.
 */

const ABBREVIATION = /(?:\b(?:e\.g|i\.e|etc|vs|cf|approx|Mr|Mrs|Dr)\.)$/i;
const LIST_NUMBER = /(?:^|\s)\d+\.$/;

export function stripLeadingMarkers(text) {
  return text.replace(/^\s*(?:\[\d+\]\s*)+/, "");
}

/**
 * Cut `text` after its `n`th sentence.
 * @param {boolean} final - true when generation has finished: end of text then
 *   counts as a sentence end. While streaming, a "." with nothing after it may
 *   still become "3.5", so it doesn't count yet.
 * @returns {{text: string, complete: boolean}} complete = n sentences found
 */
export function clampSentences(text, n, final) {
  const re = final ? /[.!?](?=\s|$)/g : /[.!?](?=\s)/g;
  let count = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const upto = text.slice(0, m.index + 1);
    if (ABBREVIATION.test(upto) || LIST_NUMBER.test(upto)) continue;
    count++;
    if (count === n) return { text: upto, complete: true };
  }
  return { text, complete: false };
}

export function formatAnswer(raw, n) {
  return clampSentences(stripLeadingMarkers(raw).trim(), n, true).text;
}
