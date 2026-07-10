"""Generate the parity fixture for the frozen benchmark artifacts.

A frozen artifact nobody checks is a frozen lie. This records, per arm and per eval
query, the ranking Python computes from the *quantized* docs.bin we shipped -- so the
JS gate proves the browser reproduces it.

Learned the hard way in Part 2: the reference ranking is computed from the QUANTIZED
int8 bytes, not the original float32 vectors. Quantization reorders near-ties, so a gate
comparing JS-over-int8 against Python-over-float32 fails on correct code.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import yaml

from sss_eval.rank import cosine_scores, rollup_to_posts

OUT = Path("static/search-benchmark")
FIXTURE = Path("tests/fixtures/benchmark-parity.json")
DEFAULT_EVAL = Path.home() / "projects" / "static-site-search-eval"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--eval-repo", type=Path, default=DEFAULT_EVAL)
    args = ap.parse_args()

    manifest = json.loads((OUT / "manifest.json").read_text())
    chunks = json.loads((OUT / "chunks.json").read_text())
    posts = [c["post"] for c in chunks]

    queries = [q["query"] for q in yaml.safe_load((args.eval_repo / "examples" / "degoe-de" / "queries.yaml").read_text())]

    # The Node arms' query vectors live in the eval build output.
    qvecs = {}
    for arm, src in [("minilm", "minilm-c600.json"), ("ternlight", "ternlight-base-c600.json")]:
        payload = json.loads((args.eval_repo / "build" / src).read_text())
        qvecs[arm] = {q: np.asarray(v, dtype=np.float32) for q, v in payload["queryVectors"].items()}

    fixture = {"n_chunks": len(chunks), "arms": {}}
    for arm, meta in manifest["arms"].items():
        if not meta["docs"]:
            continue
        dims = meta["dims"]
        docs = np.frombuffer((OUT / meta["docs"]).read_bytes(), dtype=np.int8).reshape(len(chunks), dims).astype(np.float32)
        cases = []
        for q in queries:
            qv = qvecs[arm][q]
            ranking = [p for p, _ in rollup_to_posts(posts, cosine_scores(qv, docs))]
            cases.append({"query": q, "query_vector": qv.tolist(), "ranking": ranking})
        fixture["arms"][arm] = cases

    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture, ensure_ascii=False))
    n = sum(len(v) for v in fixture["arms"].values())
    print(f"{n} cases across {len(fixture['arms'])} arms -> {FIXTURE} ({FIXTURE.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
