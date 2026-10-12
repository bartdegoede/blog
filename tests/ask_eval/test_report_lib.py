import pytest

from ask_eval.report_lib import (
    arm_summary,
    choose_models,
    choose_threshold,
    cost_per_1k_always_on_gpu,
    cost_per_1k_hosted,
    threshold_sweep,
)


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
