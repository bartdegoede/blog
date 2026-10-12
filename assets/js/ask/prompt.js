// assets/js/ask/prompt.js
/**
 * Prompt assembly for /ask/. Shared verbatim by the browser worker (Part 2)
 * and the eval harness, so the eval measures exactly what ships.
 * Zero imports.
 */

export const TOP_K = 4;
export const MAX_NEW_TOKENS = 120;
// ~1,200 tokens at ~4 chars/token. Four chunks average ~1,900 chars, so this
// only bites on unusually long chunks; it exists to keep WASM prefill bounded.
export const MAX_PASSAGE_CHARS = 4800;

export const SYSTEM_PROMPT =
  "You answer questions about a personal technical blog. " +
  "Use only the numbered passages provided. " +
  "Answer in at most 2 sentences. " +
  "If the passages do not answer the question, say that the blog does not seem to cover it.";

function label(p, i) {
  return `[${i + 1}] ${p.title}${p.heading ? ` — ${p.heading}` : ""}`;
}

/**
 * @param {string} question
 * @param {Array<{title: string, heading: string|null, snippet: string}>} passages - best first
 * @returns {Array<{role: "system"|"user", content: string}>}
 */
export function buildMessages(question, passages) {
  const parts = [];
  let used = 0;
  for (let i = 0; i < passages.length; i++) {
    if (used >= MAX_PASSAGE_CHARS) break;
    const head = label(passages[i], i);
    const room = MAX_PASSAGE_CHARS - used - head.length - 2;
    if (room <= 0) break;
    const body = passages[i].snippet.slice(0, room);
    parts.push(`${head}\n${body}`);
    used += head.length + body.length + 2;
  }
  const user = `Passages:\n\n${parts.join("\n\n")}\n\nQuestion: ${question}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/**
 * For chat templates without a system role: prepend the system prompt to the
 * first user message.
 */
export function foldSystem(messages) {
  const [sys, first, ...rest] = messages;
  if (sys.role !== "system") return messages;
  return [{ role: "user", content: `${sys.content}\n\n${first.content}` }, ...rest];
}
