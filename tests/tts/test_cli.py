import numpy as np
from click.testing import CliRunner
from pydub import AudioSegment

import tts.cli as cli
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


def test_all_backs_up_before_render_and_isolates_failures(tmp_path, monkeypatch):
    posts = tmp_path / "posts"
    posts.mkdir()
    (posts / "2020-01-01-good.md").write_text("A fine sentence.")
    (posts / "2020-01-02-bad.md").write_text("This one will explode.")
    (posts / "2020-01-03-good.md").write_text("Another fine one.")
    audio = tmp_path / "audio"
    audio.mkdir()
    (audio / "old.mp3").write_bytes(b"original")

    monkeypatch.setattr(cli, "POSTS_DIR", posts)
    monkeypatch.setattr(cli, "AUDIO_DIR", audio)
    monkeypatch.setattr(cli, "BACKUP_DIR", tmp_path / "bk")
    monkeypatch.setattr(cli, "LEXICON_PATH", tmp_path / "absent.yaml")

    def fake_synth(text, voice="af_heart", speed=1.0):
        if "explode" in text:
            raise RuntimeError("boom")
        return np.zeros(2400, dtype=np.float32)

    monkeypatch.setattr("tts.synth.synth", fake_synth)
    monkeypatch.setattr("tts.synth.preload", lambda: None)

    result = CliRunner().invoke(cli.main, ["--all"])

    assert result.exit_code == 0
    assert "rendered 2, skipped 0, failed 1" in result.output
    # the bad post did not abort the run; the good ones were written
    assert (audio / "2020-01-01-good.mp3").exists()
    assert (audio / "2020-01-03-good.mp3").exists()
    # backup ran before any render, preserving the original
    assert (tmp_path / "bk" / "old.mp3").read_bytes() == b"original"


def test_backup_is_idempotent(tmp_path):
    src = tmp_path / "audio"
    src.mkdir()
    (src / "a.mp3").write_bytes(b"one")
    backup = tmp_path / "bk"
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    (backup / "a.mp3").write_bytes(b"EDITED")  # a re-run must not clobber
    backup_existing_audio(audio_dir=src, backup_dir=backup)
    assert (backup / "a.mp3").read_bytes() == b"EDITED"
