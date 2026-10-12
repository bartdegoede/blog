# scripts/ask_eval/report.py
"""Aggregate all results into results/report.md (tables the results doc and post quote)."""

from __future__ import annotations

import json
import statistics
from pathlib import Path

import click

try:
    from scripts.ask_eval import report_lib as lib
except ImportError:  # run as a plain script
    import report_lib as lib  # type: ignore[no-redef]

HERE = Path(__file__).parent
RESULTS = HERE / "results"
TIER_ORDER = {"browser": 0, "midsize": 1, "large": 2, "hosted": 3}
HAIKU_ARM = "haiku-5-5"
HAIKU_IN_PER_M = 0.10
HAIKU_OUT_PER_M = 0.50
GATED_THRESHOLDS = [0.40, 0.45, 0.50]
SWEEP = [round(0.30 + 0.05 * i, 2) for i in range(8)]


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.0f}%)" if d else "n/a"


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


@click.command()
@click.option("--gpu-hourly-usd", type=float, required=True)
@click.option("--gpu-source", required=True, help="Provider + URL, printed in report.")
@click.option("--questions-per-month", type=int, required=True)
@click.option("--max-neg-pass", type=float, default=0.10, show_default=True)
@click.option("--bar", type=float, default=0.75, show_default=True)
@click.option("--max-mb", type=int, default=350, show_default=True)
def main(gpu_hourly_usd, gpu_source, questions_per_month, max_neg_pass, bar, max_mb):
    prompts = read_jsonl(RESULTS / "prompts.jsonl")
    judgements = read_jsonl(RESULTS / "judgements.jsonl")
    candidates = {c["arm"]: c for c in json.loads((HERE / "candidates.json").read_text())}

    ans = [p for p in prompts if p["family"] in lib.ANSWERABLE]
    neg = [p for p in prompts if p["family"] == "negative"]
    pos_scores = [p["best_score"] for p in ans]
    neg_scores = [p["best_score"] for p in neg]
    out: list[str] = ["# Ask eval report", ""]

    # 1. retrieval
    hits = sum(p["retrieval_hit"] for p in ans)
    missed = [p["id"] for p in ans if not p["retrieval_hit"]]
    out += [
        "## Retrieval",
        "",
        f"hit@4 on answerable questions: {hits}/{len(ans)}. "
        f"Missed: {', '.join(missed) or 'none'}.",
        "",
    ]

    # runs
    runs: dict[str, list[dict]] = {}
    for f in sorted((RESULTS / "local").glob("*.jsonl")):
        runs[f.stem] = read_jsonl(f)
    hosted = RESULTS / "hosted" / f"{HAIKU_ARM}.jsonl"
    if hosted.exists():
        runs[HAIKU_ARM] = read_jsonl(hosted)

    def tier(arm: str) -> str:
        return "hosted" if arm == HAIKU_ARM else candidates[arm]["tier"]

    def mb(arm: str):
        return candidates.get(arm, {}).get("download_mb", 0)

    gpu_1k = lib.cost_per_1k_always_on_gpu(gpu_hourly_usd, questions_per_month)
    arms = sorted(runs, key=lambda a: (TIER_ORDER[tier(a)], mb(a)))
    rows, lib_arms, judged_by_arm = [], [], {}
    for arm in arms:
        judged = [j for j in judgements if j["arm"] == arm]
        judged_by_arm[arm] = judged
        s = lib.arm_summary(judged)
        ok = [j for j in judged if j["label"] != "judge-refused"]
        n_ans = sum(j["family"] in lib.ANSWERABLE for j in ok)
        n_neg = sum(j["family"] == "negative" for j in ok)
        cnt = lambda k, d: round(s[k] * d)  # noqa: E731
        r = runs[arm]
        if arm == HAIKU_ARM:
            ttft = f"{statistics.median(x['latency_ms'] for x in r):.0f} (e2e)"
            toks = "n/a"
            cost = lib.cost_per_1k_hosted(r, HAIKU_IN_PER_M, HAIKU_OUT_PER_M)
        else:
            ttft = f"{statistics.median(x['ttft_ms'] for x in r):.0f}"
            toks = f"{statistics.median(x['tok_s'] for x in r):.1f}"
            cost = gpu_1k if tier(arm) == "large" else 0.0
        rows.append(
            [
                arm,
                tier(arm),
                str(mb(arm)) if mb(arm) else "n/a",
                pct(cnt("faithful", n_ans), n_ans),
                pct(cnt("unsupported", n_ans), n_ans),
                pct(cnt("non_answer", n_ans), n_ans),
                f"{cnt('negative_unsupported_ungated', n_neg)}/{n_neg}",
                ttft,
                toks,
                f"{cost:.2f}",
            ]
        )
        lib_arms.append(
            {
                "arm": arm,
                "tier": tier(arm),
                "download_mb": mb(arm),
                "faithful": s["faithful"],
            }
        )
    out += [
        "## Arm table",
        "",
        table(
            [
                "arm", "tier", "download MB", "faithful", "unsupported",
                "non-answer", "negatives answered (invented)",
                "median TTFT ms", "median tok/s", "USD / 1k questions",
            ],
            rows,
        ),
        "",
        "TTFT is CPU for local arms; for haiku-5-5 it is end-to-end latency "
        "including network.",
        "",
    ]

    # 3. monthly cost
    hk = runs.get(HAIKU_ARM)
    hk_month = (
        lib.cost_per_1k_hosted(hk, HAIKU_IN_PER_M, HAIKU_OUT_PER_M)
        * questions_per_month / 1000
        if hk
        else 0.0
    )
    out += [
        "## Monthly cost framing",
        "",
        f"- Always-on GPU: ${gpu_hourly_usd:.3f}/h x {lib.HOURS_PER_MONTH} h = "
        f"${gpu_hourly_usd * lib.HOURS_PER_MONTH:.2f}/month "
        f"(source: {gpu_source}).",
        f"- Haiku 5.5 at {questions_per_month} questions/month "
        f"(${HAIKU_IN_PER_M}/${HAIKU_OUT_PER_M} per 1M in/out tokens): "
        f"${hk_month:.4f}/month.",
        "",
    ]

    # 4. sweep
    sweep = lib.threshold_sweep(pos_scores, neg_scores, SWEEP)
    chosen = lib.choose_threshold(pos_scores, neg_scores, max_neg_pass)
    ch = lib.threshold_sweep(pos_scores, neg_scores, [chosen])[0]
    out += [
        "## Gate threshold sweep",
        "",
        table(
            ["threshold", "negatives passing", "answerable rejected"],
            [
                [
                    f"{r['threshold']:.2f}",
                    f"{r['neg_passing']}/{len(neg)}",
                    f"{r['pos_rejected']}/{len(ans)}",
                ]
                for r in sweep
            ],
        ),
        "",
        f"choose_threshold at max-neg-pass {max_neg_pass}: {chosen:.4f} "
        f"-> {ch['neg_passing']}/{len(neg)} negatives pass, rejects "
        f"{ch['pos_rejected']}/{len(ans)} answerable.",
        "",
    ]

    # 5. gated effect
    score = {p["id"]: p["best_score"] for p in prompts}
    grows = []
    for arm in arms:
        j = judged_by_arm[arm]
        row = [arm]
        for t in GATED_THRESHOLDS:
            invented = sum(
                x["family"] == "negative"
                and score[x["id"]] >= t
                and x["label"] == "unsupported"
                for x in j
            )
            blocked = sum(
                x["family"] in lib.ANSWERABLE and score[x["id"]] < t for x in j
            )
            row += [f"{invented}/{len(neg)}", f"{blocked}/{len(ans)}"]
        grows.append(row)
    ghead = ["arm"]
    for t in GATED_THRESHOLDS:
        ghead += [f"t={t:.2f} negatives still invented", f"t={t:.2f} answerable blocked"]
    out += ["## Gated effect", "", table(ghead, grows), ""]

    # 6. choose_models
    models = lib.choose_models(lib_arms, bar, max_mb)
    out += [
        "## choose_models",
        "",
        f"bar={bar}, max-mb={max_mb}: small = {models['small']}, "
        f"better = {models['better']}.",
        "",
        "A human makes the final shipping decision in the results doc.",
        "",
    ]

    text = "\n".join(out)
    (RESULTS / "report.md").write_text(text)
    click.echo(text)


if __name__ == "__main__":
    main()
