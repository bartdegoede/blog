"""Build the browser search index for bart.degoe.de.

Configuration is not a matter of taste: it is what the eval selected. See
docs/superpowers/specs/2026-07-08-browser-semantic-search-results.md.
"""

from pathlib import Path

from sss_eval.build import build

CORPUS = Path("content/post")
OUTDIR = Path("static/search")

# Selected by the pre-registered ship rule. 4.21 MB first-query download,
# recall@1 0.717 -- matching MiniLM q8 at 23.10 MB.
MODEL = "minishlab/potion-base-8M"
DIMS = 128
CHUNK_SIZE = 600
CHUNK_OVERLAP = 120


def prune_stale(outdir: Path, manifest: dict) -> None:
    """Delete files in outdir that are no longer referenced by the manifest.

    build() writes content-hashed filenames, so rebuilding after editing a
    post leaves the old chunks.<hash>.json, docs.<hash>.bin, etc. sitting in
    outdir. Hugo would happily publish all of them. Keep only manifest.json
    and the files named in manifest["files"].
    """
    keep = {"manifest.json"} | set(manifest["files"].values())
    for path in outdir.iterdir():
        if path.is_file() and path.name not in keep:
            path.unlink()


def main() -> None:
    manifest = build(
        corpus=CORPUS,
        model_id=MODEL,
        outdir=OUTDIR,
        dims=DIMS,
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        title_prefix=True,
    )
    prune_stale(OUTDIR, manifest)
    total = sum(
        (OUTDIR / manifest["files"][k]).stat().st_size for k in ("tokens", "scales", "vocab")
    )
    print(f"{manifest['n_chunks']} chunks, {manifest['dims']}d -> {OUTDIR}")
    print(f"first-query download: {total:,} bytes ({total / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
