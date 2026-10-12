"""Blind human spot-check of the LLM judge: sample 20 answers, label, score."""

import json
import random
import re
from collections import Counter
from pathlib import Path

import click

HERE = Path(__file__).parent
HAIKU = "haiku-5-5"
LABELS = {"faithful": "faithful", "unsupported": "unsupported",
          "non-answer": "non-answer", "f": "faithful", "u": "unsupported",
          "n": "non-answer"}


def read_jsonl(path):
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


def norm(label):
    return LABELS.get((label or "").strip().lower())


def paths(rd):
    return rd / "spotcheck.jsonl", rd / "spotcheck.md"


def load_runs(rd):
    files = [*(rd / "local").glob("*.jsonl"), *(rd / "hosted").glob("*.jsonl")]
    return {(r["arm"], r["id"]): r for f in files if "dryrun" not in f.name
            for r in read_jsonl(f)}


def render_md(rows):
    out = ["# Spot-check sheet", "",
           "Label each answer: faithful / unsupported / non-answer "
           "(or f / u / n).", ""]
    for r in rows:
        out += [f"## {r['n']}", "", f"**Question:** {r['question']}", ""]
        out += [f"{i}. {p}" for i, p in enumerate(r["passages"], 1)]
        out += ["", "**Answer:**", "", r["summary"], "", "label: ", "", "---", ""]
    return "\n".join(out)


@click.group()
@click.option("--results-dir", type=click.Path(path_type=Path),
              default=HERE / "results", hidden=True)
@click.pass_context
def cli(ctx, results_dir):
    ctx.obj = results_dir


@cli.command()
@click.option("--seed", default=20261012)
@click.option("--force", is_flag=True, help="Overwrite labelled spotcheck.jsonl.")
@click.pass_obj
def sample(rd, seed, force):
    jl, md = paths(rd)
    if jl.exists() and not force:
        if any(r.get("human_label") for r in read_jsonl(jl)):
            raise click.ClickException(f"{jl} has human labels; use --force")
    judged = [j for j in read_jsonl(rd / "judgements.jsonl")
              if j["label"] != "judge-refused"]
    prompts = {p["id"]: p for p in read_jsonl(rd / "prompts.jsonl")}
    runs = load_runs(rd)
    rng = random.Random(seed)
    hk = [j for j in judged if j["arm"] == HAIKU]
    others = [j for j in judged if j["arm"] != HAIKU]
    arms = sorted({j["arm"] for j in others})
    picked = rng.sample(hk, 5)
    chosen = []

    def take(pool, k):
        pool = [j for j in pool if j not in chosen]
        chosen.extend(rng.sample(pool, min(k, len(pool))))

    need = 4 - sum(j["family"] == "negative" for j in picked)
    for a in arms:  # two per local arm, negatives first until the quota is met
        negs = [j for j in others if j["arm"] == a and j["family"] == "negative"]
        if need > 0 and negs:
            take(negs, 1)
            need -= 1
        have = sum(c["arm"] == a for c in chosen)
        take([j for j in others if j["arm"] == a], 2 - have)
    take(others, 15 - len(chosen))
    final = picked + chosen
    rng.shuffle(final)
    rows = []
    for n, j in enumerate(final, 1):
        p = prompts[j["id"]]
        rows.append({"n": n, "arm": j["arm"], "id": j["id"],
                     "family": j["family"], "question": p["question"],
                     "passages": [x["snippet"] for x in p["passages"]],
                     "summary": runs[(j["arm"], j["id"])]["summary"],
                     "judge_label": j["label"], "human_label": None})
    jl.write_text("".join(json.dumps(r) + "\n" for r in rows))
    md.write_text(render_md(rows))
    neg = sum(r["family"] == "negative" for r in rows)
    click.echo(f"Wrote {len(rows)} rows ({neg} negative) to {jl} and {md}")


@cli.command()
@click.option("--from-md", is_flag=True, help="Read labels from spotcheck.md.")
@click.pass_obj
def score(rd, from_md):
    jl, md = paths(rd)
    rows = read_jsonl(jl)
    if from_md:
        found = {int(n): v for n, v in re.findall(
            r"^## (\d+)\b.*?^label:[ \t]*(\S*)", md.read_text(), re.M | re.S)}
        for r in rows:
            r["human_label"] = found.get(r["n"]) or None
        jl.write_text("".join(json.dumps(r) + "\n" for r in rows))
    bad = [r["n"] for r in rows if norm(r["human_label"]) is None]
    if bad:
        raise click.ClickException(f"missing/invalid labels for n = {bad}")
    for r in rows:
        r["human_label"] = norm(r["human_label"])
    agree = [r for r in rows if r["human_label"] == r["judge_label"]]
    hk = [r for r in rows if r["arm"] == HAIKU]
    click.echo(f"Overall agreement: {len(agree)}/{len(rows)}")
    click.echo(f"{HAIKU} agreement: "
               f"{sum(r in agree for r in hk)}/{len(hk)}")
    c = Counter((r["human_label"], r["judge_label"]) for r in rows)
    cols = sorted({k[1] for k in c} | {"faithful", "unsupported", "non-answer"})
    click.echo("\nhuman \\ judge".ljust(16) + "".join(x.rjust(13) for x in cols))
    for h in ("faithful", "unsupported", "non-answer"):
        click.echo(h.ljust(15) + "".join(str(c[(h, x)]).rjust(13) for x in cols))


if __name__ == "__main__":
    cli()
