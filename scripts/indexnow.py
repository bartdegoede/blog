"""Tell Bing (and other IndexNow engines) which pages the last deploy changed.

deploy.sh runs this after pushing public/. It takes the HTML files changed by
public/'s HEAD commit, maps them to URLs, keeps only the ones in sitemap.xml
(which drops alias redirect stubs, 404.html and noindex pages like /ask/), and
POSTs them to the IndexNow API. The key is verified against
static/<KEY>.txt, served at the site root.

    uv run python scripts/indexnow.py --dry-run          # list what would be sent
    uv run python scripts/indexnow.py                    # submit HEAD's changes
    uv run python scripts/indexnow.py --all              # submit the whole sitemap

A failed submission only warns: it must never fail a deploy that already pushed.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"
HOST = "bart.degoe.de"
BASE = f"https://{HOST}/"
KEY = "1ccacb48aa3c4776ac3c84a0b3db89d7"
ENDPOINT = "https://api.indexnow.org/indexnow"


def sitemap_urls(sitemap: str) -> set[str]:
    return set(re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sitemap))


def path_to_url(path: str) -> str | None:
    """`foo/index.html` -> `https://host/foo/`; anything else -> None."""
    if path == "index.html":
        return BASE
    if path.endswith("/index.html"):
        return BASE + path[: -len("index.html")]
    return None


def changed_urls(paths: list[str], sitemap: str) -> list[str]:
    known = sitemap_urls(sitemap)
    return sorted({u for u in map(path_to_url, paths) if u in known})


def changed_paths(public: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(public), "diff", "--name-only", "HEAD~1", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.split()


def submit(urls: list[str]) -> None:
    body = json.dumps({
        "host": HOST,
        "key": KEY,
        "keyLocation": f"{BASE}{KEY}.txt",
        "urlList": urls,
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body, headers={"Content-Type": "application/json; charset=utf-8"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"IndexNow: HTTP {resp.status}, submitted {len(urls)} URLs")


def main(argv: list[str]) -> int:
    sitemap = (PUBLIC / "sitemap.xml").read_text()
    if "--all" in argv:
        urls = sorted(sitemap_urls(sitemap))
    else:
        urls = changed_urls(changed_paths(PUBLIC), sitemap)
    for u in urls:
        print(u)
    if not urls:
        print("IndexNow: no changed pages to submit")
        return 0
    if "--dry-run" in argv:
        print(f"{len(urls)} URLs (dry run)")
        return 0
    try:
        submit(urls)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"IndexNow submission failed (deploy is unaffected): {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
