"""Generate tests/fixtures/parity.json: the JS/Python search parity gate.

This is not a spot check. `assets/js/semantic/{tokenizer,embed,search,index}.js`
can each pass their own unit tests while the whole pipeline still disagrees
with what Python (and therefore the eval numbers quoted on the blog) computed.
This script re-derives, in Python, exactly what the browser is supposed to
produce for a fixed set of queries, so `tests/js/parity.test.mjs` can assert
the two never drift.

Reference correctness matters more than anything else in this file: the
browser never sees model2vec's fp32 embedding table. It reconstructs each
token row from the shipped int8 table as

    row[d] = tokens[id * dims + d] * scales[id]

which is measurably different from `StaticModel.encode()` (worst per-query
cosine 0.999966, and four of the 30 eval queries actually change rank order
between the two references). So `semantic_ranking` below is computed from
the reconstructed int8 table, matching search.js/embed.js bit for bit in
approach -- never from `model.encode()`. `vector_exact` is recorded
separately, purely so the JS test can assert *fidelity* to the real model
without using it as the ranking oracle.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import yaml
from model2vec import StaticModel
from sss_eval.rank import cosine_scores, rollup_to_posts, rrf

ROOT = Path(__file__).resolve().parent.parent
SEARCH_DIR = ROOT / "static" / "search"
PUBLIC_INDEX = ROOT / "public" / "index.json"
FUSE_HELPER = ROOT / "scripts" / "fuse_rank.mjs"
QUERIES_YAML = Path("~/projects/static-site-search-eval/examples/degoe-de/queries.yaml").expanduser()
OUT_PATH = ROOT / "tests" / "fixtures" / "parity.json"

# Six edge cases appended to the 30 eval queries. See the task write-up for
# why each one is interesting; ids are asserted, not just eyeballed.
EDGE_CASES = [
    "",
    "zzzzqqqq",
    "日本語のみ",  # "japanese only" -- exercises handle_chinese_chars
    "café naïve",  # accents must strip to match "cafe naive"
    "C++ vs C#",  # punctuation isolation
    # --- [UNK]-deletion trap (tokenizer.js trap #2), end-to-end ---
    # With a 29,528-token WordPiece vocab, every single character is in
    # vocab, so [UNK] is UNREACHABLE by ordinary text -- the only route to it
    # is max_input_chars_per_word (100): a word longer than 100 code points
    # tokenizes to [UNK] outright, which model2vec then DELETES from the id
    # sequence rather than embedding. Without a >100-char word here, that
    # deletion path is dead code as far as this gate is concerned, and a
    # refactor that "keeps [UNK]" instead of dropping it would sail through.
    # The first two go fully empty (whole query is one over-long word); the
    # third proves the over-long word vanishes cleanly, leaving the query
    # identical to "bloom filter".
    "a" * 101,
    "supercalifragilistic" * 8,  # 160 chars, one word
    "bloom " + "z" * 120 + " filter",
    "bloom filter",  # reference for the case above; ids must match exactly
    # ~200 words, no truncation expected (potion's seq_length is 1,000,000).
    (
        "In the beginning the corpus was small and every query was a single word, "
        "but as the blog grew the search index had to grow with it, chunk by chunk, "
        "post by post, until it became clear that no amount of clever tokenization "
        "could substitute for a careful evaluation harness that actually measured "
        "recall and precision instead of assuming a vector database would simply "
        "do the right thing by default. Static site generators like Hugo build "
        "everything ahead of time, which means the search index has to be baked "
        "into a handful of content-hashed files that a browser can fetch lazily, "
        "tokenize locally, and score against without ever making a network call "
        "to a model server. That constraint is what makes int8 quantization "
        "attractive: a twenty-nine-thousand row embedding table shrinks by a "
        "factor of four, at the cost of a small and carefully measured amount of "
        "ranking noise that this very fixture exists to bound precisely, query by "
        "query, so that nobody ships a regression by accident while refactoring "
        "the tokenizer or the cosine similarity kernel six months from now when "
        "the details have been forgotten and only the tests remember them for us."
    ),
]


def load_manifest():
    manifest = json.loads((SEARCH_DIR / "manifest.json").read_text())
    files = manifest["files"]
    vocab = json.loads((SEARCH_DIR / files["vocab"]).read_text())
    chunks = json.loads((SEARCH_DIR / files["chunks"]).read_text())
    tokens_bytes = (SEARCH_DIR / files["tokens"]).read_bytes()
    scales_bytes = (SEARCH_DIR / files["scales"]).read_bytes()
    docs_bytes = (SEARCH_DIR / files["docs"]).read_bytes()
    return manifest, vocab, chunks, tokens_bytes, scales_bytes, docs_bytes


def load_queries():
    entries = yaml.safe_load(QUERIES_YAML.read_text())
    queries = [e["query"] for e in entries]
    assert len(queries) == 30, f"expected 30 eval queries, got {len(queries)}"
    return queries


def fuse_rankings_for(queries):
    if not PUBLIC_INDEX.exists():
        print("public/index.json missing, running hugo...", file=sys.stderr)
        subprocess.run(["hugo"], cwd=ROOT, check=True)
    proc = subprocess.run(
        ["node", str(FUSE_HELPER)],
        input=json.dumps(queries),
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(proc.stdout)


def main():
    manifest, vocab, chunks, tokens_bytes, scales_bytes, docs_bytes = load_manifest()
    dims = manifest["dims"]
    vocab_size = manifest["vocab_size"]
    n_chunks = manifest["n_chunks"]

    tokens = np.frombuffer(tokens_bytes, dtype=np.int8).reshape(vocab_size, dims)
    scales = np.frombuffer(scales_bytes, dtype="<f4")
    assert scales.shape == (vocab_size,)
    table = tokens.astype(np.float32) * scales[:, None]  # exactly what the browser reconstructs
    docs = np.frombuffer(docs_bytes, dtype=np.int8).reshape(n_chunks, dims).astype(np.float32)
    posts = [c["post"] for c in chunks]

    eval_queries = load_queries()
    all_queries = eval_queries + EDGE_CASES

    print(f"loading {manifest['model_id']} ({dims}d)...", file=sys.stderr)
    model = StaticModel.from_pretrained(manifest["model_id"], dimensionality=dims)

    fuse_rankings = fuse_rankings_for(all_queries)

    zeros = np.zeros(dims, dtype=np.float32)
    cases = []
    for query in all_queries:
        ids = model.tokenize([query])[0]
        if ids:
            vq = table[ids].mean(axis=0)
            vq = vq / np.linalg.norm(vq)
            scores = cosine_scores(vq.astype(np.float32), docs)
            semantic_ranking = [p for p, _ in rollup_to_posts(posts, scores)]
            vector_exact = model.encode([query])[0]
        else:
            vq, semantic_ranking, vector_exact = zeros, [], zeros

        fuse_ranking = fuse_rankings.get(query, [])
        hybrid_ranking = [d for d, _ in rrf([fuse_ranking, semantic_ranking])]

        cases.append(
            {
                "query": query,
                "ids": list(ids),
                "vector_quant": [float(x) for x in vq],
                "vector_exact": [float(x) for x in vector_exact],
                "semantic_ranking": semantic_ranking,
                "hybrid_ranking": hybrid_ranking,
            }
        )
        print(f"  {query[:60]!r:64s} ids={len(ids):3d} ranking_top1={semantic_ranking[:1]}", file=sys.stderr)

    fixture = {
        "sss_eval_version": manifest["sss_eval_version"],
        "manifest_files": manifest["files"],
        "fuse_rankings": {q: fuse_rankings.get(q, []) for q in all_queries},
        "cases": cases,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes)", file=sys.stderr)

    print("\nedge case ids:", file=sys.stderr)
    for query, case in zip(all_queries[-len(EDGE_CASES) :], cases[-len(EDGE_CASES) :]):
        label = query if len(query) < 40 else query[:40] + "..."
        print(f"  {label!r}: {case['ids']}", file=sys.stderr)


if __name__ == "__main__":
    main()
