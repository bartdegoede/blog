"""Build the browser search index for bart.degoe.de.

Configuration is not a matter of taste: it is what the eval selected. See
docs/superpowers/specs/2026-07-08-browser-semantic-search-results.md.
"""

import shutil
import tempfile
from pathlib import Path

from publishable import split_posts
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


def publishable_corpus(corpus: Path, dest: Path) -> list[Path]:
    """Copy the posts Hugo would publish into dest; return the skipped ones.

    sss_eval indexes every *.md in the directory it's given, drafts included,
    and the index is served to every visitor.
    """
    published, unpublished = split_posts(corpus)
    for path in published:
        shutil.copy2(path, dest / path.name)
    return unpublished


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        skipped = publishable_corpus(CORPUS, Path(tmp))
        for path in skipped:
            print(f"skipping unpublished post: {path.name}")
        manifest = build(
            corpus=Path(tmp),
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
