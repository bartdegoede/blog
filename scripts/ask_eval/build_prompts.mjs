// scripts/ask_eval/build_prompts.mjs
// questions.yaml -> results/prompts.jsonl: one row per question with the
// retrieved chunks, the best score (for the relevance gate), whether
// retrieval found a relevant post, and the exact chat messages every arm gets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "yaml";
import { loadIndexFromDisk, scoreQuery } from "./node_index.mjs";
import { topChunks } from "../../assets/js/ask/retrieve.js";
import { TOP_K, buildMessages } from "../../assets/js/ask/prompt.js";

const questions = parse(readFileSync(new URL("./questions.yaml", import.meta.url), "utf8"));
const idx = loadIndexFromDisk();
const out = new URL("./results/", import.meta.url);
mkdirSync(out, { recursive: true });

const rows = questions.map((q) => {
  const top = topChunks(scoreQuery(idx, q.question), idx.chunks, TOP_K);
  const passages = top.map((t) => t.chunk);
  const posts = [...new Set(passages.map((p) => p.post))];
  return {
    id: q.id,
    question: q.question,
    family: q.family,
    relevant: q.relevant,
    best_score: top[0]?.score ?? 0,
    retrieved_posts: posts,
    retrieval_hit: q.relevant.some((r) => posts.includes(r)),
    passages: passages.map(({ post, title, heading, snippet }) => ({ post, title, heading, snippet })),
    messages: buildMessages(q.question, passages),
  };
});
writeFileSync(new URL("prompts.jsonl", out), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const answerable = rows.filter((r) => r.family !== "negative");
console.log(`${rows.length} prompts; retrieval hit@${TOP_K} on answerable: ` +
  `${answerable.filter((r) => r.retrieval_hit).length}/${answerable.length}`);
