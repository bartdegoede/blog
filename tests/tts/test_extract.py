from pathlib import Path

from tts.extract import to_narration


def test_strips_front_matter_and_code():
    md = "---\ntitle: X\n---\n\nHello world.\n\n```python\nprint('no')\n```\n\nBye."
    prose = to_narration(md)
    assert "Hello world." in prose
    assert "Bye." in prose
    assert "print" not in prose
    assert "title" not in prose


def test_removes_footnote_references():
    md = "This matters a lot[^1] to me.\n\n[^1]: because reasons."
    prose = to_narration(md)
    assert "[^1]" not in prose
    assert "caret" not in prose.lower()
    assert "This matters a lot" in prose
    # the definition line should not be narrated either
    assert "because reasons" not in prose


def test_removes_multi_sentence_footnote_definition():
    # to_prose puts definitions in a trailing block; a citation footnote has
    # several internal periods. None of it must survive into the narration.
    md = (
        "The CDN literature covers this[^akamai] well.\n\n"
        '[^akamai]: Maggs, Bruce M.; Sitaraman, Ramesh K. (July 2015), '
        '"Algorithmic nuggets in content delivery". SIGCOMM CCR 45 (3): 52-66. '
        "It is really good."
    )
    prose = to_narration(md)
    assert "The CDN literature covers this well." in prose
    for leaked in ("Maggs", "Bruce", "Sitaraman", "SIGCOMM", "really good"):
        assert leaked not in prose


def test_real_footnoted_post_has_no_artifacts():
    # Integration guard on a real, footnote- and jargon-heavy post.
    post = Path("content/post/2018-11-21-tab-plus-search-from-your-url-bar-with-opensearch.md")
    prose = to_narration(post.read_text())
    assert "OpenSearch" in prose
    assert "[^" not in prose
    assert "|" not in prose


def test_neutralizes_table_markup():
    md = "Compare:\n\n| Model | Size |\n|-------|------|\n| Kokoro | small |\n"
    prose = to_narration(md)
    assert "|" not in prose
    assert "-------" not in prose
    assert "Kokoro" in prose
    assert "small" in prose


def test_removes_strikethrough_markers():
    md = "This is ~~wrong~~ actually correct."
    prose = to_narration(md)
    assert "~~" not in prose
    assert "actually correct" in prose


def test_preserves_inline_code_as_words():
    md = "Run `hugo server` to preview."
    prose = to_narration(md)
    assert "hugo server" in prose


def test_collapses_whitespace():
    md = "Line one.\n\n\nLine two."
    prose = to_narration(md)
    assert "\n" not in prose
    assert "Line one. Line two." in prose
