"""Delete fingerprinted build outputs in public/ that nothing references any more.

public/ is a git submodule, so deploy.sh can't use `hugo --cleanDestinationDir`
(it deletes the submodule's .git file). Without it, every build that changes a
fingerprinted asset (CSS bundle, JS bundle, re-rendered narration MP3) leaves the
previous `name.<64 hex>.ext` file behind, and the deploy commits it. This removes
fingerprinted files whose name appears in no HTML/JS/CSS/JSON/XML file in public/.

    uv run python scripts/prune_public.py --dry-run   # list what would go
    uv run python scripts/prune_public.py             # delete
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"
FINGERPRINT = re.compile(r"\.[0-9a-f]{64}\.[a-z0-9]+$")
REFERRERS = {".html", ".js", ".css", ".json", ".xml"}


def _files(public: Path):
    for p in public.rglob("*"):
        if p.is_file() and ".git" not in p.relative_to(public).parts:
            yield p


def orphans(public: Path) -> list[Path]:
    """Fingerprinted files in `public` whose file name no text file mentions."""
    files = list(_files(public))
    referenced = "\n".join(p.read_text(errors="ignore") for p in files if p.suffix in REFERRERS)
    return sorted(p for p in files if FINGERPRINT.search(p.name) and p.name not in referenced)


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    found = orphans(PUBLIC)
    total = sum(p.stat().st_size for p in found)
    for p in found:
        print(("would delete " if dry else "deleted ") + str(p.relative_to(PUBLIC)))
        if not dry:
            p.unlink()
    print(f"{len(found)} unreferenced fingerprinted files, {total / 1e6:.1f} MB" + (" (dry run)" if dry else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
