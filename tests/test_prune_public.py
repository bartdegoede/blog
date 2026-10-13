from prune_public import orphans

H = "a" * 64
H2 = "b" * 64


def test_only_unreferenced_fingerprinted_files_are_orphans(tmp_path):
    (tmp_path / "index.html").write_text(f'<link href="/css/style.{H}.css">')
    (tmp_path / "css").mkdir()
    (tmp_path / "css" / f"style.{H}.css").write_text("used")
    (tmp_path / "css" / f"style.{H2}.css").write_text("stale")
    (tmp_path / "CNAME").write_text("not fingerprinted, never touched")
    assert [p.name for p in orphans(tmp_path)] == [f"style.{H2}.css"]


def test_reference_from_js_counts(tmp_path):
    (tmp_path / "index.html").write_text('<div data-worker="/js/w.' + H + '.js"></div>')
    (tmp_path / f"w.{H}.js").write_text("worker")
    assert orphans(tmp_path) == []


def test_git_dir_is_ignored(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / f"x.{H}.js").write_text("")
    assert orphans(tmp_path) == []
