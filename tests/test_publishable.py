import datetime as dt

from build_search_index import publishable_corpus
from guard_unpublished import guard
from publishable import is_publishable, split_posts

NOW = dt.datetime(2026, 11, 8, 12, tzinfo=dt.timezone.utc)


def post(dir, name, fm):
    path = dir / f"{name}.md"
    path.write_text(f"---\n{fm}\n---\n\nBody of {name}.\n")
    return path


def test_drafts_are_not_publishable():
    assert not is_publishable({"draft": True}, NOW)
    assert is_publishable({"draft": False}, NOW)
    assert is_publishable({}, NOW)


def test_future_and_expired_posts_are_not_publishable():
    assert not is_publishable(
        {"date": dt.datetime(2026, 11, 9, tzinfo=dt.timezone.utc)}, NOW
    )
    assert not is_publishable({"date": "2026-11-08T09:00:00-05:00"}, NOW)  # 14:00 UTC
    assert is_publishable({"date": "2026-11-08T06:00:00-05:00"}, NOW)
    assert is_publishable({"date": dt.date(2026, 11, 8)}, NOW)
    assert not is_publishable({"date": "2020-01-01", "publishDate": "2027-01-01"}, NOW)
    assert not is_publishable({"expiryDate": dt.date(2026, 1, 1)}, NOW)


def test_yaml_timestamps_parse(tmp_path):
    post(tmp_path, "live", "date: 2026-10-20T09:00:00-05:00\ndraft: false")
    post(tmp_path, "draft", "date: 2026-11-05T09:00:00-05:00\ndraft: true")
    published, unpublished = split_posts(tmp_path, NOW)
    assert [p.stem for p in published] == ["live"]
    assert [p.stem for p in unpublished] == ["draft"]


def test_search_corpus_excludes_unpublished(tmp_path):
    src, dest = tmp_path / "src", tmp_path / "dest"
    src.mkdir()
    dest.mkdir()
    post(src, "live", "draft: false")
    post(src, "draft", "draft: true")
    skipped = publishable_corpus(src, dest)
    assert [p.name for p in dest.iterdir()] == ["live.md"]
    assert [p.stem for p in skipped] == ["draft"]


def test_guard_removes_draft_output_and_reports_stale_mentions(tmp_path):
    content, public = tmp_path / "content", tmp_path / "public"
    content.mkdir()
    post(content, "2026-11-05-secret", 'slug: "secret-post"\ndraft: true')
    post(content, "2026-10-01-live", 'slug: "live-post"\ndate: 2026-10-01')
    for d in [
        "img/2026-11-05-secret",
        "secret-post",
        "img/2026-10-01-live",
        "live-post",
        "categories/go",
    ]:
        (public / d).mkdir(parents=True)
    (public / "img/2026-11-05-secret/cover.jpg").write_bytes(b"jpg")
    (public / "live-post/index.html").write_text("live")
    (public / "categories/go/index.html").write_text('<a href="/secret-post/">')

    problems = guard(content, public)

    assert not (public / "img/2026-11-05-secret").exists()
    assert not (public / "secret-post").exists()
    assert (public / "img/2026-10-01-live").exists()
    assert (public / "live-post/index.html").exists()
    assert len(problems) == 1 and "categories/go/index.html" in problems[0]


def test_guard_passes_on_clean_output(tmp_path):
    content, public = tmp_path / "content", tmp_path / "public"
    content.mkdir()
    public.mkdir()
    post(content, "draft", "draft: true")
    (public / "index.html").write_text("nothing to see")
    assert guard(content, public) == []
