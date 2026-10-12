// tests/js/ask-display.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripLeadingMarkers, clampSentences, formatAnswer, cleanSnippet } from "../../assets/js/ask/display.js";

test("strips leading passage markers only", () => {
  assert.equal(stripLeadingMarkers("[3] Bloom filters use bits."), "Bloom filters use bits.");
  assert.equal(stripLeadingMarkers("[1] [2] Text"), "Text");
  assert.equal(stripLeadingMarkers("Text with [1] inside"), "Text with [1] inside");
});

test("clampSentences counts sentence ends followed by whitespace", () => {
  const t = "First one. Second one! Third one?";
  assert.deepEqual(clampSentences(t, 2, false), { text: "First one. Second one!", complete: true });
});

test("streaming: a trailing period is not yet a sentence end", () => {
  assert.equal(clampSentences("It needs version 3.", 1, false).complete, false);
  assert.equal(clampSentences("It needs version 3.5 now. Next", 1, false).text, "It needs version 3.5 now.");
});

test("final: end of text counts as a sentence end", () => {
  assert.deepEqual(clampSentences("Only one.", 2, true), { text: "Only one.", complete: false });
  assert.equal(clampSentences("One. Two.", 2, true).complete, true);
});

test("abbreviations and list numbers are not sentence ends", () => {
  const t = "Use a filter, e.g. a Bloom filter, for sets. Done. More.";
  assert.equal(clampSentences(t, 2, false).text, "Use a filter, e.g. a Bloom filter, for sets. Done.");
  const list = "Steps:\n1. Add the XML file. 2. Refresh the page. 3. Done.";
  assert.equal(clampSentences(list, 2, false).text, "Steps:\n1. Add the XML file. 2. Refresh the page.");
});

test("formatAnswer strips markers, trims, clamps (final)", () => {
  assert.equal(formatAnswer("  [1] A. B. C.  ", 2), "A. B.");
  assert.equal(formatAnswer("No terminal punctuation", 2), "No terminal punctuation");
});

test("cleanSnippet removes markdown footnote references", () => {
  assert.equal(
    cleanSnippet("Blogging platform Medium uses Bloom filters[^medium_bloom] to filter", "What can I use it for?"),
    "Blogging platform Medium uses Bloom filters to filter"
  );
  assert.equal(cleanSnippet("A claim [^1]. Another[^a][^b] here", null), "A claim. Another here");
});

test("cleanSnippet strips a heading the index prepended, once", () => {
  assert.equal(cleanSnippet("Closing thoughts There are a lot", "Closing thoughts"), "There are a lot");
  assert.equal(cleanSnippet("Indexing Indexing again", "Indexing"), "Indexing again");
  // Only a whole-word prefix counts: "Index" is not the heading of "Indexing ...".
  assert.equal(cleanSnippet("Indexing The project", "Index"), "Indexing The project");
  // A chunk that is only its heading (empty section) cleans to "".
  assert.equal(cleanSnippet("What went well", "What went well"), "");
});

test("cleanSnippet with no heading only removes footnotes and collapses whitespace", () => {
  assert.equal(cleanSnippet("Hugo[^hugo]  framework\n\nworks", null), "Hugo framework works");
  assert.equal(cleanSnippet("Closing thoughts There", null), "Closing thoughts There");
});
