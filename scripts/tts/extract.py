"""Markdown -> narratable prose for text-to-speech.

The heavy lifting (front matter, code blocks, shortcodes, HTML, inline
emphasis) is done by sss_eval.markdown.to_prose, which is already tested in the
search pipeline. This module adds the TTS-specific scrubbing that to_prose does
not do because search does not care about it: footnote references and markdown
table pipes, both of which a narrator would read aloud as noise.
"""

import re

from sss_eval.markdown import to_prose

# A footnote definition line: "[^1]: some text" possibly wrapped. We only need
# to drop the marker + the rest of that line; to_prose has already flattened
# structure, so definitions appear inline. Drop reference markers everywhere,
# and drop the trailing definition text after a "[^id]:" marker.
_FOOTNOTE_DEF = re.compile(r"\[\^[^\]]+\]:\s*[^.]*\.?")
_FOOTNOTE_REF = re.compile(r"\[\^[^\]]+\]")
_TABLE_SEP = re.compile(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?")


def to_narration(md_text: str) -> str:
    prose = to_prose(md_text)
    prose = _FOOTNOTE_DEF.sub(" ", prose)
    prose = _FOOTNOTE_REF.sub("", prose)
    prose = _TABLE_SEP.sub(" ", prose)
    prose = prose.replace("|", " ")
    prose = re.sub(r"\s+", " ", prose).strip()
    return prose
