// tests/js/ask-prompt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_PROMPT, TOP_K, MAX_NEW_TOKENS, MAX_PASSAGE_CHARS,
  buildMessages, foldSystem,
} from "../../assets/js/ask/prompt.js";

const passages = [
  { title: "Bloom filters", heading: "Hashing", snippet: "A bloom filter uses k hash functions." },
  { title: "Lunr search", heading: null, snippet: "Lunr builds an index at build time." },
];

test("constants match the spec", () => {
  assert.equal(TOP_K, 4);
  assert.equal(MAX_NEW_TOKENS, 120);
  assert.equal(MAX_PASSAGE_CHARS, 4800);
  assert.match(SYSTEM_PROMPT, /at most 2 sentences/);
});

test("buildMessages: system + one user turn with numbered passages then question", () => {
  const msgs = buildMessages("How do bloom filters work?", passages);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, SYSTEM_PROMPT);
  assert.equal(msgs[1].role, "user");
  const u = msgs[1].content;
  assert.ok(u.indexOf("[1] Bloom filters — Hashing") < u.indexOf("[2] Lunr search"));
  assert.ok(u.trimEnd().endsWith("Question: How do bloom filters work?"));
});

const blockOf = (u) => u.slice("Passages:\n\n".length, u.indexOf("\n\nQuestion:"));

test("buildMessages truncates the passage block to MAX_PASSAGE_CHARS", () => {
  const long = [{ title: "T", heading: null, snippet: "x".repeat(10000) }];
  const u = buildMessages("q?", long)[1].content;
  assert.ok(blockOf(u).length <= MAX_PASSAGE_CHARS, `block was ${blockOf(u).length}`);
});

test("buildMessages keeps the exact block within budget and drops passages that no longer fit", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `P${i}`, heading: null, snippet: "y".repeat(600) }));
  const u = buildMessages("q?", many)[1].content;
  assert.ok(blockOf(u).length <= MAX_PASSAGE_CHARS, `block was ${blockOf(u).length}`);
  assert.ok(u.includes("[8] P7"));
  assert.ok(!u.includes("[9] P8"));
});

test("buildMessages skips a passage with less than MIN_PASSAGE_CHARS of room", () => {
  const ps = [
    { title: "A", heading: null, snippet: "a".repeat(4700) },
    { title: "B", heading: null, snippet: "b".repeat(500) },
  ];
  const u = buildMessages("q?", ps)[1].content;
  assert.ok(!u.includes("[2] B"));
  assert.ok(blockOf(u).length <= MAX_PASSAGE_CHARS);
});

test("foldSystem merges the system prompt into the first user turn", () => {
  const folded = foldSystem(buildMessages("q?", passages));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].role, "user");
  assert.ok(folded[0].content.startsWith(SYSTEM_PROMPT));
  assert.ok(folded[0].content.includes("Question: q?"));
});

test("foldSystem leaves messages without a system turn unchanged and does not throw", () => {
  const noSys = [{ role: "user", content: "x" }];
  assert.deepEqual(foldSystem(noSys), noSys);
  assert.doesNotThrow(() => foldSystem([{ role: "system", content: "s" }]));
});
