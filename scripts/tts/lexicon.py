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


def apply_lexicon(text: str, lexicon: dict[str, str]) -> str:
    if not lexicon:
        return text
    keys = sorted(lexicon, key=len, reverse=True)
    # (?<![\w-]) / (?![\w-]) treat a token as bounded by anything that is not a
    # word char or hyphen, so hyphenated and alphanumeric tokens match as units.
    pattern = re.compile(
        r"(?<![\w-])(" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])"
    )
    return pattern.sub(lambda m: lexicon[m.group(1)], text)
