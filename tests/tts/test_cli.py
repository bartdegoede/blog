import numpy as np
from pydub import AudioSegment

from tts.cli import backup_existing_audio, render_post


def _fake_synth(text, voice="af_heart", speed=1.0):
    # 0.1s of silence per chunk, so duration scales with chunk count
    return np.zeros(2400, dtype=np.float32)


def test_render_post_writes_mp3_named_by_stem(tmp_path):
    md = tmp_path / "2020-01-01-hello.md"
    md.write_text("---\ntitle: Hi\n---\n\nOne. Two. Three.\n")
    out_dir = tmp_path / "audio"
    out = render_post(md, "af_heart", 1.0, {}, _fake_synth, audio_dir=out_dir)
    assert out == out_dir / "2020-01-01-hello.mp3"
    assert out.exists()
    assert AudioSegment.from_mp3(out).duration_seconds > 0.0


def test_render_post_applies_lexicon(tmp_path):
    seen = []

    def spy_synth(text, voice="af_heart", speed=1.0):
        seen.append(text)
        return np.zeros(2400, dtype=np.float32)

    md = tmp_path / "p.md"
    md.write_text("We ship int8 vectors.")
    render_post(md, "af_heart", 1.0, {"int8": "int eight"}, spy_synth, audio_dir=tmp_path)
    assert any("int eight" in t for t in seen)


def test_render_post_skips_empty_prose(tmp_path):
    md = tmp_path / "empty.md"
    md.write_text("---\ntitle: X\n---\n\n```\ncode only\n```\n")
    out = render_post(md, "af_heart", 1.0, {}, _fake_synth, audio_dir=tmp_path)
    assert out is None


def test_backup_copies_without_deleting(tmp_path):
    src = tmp_path / "audio"
    src.mkdir()
    (src / "a.mp3").write_bytes(b"one")
    (src / "a.ogg").write_bytes(b"two")
    backup = tmp_path / "bk"
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    assert (backup / "a.mp3").read_bytes() == b"one"
    assert (backup / "a.ogg").read_bytes() == b"two"
    # originals still present
    assert (src / "a.mp3").exists()
    assert (src / "a.ogg").exists()


def test_backup_is_idempotent(tmp_path):
    src = tmp_path / "audio"
    src.mkdir()
    (src / "a.mp3").write_bytes(b"one")
    backup = tmp_path / "bk"
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    (backup / "a.mp3").write_bytes(b"EDITED")  # a re-run must not clobber
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    assert (backup / "a.mp3").read_bytes() == b"EDITED"
