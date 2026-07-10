"""Freeze the three-arm benchmark artifacts for the blog post's widget.

The widget compares three *query encoders* -- potion, MiniLM q8, ternlight -- over
identical document chunks. The reader's browser embeds only the query; the document
vectors are precomputed here.

The potion arm needs nothing: it reuses the live `static/search/` index, which is
exactly the arm the site ships.

Unlike `static/search/`, these filenames are **not content-hashed**. They are frozen
at a corpus snapshot, referenced from a published blog post, and must never change.
`static/search/` is hashed precisely because it *does* change whenever a post changes.
`deploy.sh` must not regenerate this directory.
"""

import argparse
import json
import subprocess
from datetime import date
from pathlib import Path

import numpy as np

from sss_eval.quantize import quantize_unit

LIVE = Path("static/search")
OUT = Path("static/search-benchmark")
DEFAULT_EVAL_BUILD = Path.home() / "projects" / "static-site-search-eval" / "build"


def load_node_arm(path: Path) -> tuple[list[str], np.ndarray, dict[str, list[float]]]:
    payload = json.loads(path.read_text())
    vectors = np.asarray(payload["vectors"], dtype=np.float32)
    return payload["posts"], vectors, payload["queryVectors"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--eval-build", type=Path, default=DEFAULT_EVAL_BUILD)
    args = ap.parse_args()

    src = args.eval_build
    for name in ("chunks600.json", "minilm-c600.json", "ternlight-base-c600.json"):
        if not (src / name).exists():
            raise SystemExit(f"missing {src / name} -- regenerate it in the eval repo")

    # The comparison is meaningless unless every arm scores the same documents.
    live_manifest = json.loads((LIVE / "manifest.json").read_text())
    live_chunks = json.loads((LIVE / live_manifest["files"]["chunks"]).read_text())
    bench_chunks = json.loads((src / "chunks600.json").read_text())["chunks"]

    live_posts = [c["post"] for c in live_chunks]
    bench_posts = [c["post"] for c in bench_chunks]
    if live_posts != bench_posts:
        raise SystemExit(
            "chunk order or corpus drift: static/search/ and chunks600.json disagree.\n"
            f"  live: {len(live_posts)} chunks, benchmark: {len(bench_posts)} chunks"
        )
    n_chunks = len(live_chunks)

    OUT.mkdir(parents=True, exist_ok=True)

    # Titles and hrefs for display. No snippets: the widget shows post titles only.
    (OUT / "chunks.json").write_text(
        json.dumps(
            [{"post": c["post"], "title": c["title"], "href": c["href"]} for c in live_chunks],
            ensure_ascii=False,
        )
    )

    arms: dict[str, dict] = {
        "potion": {
            "dims": live_manifest["dims"],
            "docs": None,
            "model": live_manifest["model_id"],
            "note": "reuses the live /search/ index -- the arm the site actually ships",
        }
    }

    for arm, filename, model in [
        ("minilm", "minilm-c600.json", "Xenova/all-MiniLM-L6-v2"),
        ("ternlight", "ternlight-base-c600.json", "@ternlight/base@0.1.0"),
    ]:
        posts, vectors, _ = load_node_arm(src / filename)
        if posts != live_posts:
            raise SystemExit(f"{arm}: chunk→post mapping disagrees with the live index")

        # quantize_unit raises unless the input is L2-normalized. Let it.
        q = quantize_unit(vectors)
        (OUT / arm).mkdir(exist_ok=True)
        (OUT / arm / "docs.bin").write_bytes(np.ascontiguousarray(q, dtype=np.int8).tobytes())
        arms[arm] = {"dims": int(vectors.shape[1]), "docs": f"{arm}/docs.bin", "model": model}

    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()

    manifest = {
        "frozen": True,
        "corpus_commit": commit,
        "frozen_at": date.today().isoformat(),
        "n_posts": len({c["post"] for c in live_chunks}),
        "n_chunks": n_chunks,
        "chunk_size": live_manifest["chunk_size"],
        "chunk_overlap": live_manifest["chunk_overlap"],
        "title_prefix": live_manifest["title_prefix"],
        "doc_scale": 127.0,
        "arms": arms,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"{n_chunks} chunks, {manifest['n_posts']} posts -> {OUT}")
    for arm, meta in arms.items():
        if meta["docs"]:
            size = (OUT / meta["docs"]).stat().st_size
            print(f"  {arm:10} {meta['dims']:3d}d  {size:>8,} bytes")
        else:
            print(f"  {arm:10} {meta['dims']:3d}d  (live index)")


if __name__ == "__main__":
    main()
