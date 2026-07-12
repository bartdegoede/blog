"""Pronunciation lexicon: whole-word spoken-form substitution.

Kokoro's grapheme-to-phoneme step mangles technical jargon and rare names. A
shared map of surface form -> spoken form, applied before synthesis, fixes it
without touching the model. Matching is case-sensitive (so "int8" != "INT8"),
whole-token (hyphens and digits count as part of a token, so "int" never fires
inside "int8" or "printf"), and longest-key-first (so "int8" wins over "int").
"""

import re
from pathlib import Path

import yaml


def load_lexicon(path) -> dict[str, str]:
    path = Path(path)
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    return {str(k): str(v) for k, v in data.items()}


# "<name>.js" is a JavaScript library or file; spell the suffix as letters so
# Kokoro says "lunr J S", not "lunr dot jiss". The name before the dot is left
# as-is. "\.js\b" won't touch ".json" (no word boundary after "js") so JSON is
# handled by the lexicon instead.
_JS_SUFFIX = re.compile(r"\b([A-Za-z][\w-]*)\.js\b")
# "~" before a digit means "approximately" ("~88 tok/s"); "~/..." is a home path
# and must be left alone, so we only match a tilde immediately before a digit.
_TILDE_APPROX = re.compile(r"~(?=\d)")


def apply_pronunciation_rules(text: str) -> str:
    """Contextual fixups that don't fit the literal lexicon map."""
    text = _JS_SUFFIX.sub(r"\1 J S", text)
    text = _TILDE_APPROX.sub("approximately ", text)
    return text


def _bounded(key: str) -> str:
    """Escape a lexicon key, adding word-boundary guards only on ends that are
    word characters. Word tokens (int8, RRF) stay whole-token; symbol keys like
    "±" or "%" carry no guards, so they still match when glued to a digit."""
    left = r"(?<![\w-])" if re.match(r"\w", key) else ""
    right = r"(?![\w-])" if re.search(r"\w\Z", key) else ""
    return left + re.escape(key) + right


def apply_lexicon(text: str, lexicon: dict[str, str]) -> str:
    if not lexicon:
        return text
    # Longest key first so "int8" wins over "int" in the alternation.
    keys = sorted(lexicon, key=len, reverse=True)
    pattern = re.compile("|".join(_bounded(k) for k in keys))
    return pattern.sub(lambda m: lexicon[m.group(0)], text)
