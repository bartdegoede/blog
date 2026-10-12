import json

import pytest
from ask_eval import length_report
from ask_eval.report_lib import (
    arm_summary,
    choose_models,
    choose_threshold,
    cost_per_1k_always_on_gpu,
    cost_per_1k_hosted,
    count_sentences,
    length_table,
    threshold_sweep,
)
from click.testing import CliRunner


def test_choose_threshold_lets_at_most_max_frac_negatives_through():
    neg = [0.10, 0.20, 0.30, 0.40, 0.50, 0.55, 0.60, 0.62, 0.64, 0.70]
    pos = [0.45, 0.60, 0.65, 0.80]
    t = choose_threshold(pos, neg, max_neg_pass=0.10)
    assert sum(s >= t for s in neg) <= 1
    # smallest such threshold: just above the 2nd-highest negative
    assert 0.64 < t <= 0.70


def test_choose_threshold_zero_tolerance_blocks_all_negatives():
    t = choose_threshold([0.9], [0.3, 0.5], max_neg_pass=0.0)
    assert t > 0.5


def test_arm_summary_rates_over_answerable_only():
    judged = [
        {"family": "exact", "label": "faithful"},
        {"family": "exact", "label": "unsupported"},
        {"family": "conceptual", "label": "faithful"},
        {"family": "conceptual", "label": "non-answer"},
        {"family": "negative", "label": "unsupported"},
    ]
    s = arm_summary(judged)
    assert s["faithful"] == pytest.approx(0.5)
    assert s["unsupported"] == pytest.approx(0.25)
    assert s["non_answer"] == pytest.approx(0.25)
    assert s["negative_unsupported_ungated"] == pytest.approx(1.0)


def test_choose_models_small_is_smallest_over_bar_better_is_most_faithful():
    arms = [
        {"arm": "a", "tier": "browser", "download_mb": 100, "faithful": 0.70},
        {"arm": "b", "tier": "browser", "download_mb": 200, "faithful": 0.78},
        {"arm": "c", "tier": "browser", "download_mb": 340, "faithful": 0.86},
        {"arm": "d", "tier": "browser", "download_mb": 400, "faithful": 0.95},
        {"arm": "e", "tier": "large", "download_mb": 2900, "faithful": 0.97},
    ]
    assert choose_models(arms, bar=0.75, max_mb=350) == {"small": "b", "better": "c"}


def test_choose_models_collapses_to_one_when_same_model_wins_both():
    arms = [
        {"arm": "a", "tier": "browser", "download_mb": 100, "faithful": 0.90},
        {"arm": "b", "tier": "browser", "download_mb": 300, "faithful": 0.80},
    ]
    assert choose_models(arms, bar=0.75, max_mb=350) == {"small": "a", "better": "a"}


def test_choose_models_none_over_bar():
    arms = [{"arm": "a", "tier": "browser", "download_mb": 100, "faithful": 0.5}]
    assert choose_models(arms, bar=0.75, max_mb=350) == {"small": None, "better": "a"}


def test_hosted_cost_per_1k():
    # Haiku 5.5: $0.10 / $0.50 per 1M tokens; 600 in + 60 out per question
    rows = [{"input_tokens": 600, "output_tokens": 60}] * 10
    assert cost_per_1k_hosted(rows, in_per_m=0.10, out_per_m=0.50) == pytest.approx(
        0.09
    )


def test_always_on_gpu_cost_per_1k():
    # $0.50/h, 730 h/month, 1,000 questions/month -> $365 per 1k questions
    assert cost_per_1k_always_on_gpu(0.50, 1000) == pytest.approx(365.0)


def test_threshold_sweep_counts_pass_and_reject():
    pos = [0.40, 0.55, 0.70]
    neg = [0.25, 0.45, 0.60]
    rows = threshold_sweep(pos, neg, [0.30, 0.50, 0.65])
    assert rows == [
        {"threshold": 0.30, "neg_passing": 2, "pos_rejected": 0},
        {"threshold": 0.50, "neg_passing": 1, "pos_rejected": 1},
        {"threshold": 0.65, "neg_passing": 0, "pos_rejected": 2},
    ]


def test_arm_summary_ignores_judge_refusals_in_denominator():
    judged = [
        {"family": "exact", "label": "faithful"},
        {"family": "exact", "label": "judge-refused"},
    ]
    assert arm_summary(judged)["faithful"] == pytest.approx(1.0)


def test_count_sentences_matches_the_page_clamp():
    assert count_sentences("") == 0
    assert count_sentences("One. Two! Three?") == 3
    assert count_sentences("It uses e.g. Lunr. Done.") == 2
    assert count_sentences("Steps: 1. index 2. query.") == 1
    assert count_sentences("Version 3.5 shipped.") == 1
    assert count_sentences("Full sentence. And a cut-off frag") == 2


def _run(arm, qid, n, summary, tokens, wall):
    return {
        "arm": arm,
        "id": qid,
        "summary": summary,
        "output_tokens": tokens,
        "wall_ms": wall,
        "max_sentences": n,
    }


def test_length_table_rates_per_model_and_n():
    runs = [
        _run("tiny-s2", "q01", 2, "A. B.", 10, 100),
        _run("tiny-s2", "q02", 2, "A.", 20, 300),
        _run("tiny-s2", "n01", 2, "A.", 30, 200),
        _run("tiny-s4", "q01", 4, "A. B. C.", 40, 500),
        _run("tiny-s4", "n01", 4, "A. B. C. D.", 60, 700),
    ]
    judged = [
        {"arm": "tiny-s2", "id": "q01", "family": "exact", "label": "faithful"},
        {"arm": "tiny-s2", "id": "q02", "family": "conceptual", "label": "unsupported"},
        {"arm": "tiny-s2", "id": "n01", "family": "negative", "label": "unsupported"},
        {"arm": "tiny-s4", "id": "q01", "family": "exact", "label": "judge-refused"},
        {"arm": "tiny-s4", "id": "n01", "family": "negative", "label": "faithful"},
        {"arm": "other", "id": "q01", "family": "exact", "label": "faithful"},
    ]
    s2, s4 = length_table(judged, runs)
    assert (s2["model"], s2["n"]) == ("tiny", 2)
    assert (s2["answerable"], s2["faithful"], s2["unsupported"]) == (2, 1, 1)
    assert (s2["negatives"], s2["invented"]) == (1, 1)
    assert s2["mean_sentences"] == pytest.approx(4 / 3)
    assert s2["mean_tokens"] == 20
    assert s2["median_wall_ms"] == 200
    assert (s4["model"], s4["n"]) == ("tiny", 4)
    assert (s4["answerable"], s4["faithful"]) == (0, 0)  # refused row excluded
    assert (s4["negatives"], s4["invented"]) == (1, 0)
    assert s4["mean_sentences"] == 3.5
    assert s4["median_wall_ms"] == 600


def test_length_report_cli_writes_report_md(tmp_path):

    runs_dir = tmp_path / "length"
    runs_dir.mkdir()
    runs = [
        _run("tiny-s2", "q01", 2, "A. B.", 10, 1000),
        _run("tiny-s2", "n01", 2, "A.", 30, 3000),
    ]
    (runs_dir / "tiny-s2.jsonl").write_text("".join(json.dumps(r) + "\n" for r in runs))
    judged = [
        {"arm": "tiny-s2", "id": "q01", "family": "exact", "label": "faithful"},
        {"arm": "tiny-s2", "id": "n01", "family": "negative", "label": "unsupported"},
    ]
    jpath = tmp_path / "judgements-length.jsonl"
    jpath.write_text("".join(json.dumps(j) + "\n" for j in judged))
    result = CliRunner().invoke(
        length_report.main, ["--judgements", str(jpath), "--runs-dir", str(runs_dir)]
    )
    assert result.exit_code == 0, result.output
    md = (runs_dir / "report.md").read_text()
    assert (
        "| tiny | 2 | 1/1 (100%) | 0/1 (0%) | 1/1 (100%) | 1.50 | 20.0 | 2.0 s |" in md
    )
