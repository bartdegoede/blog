import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, preTokenize, WordPiece } from "../../assets/js/semantic/tokenizer.js";

const vocab = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]",
  "hello", "world", "cafe", "un", "##aff", "##able", "bloom", "filter", ".", ","];
const wp = new WordPiece(vocab, { unkToken: "[UNK]", prefix: "##", maxCharsPerWord: 100 });

test("normalizer lowercases", () => {
  assert.equal(normalize("Hello WORLD"), "hello world");
});

test("normalizer strips accents, because strip_accents:null inherits lowercase:true", () => {
  assert.equal(normalize("café naïve"), "cafe naive");
});

test("normalizer deletes control characters outright", () => {
  assert.equal(normalize("a\u0000b"), "ab");
});

test("normalizer turns tabs and newlines into single spaces", () => {
  assert.equal(normalize("a b\tc\nd"), "a b c d");
});

test("pre-tokenizer splits on whitespace and isolates punctuation", () => {
  assert.deepEqual(preTokenize("hello, world."), ["hello", ",", "world", "."]);
});

test("wordpiece does greedy longest-match-first with ## continuation", () => {
  assert.deepEqual(wp.tokenize("unaffable"), ["un", "##aff", "##able"]);
});

test("an unknown word yields the unk token", () => {
  assert.deepEqual(wp.tokenize("zzzz"), ["[UNK]"]);
});

test("a word longer than maxCharsPerWord is unk without attempting subwords", () => {
  const wpShort = new WordPiece(vocab, { unkToken: "[UNK]", prefix: "##", maxCharsPerWord: 4 });
  assert.deepEqual(wpShort.tokenize("hello"), ["[UNK]"]);
});

test("encode returns ids and DELETES unk rather than embedding it", () => {
  assert.deepEqual(wp.encode("hello zzzz world"), [5, 6]);
});

test("encode adds no [CLS] or [SEP]", () => {
  assert.deepEqual(wp.encode("hello"), [5]);
});

test("an all-out-of-vocabulary query encodes to the empty list", () => {
  assert.deepEqual(wp.encode("zzzz qqqq"), []);
});

test("encode is case and accent insensitive end to end", () => {
  assert.deepEqual(wp.encode("CAFÉ"), wp.encode("cafe"));
});
