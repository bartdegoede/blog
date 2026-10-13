from types import SimpleNamespace as T

from tts.check import unknown_words


def fake_g2p(known):
    def g2p(text):
        toks = [T(text=w, phonemes=("ok" if w in known else "❓")) for w in text.split()]
        return "", toks

    return g2p


def test_reports_unknown_words_once_sorted():
    g2p = fake_g2p({"the", "model"})
    assert unknown_words(["the Qwen model", "Qwen and Smol"], g2p) == ["Qwen", "Smol", "and"]


def test_ignores_letterless_markdown_leftovers():
    g2p = fake_g2p(set())
    assert unknown_words(["# > [1] [...] word"], g2p) == ["word"]


def test_none_phonemes_count_as_unknown():
    def g2p(text):
        return "", [T(text="thicc", phonemes=None)]

    assert unknown_words(["thicc"], g2p) == ["thicc"]
