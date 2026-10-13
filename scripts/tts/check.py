"""Find words Kokoro will mispronounce, before spending a render on them.

Kokoro's grapheme-to-phoneme step (misaki) turns words it has no entry for into
"❓", which come out silent or garbled. Running the exact narration text through
misaki and collecting those words tells you what to add to scripts/tts_lexicon.yaml.
"""

import re

# Tokens without any letters (markdown leftovers like "#" and ">", "[1]", "[...]")
# are dropped silently by misaki, which is what we want; don't report them.
_HAS_LETTER = re.compile(r"[A-Za-z]")


def make_g2p():
    from misaki import en

    return en.G2P(trf=False, british=False)


def unknown_words(chunks, g2p) -> list[str]:
    """Sorted, de-duplicated words misaki can't phonemize. `g2p(text)` returns
    (phonemes, tokens) where each token has `.text` and `.phonemes`."""
    unknown = set()
    for chunk in chunks:
        _, tokens = g2p(chunk)
        for tok in tokens or []:
            ps = tok.phonemes
            if (ps is None or "❓" in ps) and _HAS_LETTER.search(tok.text):
                unknown.add(tok.text)
    return sorted(unknown)
