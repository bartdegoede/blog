"""Keep unpublished posts (drafts, future-dated, expired) out of public/.

deploy.sh publishes with `git add .` inside public/, and a plain `hugo` build
never deletes anything. Two ways an unpublished post still reaches the site:

- static/img/<post stem>/ is copied into public/ whether or not the post is
  published (static files know nothing about drafts).
- a local `hugo -D` / `hugo server` build leaves the post's page, plus taxonomy
  pages and feeds that list it, in public/.

This removes public/img/<stem>/ and public/<slug>/ for every unpublished post,
then fails if the slug is still mentioned anywhere in public/ (e.g. a stale
category page). Run after `hugo`, before publishing.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from publishable import front_matter, split_posts

CORPUS = Path("content/post")
PUBLIC = Path("public")
TEXT_SUFFIXES = {".html", ".xml", ".json", ".txt"}


def leftovers(post: Path, public: Path) -> list[Path]:
    """Output directories in public/ that belong to an unpublished post."""
    slug = front_matter(post).get("slug") or post.stem
    candidates = [public / "img" / post.stem, public / slug]
    return [p for p in candidates if p.is_dir()]


def mentions(slug: str, public: Path) -> list[Path]:
    """Text files in public/ that still mention the slug."""
    hits = []
    for path in public.rglob("*"):
        if ".git" in path.parts or path.suffix not in TEXT_SUFFIXES:
            continue
        if slug in path.read_text(encoding="utf-8", errors="ignore"):
            hits.append(path)
    return sorted(hits)


def guard(corpus: Path = CORPUS, public: Path = PUBLIC) -> list[str]:
    """Clean public/ of unpublished posts; return problems that remain."""
    _, unpublished = split_posts(corpus)
    problems = []
    for post in unpublished:
        for path in leftovers(post, public):
            print(f"removing unpublished output: {path}")
            shutil.rmtree(path)
        slug = front_matter(post).get("slug") or post.stem
        for path in mentions(slug, public):
            problems.append(f"{path} mentions unpublished post '{slug}' ({post.name})")
    return problems


def main() -> int:
    problems = guard()
    for p in problems:
        print(p, file=sys.stderr)
    if problems:
        print(
            "Stale output from a build that included unpublished posts. "
            "Delete those files (Hugo regenerates them) and re-run ./deploy.sh.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
