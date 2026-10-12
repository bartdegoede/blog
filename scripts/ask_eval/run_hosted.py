# scripts/ask_eval/run_hosted.py
"""Send every prompt in results/prompts.jsonl to Claude Haiku 5.5, same messages as local arms."""

import json
import time
from pathlib import Path

import anthropic
import click

HERE = Path(__file__).parent
MODEL = "claude-haiku-5-5"
MAX_NEW_TOKENS = 120  # mirrors assets/js/ask/prompt.js


@click.command()
@click.option(
    "--limit", type=int, default=None, help="Only the first N prompts (dry run)."
)
def main(limit: int | None) -> None:
    lines = (HERE / "results/prompts.jsonl").read_text().splitlines()
    prompts = [json.loads(line) for line in lines]
    prompts = prompts[:limit] if limit else prompts
    client = anthropic.Anthropic()
    out = HERE / "results/hosted"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for p in prompts:
        system, user = p["messages"][0]["content"], p["messages"][1:]
        t0 = time.perf_counter()
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_NEW_TOKENS,
            system=system,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            messages=user,
        )
        if resp.stop_reason == "refusal":
            summary = ""
        else:
            summary = "".join(b.text for b in resp.content if b.type == "text")
            summary = summary.strip()
        rows.append(
            {
                "arm": "haiku-5-5",
                "id": p["id"],
                "summary": summary,
                "latency_ms": round((time.perf_counter() - t0) * 1000),
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
                "stop_reason": resp.stop_reason,
            }
        )
        click.echo(".", nl=False)
    name = "haiku-5-5.dryrun.jsonl" if limit else "haiku-5-5.jsonl"
    (out / name).write_text("".join(json.dumps(r) + "\n" for r in rows))
    click.echo(f"\n{len(rows)} rows -> {out / name}")


if __name__ == "__main__":
    main()
