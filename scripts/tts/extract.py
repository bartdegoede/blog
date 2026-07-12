"""Markdown -> narratable prose for text-to-speech.

The heavy lifting (front matter, code blocks, shortcodes, HTML, inline
emphasis) is done by sss_eval.markdown.to_prose, which is already tested in the
search pipeline. This module adds the TTS-specific scrubbing that to_prose does
not do because search does not care about it: footnote references and markdown
table pipes, both of which a narrator would read aloud as noise.
"""

import re

from sss_eval.markdown import to_prose

# to_prose keeps Markdown footnote *definitions* as their own paragraphs that
# begin with "[^id]:" -- often multi-sentence citations. Drop those paragraphs
# whole: matching only to the first period leaks the rest, and deleting greedily
# to end-of-document destroys posts that write "[^id]:" mid-sentence as
# punctuation (a footnote ref immediately before a code block). A paragraph that
# *starts* with the marker is a definition; the same marker mid-paragraph is a
# reference. Then strip the remaining inline "[^id]" references from the bodies.
_FOOTNOTE_DEF_START = re.compile(r"\[\^[\w-]+\]:")
_FOOTNOTE_REF = re.compile(r"\[\^[\w-]+\]")
# A Markdown table separator row, e.g. "|---|:--:|". Require 3+ hyphens per cell
# so ordinary prose (an em-dash written as "10--20") is left alone.
_TABLE_SEP = re.compile(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?")


def to_narration(md_text: str) -> str:
    prose = to_prose(md_text)
    paragraphs = re.split(r"\n\s*\n", prose)
    paragraphs = [p for p in paragraphs if not _FOOTNOTE_DEF_START.match(p.lstrip())]
    prose = "\n\n".join(paragraphs)
    prose = _FOOTNOTE_REF.sub("", prose)
    prose = prose.replace("~~", "")  # leftover strikethrough markers to_prose keeps
    prose = _TABLE_SEP.sub(" ", prose)
    prose = prose.replace("|", " ")
    prose = re.sub(r"\s+", " ", prose).strip()
    return prose
