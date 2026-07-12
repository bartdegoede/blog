from tts.lexicon import apply_lexicon, load_lexicon


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


def test_load_lexicon_reads_yaml(tmp_path):
    f = tmp_path / "lex.yaml"
    f.write_text("int8: int eight\nRRF: R R F\n")
    assert load_lexicon(f) == {"int8": "int eight", "RRF": "R R F"}


def test_load_missing_lexicon_returns_empty(tmp_path):
    assert load_lexicon(tmp_path / "nope.yaml") == {}
