"""Which posts would Hugo publish right now?

Hugo's defaults (config.yml doesn't override them): drafts, posts dated in the
future, and posts past their expiryDate are not built. Anything that produces
public output outside Hugo (the semantic search index, the deploy guard) has to
apply the same rule, or an unpublished post leaks onto the site.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import yaml


def front_matter(path: Path) -> dict:
    """Parse a post's YAML front matter (every post here uses `---` fences)."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    _, fm, _ = text.split("---", 2)
    return yaml.safe_load(fm) or {}


def _as_utc(value) -> dt.datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = dt.datetime.fromisoformat(value)
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day, tzinfo=dt.timezone.utc)
    raise TypeError(f"not a date: {value!r}")


def is_publishable(fm: dict, now: dt.datetime | None = None) -> bool:
    now = now or dt.datetime.now(dt.timezone.utc)
    if fm.get("draft") is True:
        return False
    published = _as_utc(fm.get("publishDate") or fm.get("date"))
    if published and published > now:
        return False
    expires = _as_utc(fm.get("expiryDate"))
    if expires and expires <= now:
        return False
    return True


def split_posts(
    corpus: Path, now: dt.datetime | None = None
) -> tuple[list[Path], list[Path]]:
    """(publishable, unpublished) markdown files in corpus, sorted by name."""
    published, unpublished = [], []
    for path in sorted(Path(corpus).glob("*.md")):
        target = published if is_publishable(front_matter(path), now) else unpublished
        target.append(path)
    return published, unpublished
