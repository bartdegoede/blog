"""Pure decision logic for the /ask/ eval. No I/O, no API calls."""

from __future__ import annotations

ANSWERABLE = {"exact", "conceptual", "navigational"}
HOURS_PER_MONTH = 730


def choose_threshold(pos: list[float], neg: list[float], max_neg_pass: float) -> float:
    """Smallest gate threshold letting at most `max_neg_pass` of negatives through.

    Candidates are the negative scores themselves (nudged up so the score at
    the threshold is blocked). `pos` is accepted so callers report the
    answerable questions this rejects; it does not influence the choice.
    """
    allowed = int(max_neg_pass * len(neg))
    ranked = sorted(neg, reverse=True)
    if allowed >= len(ranked):
        return min(ranked + pos) if ranked or pos else 0.0
    return ranked[allowed] + 1e-6


def threshold_sweep(
    pos: list[float], neg: list[float], thresholds: list[float]
) -> list[dict]:
    """For each candidate gate threshold: negatives let through, answerable rejected."""
    return [
        {
            "threshold": t,
            "neg_passing": sum(s >= t for s in neg),
            "pos_rejected": sum(s < t for s in pos),
        }
        for t in thresholds
    ]


def arm_summary(judged: list[dict]) -> dict:
    judged = [j for j in judged if j["label"] != "judge-refused"]
    ans = [j for j in judged if j["family"] in ANSWERABLE]
    neg = [j for j in judged if j["family"] == "negative"]

    def rate(rows: list[dict], label: str) -> float:
        return sum(r["label"] == label for r in rows) / len(rows) if rows else 0.0

    return {
        "faithful": rate(ans, "faithful"),
        "unsupported": rate(ans, "unsupported"),
        "non_answer": rate(ans, "non-answer"),
        "negative_unsupported_ungated": rate(neg, "unsupported"),
    }


def choose_models(arms: list[dict], bar: float, max_mb: int) -> dict:
    """Small = smallest browser arm with faithful >= bar.
    Better = most faithful browser arm within max_mb (ties -> smaller)."""
    browser = [a for a in arms if a["tier"] == "browser" and a["download_mb"] <= max_mb]
    over = sorted(
        (a for a in browser if a["faithful"] >= bar), key=lambda a: a["download_mb"]
    )
    best = sorted(browser, key=lambda a: (-a["faithful"], a["download_mb"]))
    return {
        "small": over[0]["arm"] if over else None,
        "better": best[0]["arm"] if best else None,
    }


def cost_per_1k_hosted(rows: list[dict], in_per_m: float, out_per_m: float) -> float:
    per_q = sum(
        r["input_tokens"] * in_per_m + r["output_tokens"] * out_per_m for r in rows
    )
    return per_q / len(rows) / 1e6 * 1000


def cost_per_1k_always_on_gpu(hourly_usd: float, questions_per_month: int) -> float:
    return hourly_usd * HOURS_PER_MONTH / questions_per_month * 1000
