from tts.lexicon import apply_lexicon, apply_pronunciation_rules, load_lexicon


LEX = {"int8": "int eight", "RRF": "R R F", "espeak-ng": "e speak N G", "Goldmark": "Gold mark"}


def test_substitutes_whole_words():
    assert apply_lexicon("we use int8 here", LEX) == "we use int eight here"


def test_does_not_match_substrings_of_larger_words():
    # "RRF" must not fire inside "RRFX" or similar
    assert apply_lexicon("RRFX is not RRF", LEX) == "RRFX is not R R F"


def test_is_case_sensitive():
    # lowercase "rrf" is not the key "RRF"
    assert apply_lexicon("rrf stays", LEX) == "rrf stays"


def test_handles_hyphenated_tokens():
    assert apply_lexicon("the espeak-ng backend", LEX) == "the e speak N G backend"


def test_longest_match_wins():
    lex = {"int": "integer", "int8": "int eight"}
    assert apply_lexicon("int8 and int", lex) == "int eight and integer"


def test_empty_lexicon_is_identity():
    assert apply_lexicon("unchanged text", {}) == "unchanged text"


def test_rules_spell_js_library_names():
    assert apply_pronunciation_rules("built with Lunr.js today") == "built with Lunr J S today"


def test_rules_spell_multiple_js_names():
    assert (
        apply_pronunciation_rules("lunr.js and Fuse.js and transformers.js")
        == "lunr J S and Fuse J S and transformers J S"
    )


def test_rules_leave_json_and_bare_js_alone():
    assert apply_pronunciation_rules("a JSON.stringify call") == "a JSON.stringify call"
    assert apply_pronunciation_rules("parse the .json file") == "parse the .json file"
    assert apply_pronunciation_rules("just js here") == "just js here"


def test_rules_tilde_before_digit_is_approximately():
    assert apply_pronunciation_rules("about ~88 tokens") == "about approximately 88 tokens"


def test_rules_tilde_in_path_is_left_alone():
    assert apply_pronunciation_rules("cd ~/projects and ~/.cache") == "cd ~/projects and ~/.cache"


def test_substitutes_symbols_glued_to_numbers():
    # symbols carry no word boundaries, so they must match against digits
    lex = {"±": " approximately ", "×": " times ", "%": " percent "}
    out = apply_lexicon("±250 lines, 7.8× faster, 90% done", lex)
    assert "±" not in out and "×" not in out and "%" not in out
    assert "approximately" in out and "times" in out and "percent" in out
    assert "250" in out and "90" in out


def test_load_lexicon_reads_yaml(tmp_path):
    f = tmp_path / "lex.yaml"
    f.write_text("int8: int eight\nRRF: R R F\n")
    assert load_lexicon(f) == {"int8": "int eight", "RRF": "R R F"}


def test_load_missing_lexicon_returns_empty(tmp_path):
    assert load_lexicon(tmp_path / "nope.yaml") == {}
