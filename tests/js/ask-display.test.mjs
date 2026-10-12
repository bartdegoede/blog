// tests/js/ask-display.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripLeadingMarkers, clampSentences, formatAnswer, cleanSnippet, linkCitations } from "../../assets/js/ask/display.js";

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

test("linkCitations links in-range [n] markers to source anchors", () => {
  assert.equal(
    linkCitations("Bloom filters use bits [1] and hashes [2].", 4),
    'Bloom filters use bits <a class="ask-cite" href="#ask-src-1">1</a> and hashes <a class="ask-cite" href="#ask-src-2">2</a>.'
  );
  assert.equal(linkCitations("See [1][3].", 3), 'See <a class="ask-cite" href="#ask-src-1">1</a><a class="ask-cite" href="#ask-src-3">3</a>.');
});

test("linkCitations leaves out-of-range and non-numeric brackets alone", () => {
  assert.equal(linkCitations("Zero [0], five [5], word [a], empty [].", 4), "Zero [0], five [5], word [a], empty [].");
  assert.equal(linkCitations("No markers here", 4), "No markers here");
  assert.equal(linkCitations("x [1]", 0), "x [1]");
});

test("linkCitations works on already-escaped text", () => {
  assert.equal(linkCitations("a &lt;b&gt; [2]", 2), 'a &lt;b&gt; <a class="ask-cite" href="#ask-src-2">2</a>');
});
