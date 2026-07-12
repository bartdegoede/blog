"""Command line for local Kokoro narration.

    uv run python scripts/text_to_speech.py content/post/foo.md   # one post
    uv run python scripts/text_to_speech.py --all                 # whole catalogue

Batch mode backs up existing audio first (copy, never move/delete) and shows a
tqdm progress bar. Output MP3s are named by the markdown file stem, matching the
existing static/audio convention.
"""

import logging
from pathlib import Path
import shutil

import click
from tqdm import tqdm

from tts.chunk import sentence_chunks
from tts.extract import to_narration
from tts.lexicon import apply_lexicon, apply_pronunciation_rules, load_lexicon
from tts.stitch import stitch_to_mp3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

AUDIO_DIR = Path("static/audio")
POSTS_DIR = Path("content/post")
BACKUP_DIR = Path("backups/audio-google-2026-07")
LEXICON_PATH = Path(__file__).resolve().parent.parent / "tts_lexicon.yaml"
SAMPLE_RATE = 24000


def render_post(md_path, voice, speed, lexicon, synth_fn, audio_dir=AUDIO_DIR):
    """Render one markdown post to MP3. Returns the output path, or None if the
    post has no narratable prose."""
    md_path = Path(md_path)
    prose = apply_lexicon(to_narration(md_path.read_text()), lexicon)
    prose = apply_pronunciation_rules(prose)
    chunks = sentence_chunks(prose)
    if not chunks:
        return None
    segments = [synth_fn(c, voice=voice, speed=speed) for c in chunks]
    out = Path(audio_dir) / (md_path.stem + ".mp3")
    stitch_to_mp3(segments, out, sample_rate=SAMPLE_RATE)
    return out


def backup_existing_audio(audio_dir=AUDIO_DIR, backup_dir=BACKUP_DIR):
    """Copy every existing mp3/ogg into the backup dir. Never overwrites an
    existing backup, so re-runs are safe and preserve the first snapshot."""
    audio_dir = Path(audio_dir)
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    for f in sorted(audio_dir.glob("*.mp3")) + sorted(audio_dir.glob("*.ogg")):
        dest = backup_dir / f.name
        if not dest.exists():
            shutil.copy2(f, dest)


@click.command()
@click.argument("filename", required=False, type=click.Path(exists=True, path_type=Path))
@click.option("--all", "all_posts", is_flag=True, help="Re-render every post in content/post.")
@click.option("--voice", default="af_heart", show_default=True, help="Kokoro voice preset.")
@click.option("--speed", default=1.0, show_default=True, type=float)
def main(filename, all_posts, voice, speed):
    from tts.synth import preload, synth as synth_fn

    lexicon = load_lexicon(LEXICON_PATH)

    if all_posts:
        try:
            preload()  # fail once, up front, not once per post
        except Exception as exc:
            raise click.ClickException(f"could not load the Kokoro model: {exc}")
        backup_existing_audio(AUDIO_DIR, BACKUP_DIR)
        posts = sorted(POSTS_DIR.glob("*.md"))
        rendered = skipped = failed = 0
        for post in tqdm(posts, desc="Narrating posts", unit="post"):
            try:
                out = render_post(post, voice, speed, lexicon, synth_fn, audio_dir=AUDIO_DIR)
                if out:
                    rendered += 1
                else:
                    skipped += 1
            except Exception as exc:  # keep going; one bad post must not abort
                failed += 1
                logging.error("failed %s: %s", post.name, exc)
        click.echo(f"rendered {rendered}, skipped {skipped}, failed {failed}")
        return

    if filename is None:
        raise click.UsageError("Provide a FILENAME or use --all.")
    out = render_post(filename, voice, speed, lexicon, synth_fn, audio_dir=AUDIO_DIR)
    click.echo(f"wrote {out}" if out else "nothing to render (empty prose)")
