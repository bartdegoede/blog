from tts.chunk import sentence_chunks


def test_empty_prose_yields_no_chunks():
    assert sentence_chunks("") == []
    assert sentence_chunks("   ") == []


def test_packs_sentences_up_to_max_chars():
    prose = "One two three. Four five six. Seven eight nine."
    chunks = sentence_chunks(prose, max_chars=30)
    # each sentence ~15 chars; two won't fit in 30 with a space, so 1 per chunk
    for c in chunks:
        assert len(c) <= 30
    assert " ".join(chunks).split() == prose.split()


def test_never_splits_mid_sentence():
    prose = "Alpha beta gamma delta epsilon. Zeta."
    chunks = sentence_chunks(prose, max_chars=10)
    # first sentence exceeds max_chars but must stay whole
    assert "Alpha beta gamma delta epsilon." in chunks


def test_combines_short_sentences_into_one_chunk():
    prose = "Hi. Yo. Hey."
    assert sentence_chunks(prose, max_chars=400) == ["Hi. Yo. Hey."]


def test_round_trips_words_in_order():
    prose = "First sentence here. Second one there. Third and final!"
    chunks = sentence_chunks(prose, max_chars=25)
    assert " ".join(chunks).split() == prose.split()
