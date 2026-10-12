// tests/js/ask-models.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODELS, DEFAULT_MODEL_ID, totalBytes, fileUrl } from "../../assets/js/ask/models.js";

const candidates = JSON.parse(readFileSync(new URL("../../scripts/ask_eval/candidates.json", import.meta.url), "utf8"));
const byArm = new Map(candidates.map((c) => [c.arm, c]));

test("registry matches the evaluated candidates (repo, revision, dtype, files)", () => {
  for (const m of MODELS) {
    const c = byArm.get(m.id);
    assert.ok(c, `${m.id} missing from candidates.json`);
    assert.equal(m.repo, c.repo);
    assert.equal(m.revision, c.revision);
    assert.equal(m.dtype, c.dtype);
    assert.deepEqual(m.files, c.files);
    assert.equal(totalBytes(m), c.total_bytes);
  }
});

test("one default, three demonstrators, default first", () => {
  assert.equal(MODELS[0].id, DEFAULT_MODEL_ID);
  assert.equal(MODELS.filter((m) => m.role === "default").length, 1);
  assert.equal(MODELS.filter((m) => m.role === "demo").length, 3);
});

test("fileUrl pins the revision", () => {
  const m = MODELS[0];
  assert.equal(fileUrl(m, "config.json"), `https://huggingface.co/${m.repo}/resolve/${m.revision}/config.json`);
});
