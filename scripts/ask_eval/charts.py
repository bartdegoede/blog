"""Render the post's two charts as theme-aware inline SVG, straight from the eval data.

Colours are CSS custom properties (`--viz-*`, defined in custom.css for light and
dark), so the SVGs follow PaperMod's theme toggle. Hover = native SVG <title>.

    uv run python scripts/ask_eval/charts.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

try:  # imported as a package by pytest, or run directly as a script
    from ask_eval.report_lib import ANSWERABLE, arm_summary
except ImportError:
    from report_lib import ANSWERABLE, arm_summary  # type: ignore[no-redef]

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
POST_STEM = "2026-10-12-rag-with-a-small-language-model-in-the-browser"
OUT = ROOT / "assets" / "svg" / POST_STEM

NAMES = {
    "smollm2-135m": "SmolLM2-135M",
    "smollm2-360m": "SmolLM2-360M",
    "gemma3-270m": "Gemma 3 270M",
    "lfm2.5-350m": "LFM2.5-350M",
    "qwen3-0.6b": "Qwen3-0.6B",
    "gemma4-e2b": "Gemma 4 E2B",
    "haiku-5-5": "Claude Haiku 5.5",
}


def load(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def counts(judged: list[dict]) -> tuple[int, int, int, int]:
    """faithful, answerable total, invented on negatives, negatives total."""
    ans = [j for j in judged if j["family"] in ANSWERABLE]
    neg = [j for j in judged if j["family"] == "negative"]
    faithful = sum(j["label"] == "faithful" for j in ans)
    invented = sum(j["label"] == "unsupported" for j in neg)
    return faithful, len(ans), invented, len(neg)


def svg_open(w: int, h: int, uid: str, title: str, desc: str) -> list[str]:
    return [
        f'<svg class="viz" viewBox="0 0 {w} {h}" role="img" aria-labelledby="{uid}-t {uid}-d" '
        f'xmlns="http://www.w3.org/2000/svg">',
        f'<title id="{uid}-t">{esc(title)}</title><desc id="{uid}-d">{esc(desc)}</desc>',
    ]


def y_axis(lines, x0, x1, ymap, label):
    for v in (0, 25, 50, 75, 100):
        y = ymap(v)
        lines.append(f'<line class="viz-grid" x1="{x0}" x2="{x1}" y1="{y}" y2="{y}"/>')
        lines.append(f'<text class="viz-tick" x="{x0 - 8}" y="{y + 4}" text-anchor="end">{v}%</text>')
    mid = (ymap(0) + ymap(100)) / 2
    lines.append(
        f'<text class="viz-axis" transform="translate(14 {mid}) rotate(-90)" text-anchor="middle">{label}</text>'
    )


def point(lines, x, y, cls, tip, r=5):
    lines.append(f"<g><title>{esc(tip)}</title>")
    lines.append(f'<circle class="viz-hit" cx="{x:.1f}" cy="{y:.1f}" r="12"/>')
    lines.append(f'<circle class="{cls}" cx="{x:.1f}" cy="{y:.1f}" r="{r}"/></g>')


def quality_vs_size(judgements, cands) -> str:
    w, h, left, right, top, bottom = 680, 380, 64, 24, 20, 60
    lane_x = w - right - 46  # the "API" column, outside the log scale
    x_end = w - right - 110
    lo, hi = math.log10(90), math.log10(4000)

    def xmap(mb):
        return left + (math.log10(mb) - lo) / (hi - lo) * (x_end - left)

    def ymap(pct):
        return top + (100 - pct) / 100 * (h - top - bottom)

    rows = []
    for arm, name in NAMES.items():
        judged = [j for j in judgements if j["arm"] == arm]
        if not judged:
            continue
        f, n, inv, nn = counts(judged)
        mb = next((c["download_mb"] for c in cands if c["arm"] == arm), None)
        rows.append((arm, name, mb, f, n, inv, nn))

    lines = svg_open(
        w, h, "viz-size",
        "Faithful answers vs download size",
        "Share of 30 answerable questions answered faithfully, per model, against "
        "download size on a log scale. Models up to 350 MB score 0 to 3 out of 30; "
        "Qwen3-0.6B (579 MB) 15; Gemma 4 E2B (3.1 GB) 28; Claude Haiku 5.5 via API 27.",
    )
    # Budget band: what fits the "click to load" budget.
    bx = xmap(350)
    lines.append(f'<rect class="viz-band" x="{left}" y="{top}" width="{bx - left:.1f}" height="{h - top - bottom}"/>')
    lines.append(f'<text class="viz-note" x="{left + 6}" y="{top + 14}">fits a 350 MB budget</text>')
    y_axis(lines, left, w - right, ymap, "Faithful answers (of 30)")
    for mb, lab in ((100, "100 MB"), (300, "300 MB"), (1000, "1 GB"), (3000, "3 GB")):
        x = xmap(mb)
        lines.append(f'<text class="viz-tick" x="{x:.1f}" y="{h - bottom + 18}" text-anchor="middle">{lab}</text>')
    lines.append(f'<line class="viz-sep" x1="{x_end + 40}" x2="{x_end + 40}" y1="{top}" y2="{h - bottom}"/>')
    lines.append(f'<text class="viz-tick" x="{lane_x}" y="{h - bottom + 18}" text-anchor="middle">API</text>')
    lines.append(
        f'<text class="viz-axis" x="{(left + x_end) / 2}" y="{h - 14}" text-anchor="middle">Download size (log scale)</text>'
    )
    lines.append(f'<line class="viz-baseline" x1="{left}" x2="{w - right}" y1="{ymap(0)}" y2="{ymap(0)}"/>')

    for arm, name, mb, f, n, inv, nn in rows:
        pct = 100 * f / n
        tip = f"{name}: {f}/{n} faithful; invented an answer for {inv}/{nn} questions the blog doesn't cover"
        cls = {"gemma4-e2b": "viz-dot viz-s1", "qwen3-0.6b": "viz-dot viz-s2"}.get(arm, "viz-dot viz-muted")
        if arm == "haiku-5-5":
            point(lines, lane_x, ymap(pct), "viz-dot viz-hollow", tip)
            lines.append(f'<text class="viz-label" x="{lane_x}" y="{ymap(pct) - 12:.1f}" text-anchor="middle">Haiku 5.5 · {f}/30</text>')
        else:
            tip += f" ({mb} MB download)"
            point(lines, xmap(mb), ymap(pct), cls, tip)
    # Selective direct labels (the 258-293 MB cluster gets one shared label).
    by = {r[0]: r for r in rows}
    lab = []
    small = [by[a] for a in ("smollm2-135m", "lfm2.5-350m", "smollm2-360m", "gemma3-270m") if a in by]
    if small:
        fs = sorted(r[3] for r in small)
        biggest = max(r[2] for r in small)
        lines.append(
            f'<text class="viz-label" x="{left + 8}" y="{ymap(34):.1f}">'
            f'<tspan x="{left + 8}">{len(small)} models up to {biggest} MB</tspan>'
            f'<tspan class="viz-sub" x="{left + 8}" dy="16">{fs[0]} to {fs[-1]} of 30 faithful</tspan></text>'
        )
    if "qwen3-0.6b" in by:
        r = by["qwen3-0.6b"]
        lab.append((xmap(r[2]) + 10, ymap(100 * r[3] / r[4]) + 4, "start", f"Qwen3-0.6B · {r[3]}/30"))
    if "gemma4-e2b" in by:
        r = by["gemma4-e2b"]
        lab.append((xmap(r[2]) - 10, ymap(100 * r[3] / r[4]) + 4, "end", f"Gemma 4 E2B · {r[3]}/30"))
    for x, y, anchor, text in lab:
        lines.append(f'<text class="viz-label" x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}">{esc(text)}</text>')
    lines.append("</svg>")
    return "\n".join(lines)


def length_chart(judged_len) -> str:
    w, h, left, right, top, bottom = 680, 340, 64, 150, 36, 56
    ns = (2, 4, 6)
    series = (("gemma4-e2b", "Gemma 4 E2B", "viz-s1"), ("qwen3-0.6b", "Qwen3-0.6B", "viz-s2"))

    def xmap(n):
        return left + (ns.index(n)) / (len(ns) - 1) * (w - left - right)

    def ymap(pct):
        return top + (100 - pct) / 100 * (h - top - bottom)

    lines = svg_open(
        w, h, "viz-length",
        "Faithful answers vs allowed answer length",
        "Faithful answers out of 30 when the model may answer in at most 2, 4 or 6 "
        "sentences. Gemma 4 E2B: 28, 26, 24. Qwen3-0.6B: 15, 9, 5.",
    )
    # Legend (identity is also carried by the direct labels at the line ends).
    lx = left
    for _, name, cls in series:
        lines.append(f'<circle class="viz-dot {cls}" cx="{lx + 5}" cy="14" r="5"/>')
        lines.append(f'<text class="viz-label" x="{lx + 16}" y="18">{name}</text>')
        lx += 140
    y_axis(lines, left, w - right + 20, ymap, "Faithful answers (of 30)")
    for n in ns:
        lines.append(f'<text class="viz-tick" x="{xmap(n):.1f}" y="{h - bottom + 18}" text-anchor="middle">{n}</text>')
    lines.append(
        f'<text class="viz-axis" x="{(left + w - right) / 2}" y="{h - 14}" text-anchor="middle">Sentences the model may use</text>'
    )
    lines.append(f'<line class="viz-baseline" x1="{left}" x2="{w - right + 20}" y1="{ymap(0)}" y2="{ymap(0)}"/>')
    for arm, name, cls in series:
        pts = []
        for n in ns:
            judged = [j for j in judged_len if j["arm"] == f"{arm}-s{n}"]
            f, total, inv, nn = counts(judged)
            pts.append((n, f, total, inv, nn))
        path = " ".join(
            f"{'M' if i == 0 else 'L'}{xmap(n):.1f},{ymap(100 * f / t):.1f}" for i, (n, f, t, _, _) in enumerate(pts)
        )
        lines.append(f'<path class="viz-line {cls}" d="{path}"/>')
        for n, f, t, inv, nn in pts:
            tip = f"{name}, at most {n} sentences: {f}/{t} faithful; invented an answer for {inv}/{nn} off-blog questions"
            point(lines, xmap(n), ymap(100 * f / t), f"viz-dot {cls}", tip)
        n0, f0, t0 = pts[0][:3]
        n1, f1, t1 = pts[-1][:3]
        lines.append(f'<text class="viz-label" x="{xmap(n0) + 8:.1f}" y="{ymap(100 * f0 / t0) - 10:.1f}">{f0}/30</text>')
        lines.append(f'<text class="viz-label" x="{xmap(n1) + 12:.1f}" y="{ymap(100 * f1 / t1) + 4:.1f}">{name} · {f1}/30</text>')
    lines.append("</svg>")
    return "\n".join(lines)


def main() -> None:
    results = HERE / "results"
    cands = json.loads((HERE / "candidates.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "quality-vs-size.svg").write_text(quality_vs_size(load(results / "judgements.jsonl"), cands))
    (OUT / "faithfulness-vs-length.svg").write_text(length_chart(load(results / "judgements-length.jsonl")))
    # Sanity: the arm_summary rates agree with the counts drawn.
    assert abs(arm_summary([j for j in load(results / "judgements.jsonl") if j["arm"] == "qwen3-0.6b"])["faithful"] - 0.5) < 1e-9
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
