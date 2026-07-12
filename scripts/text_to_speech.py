"""Entry point kept for backwards compatibility and docs.

    uv run python scripts/text_to_speech.py content/post/foo.md
    uv run python scripts/text_to_speech.py --all

The implementation lives in scripts/tts/. This shim puts scripts/ on the import
path so `tts` resolves when run as a file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tts.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
