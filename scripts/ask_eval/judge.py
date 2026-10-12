# scripts/ask_eval/judge.py
"""Label every arm's summary as faithful / unsupported / non-answer against its passages."""

import json
from pathlib import Path
from typing import Literal

import anthropic
import click
from pydantic import BaseModel

HERE = Path(__file__).parent
JUDGE = "claude-opus-5-5"
IN_PER_M, OUT_PER_M = 4.00, 20.00  # USD, Claude Opus 5.5

INSTRUCTIONS_TEMPLATE = """You are grading a short answer written by a small language model.
The model was given numbered passages from a blog and a question, and told to answer
in at most {n} sentences using only the passages.

Label the answer:
- "faithful": every factual claim in the answer is supported by the passages, and it
  addresses the question (saying the blog does not cover it counts as faithful ONLY if
  the passages really do not answer the question).
- "unsupported": at least one claim is not supported by the passages (invented,
  contradicted, or from outside knowledge), even if it happens to be true.
- "non-answer": no unsupported claims, but it does not answer the question although the
  passages do (declines wrongly, rambles, repeats the question, empty).

An answer that is cut off mid-sentence is judged on what it says, not penalised for the
cut-off itself. Judge only against the passages, not your own knowledge of the topic.{extra}"""
INSTRUCTIONS = INSTRUCTIONS_TEMPLATE.format(n=2, extra="")
LENGTH_NOTE = " Do not penalise length; judge only whether claims are supported."


def instructions(max_sentences: int | None) -> str:
    """Rows without max_sentences (the original eval) get the original text byte-for-byte."""
    if max_sentences is None:
        return INSTRUCTIONS
    return INSTRUCTIONS_TEMPLATE.format(n=max_sentences, extra=LENGTH_NOTE)


class Verdict(BaseModel):
    label: Literal["faithful", "unsupported", "non-answer"]
    unsupported_claims: list[str]
    reason: str


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def render(p: dict, summary: str, max_sentences: int | None = None) -> str:
    passages = "\n\n".join(
        f"[{i + 1}] {x['title']}\n{x['snippet']}" for i, x in enumerate(p["passages"])
    )
    return (
        f"{instructions(max_sentences)}\n\n<passages>\n{passages}\n</passages>\n\n"
        f"<question>{p['question']}</question>\n\n<answer>{summary}</answer>"
    )


def arm_files(runs_dir: Path | None = None) -> dict[str, Path]:
    """Default: results/local/ plus the hosted arm. With runs_dir: just its *.jsonl."""
    if runs_dir is not None:
        return {p.stem: p for p in sorted(runs_dir.glob("*.jsonl"))}
    files = {p.stem: p for p in sorted((HERE / "results" / "local").glob("*.jsonl"))}
    hosted = HERE / "results" / "hosted" / "haiku-5-5.jsonl"
    if hosted.exists():
        files["haiku-5-5"] = hosted
    return files


def done_pairs(path: Path) -> set[tuple[str, str]]:
    if not path.exists():
        return set()
    return {(r["arm"], r["id"]) for r in load_jsonl(path)}


def cost(inp: int, out: int) -> float:
    return inp / 1e6 * IN_PER_M + out / 1e6 * OUT_PER_M


@click.command()
@click.option("--arm", "arms", multiple=True, help="Only judge these arms.")
@click.option("--limit", type=int, default=None, help="Judge only the first N rows.")
@click.option("--dry-run", is_flag=True, help="Write to <out stem>.dryrun.jsonl.")
@click.option(
    "--runs-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=None,
    help="Judge every *.jsonl here (relative to scripts/ask_eval/) instead of "
    "results/local + hosted.",
)
@click.option(
    "--out",
    "out_path",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("results/judgements.jsonl"),
    show_default=True,
    help="Judgements file, relative to scripts/ask_eval/.",
)
def main(
    arms: tuple[str, ...],
    limit: int | None,
    dry_run: bool,
    runs_dir: Path | None,
    out_path: Path,
) -> None:
    results = HERE / "results"
    runs_dir = HERE / runs_dir if runs_dir is not None else None
    real_out = HERE / out_path
    out = real_out.with_suffix(".dryrun.jsonl") if dry_run else real_out

    prompts = {p["id"]: p for p in load_jsonl(results / "prompts.jsonl")}
    files = arm_files(runs_dir)
    if arms:
        unknown = [a for a in arms if a not in files]
        if unknown:
            raise click.UsageError(f"unknown arm(s): {unknown}; have {sorted(files)}")
        files = {a: files[a] for a in arms}

    rows = [r for path in files.values() for r in load_jsonl(path)]
    done = done_pairs(out)
    todo = [r for r in rows if (r["arm"], r["id"]) not in done]
    n_done = len(rows) - len(todo)
    if limit is not None:
        todo = todo[:limit]
    click.echo(f"{len(todo)} to judge ({n_done} already done)")

    client = anthropic.Anthropic()
    tok_in = tok_out = 0
    with out.open("a") as f:
        for r in todo:
            p = prompts[r["id"]]
            resp = client.messages.parse(
                model=JUDGE,
                max_tokens=16000,
                messages=[
                    {
                        "role": "user",
                        "content": render(p, r["summary"], r.get("max_sentences")),
                    }
                ],
                output_format=Verdict,
            )
            tok_in += resp.usage.input_tokens
            tok_out += resp.usage.output_tokens
            if resp.stop_reason == "refusal" or resp.parsed_output is None:
                verdict = {
                    "label": "judge-refused",
                    "unsupported_claims": [],
                    "reason": str(resp.stop_reason),
                }
            else:
                verdict = resp.parsed_output.model_dump()
            line = {"arm": r["arm"], "id": r["id"], "family": p["family"], **verdict}
            f.write(json.dumps(line) + "\n")
            f.flush()
            click.echo(".", nl=False)
    click.echo()

    spent = cost(tok_in, tok_out)
    click.echo(f"tokens: {tok_in} in, {tok_out} out; cost ${spent:.4f}")
    if todo:
        all_rows = [
            r for path in arm_files(runs_dir).values() for r in load_jsonl(path)
        ]
        real_done = done_pairs(real_out)
        remaining = sum(1 for r in all_rows if (r["arm"], r["id"]) not in real_done)
        per_row = spent / len(todo)
        click.echo(
            f"projected for {remaining} unjudged rows (all arms): "
            f"${per_row * remaining:.2f}"
        )


if __name__ == "__main__":
    main()
