# Ask eval report

## Retrieval

hit@4 on answerable questions: 28/30. Missed: q03, q16.

## Arm table

| arm | tier | download MB | faithful | unsupported | non-answer | negatives answered (invented) | median TTFT ms | median tok/s | USD / 1k questions |
|---|---|---|---|---|---|---|---|---|---|
| smollm2-135m | browser | 120 | 0/30 (0%) | 28/30 (93%) | 2/30 (7%) | 14/15 | 972 | 43.4 | 0.00 |
| lfm2.5-350m | browser | 258 | 2/30 (7%) | 27/30 (90%) | 1/30 (3%) | 14/15 | 2039 | 25.5 | 0.00 |
| smollm2-360m | browser | 275 | 3/30 (10%) | 24/30 (80%) | 3/30 (10%) | 15/15 | 2620 | 22.1 | 0.00 |
| gemma3-270m | browser | 293 | 3/30 (10%) | 22/30 (73%) | 5/30 (17%) | 13/15 | 1777 | 23.7 | 0.00 |
| qwen3-0.6b | midsize | 579 | 15/30 (50%) | 15/30 (50%) | 0/30 (0%) | 5/15 | 4892 | 11.0 | 0.00 |
| gemma4-e2b | large | 3131 | 28/30 (93%) | 2/30 (7%) | 0/30 (0%) | 0/15 | 13692 | 4.3 | 1032.22 |
| haiku-5-5 | hosted | n/a | 27/30 (90%) | 3/30 (10%) | 0/30 (0%) | 1/15 | 1120 (e2e) | n/a | 0.13 |

TTFT is CPU for local arms; for haiku-5-5 it is end-to-end latency including network.

## Monthly cost framing

- Always-on GPU: $0.707/h x 730 h = $516.11/month (source: Google Cloud g2-standard-4 (1x NVIDIA L4), us-central1 on-demand, via https://computeprices.com/providers/google/gpus/l4 (checked 2026-10-12)).
- Haiku 5.5 at 500 questions/month ($0.1/$0.5 per 1M in/out tokens): $0.0657/month.

## Gate threshold sweep

| threshold | negatives passing | answerable rejected |
|---|---|---|
| 0.30 | 12/15 | 0/30 |
| 0.35 | 12/15 | 0/30 |
| 0.40 | 11/15 | 1/30 |
| 0.45 | 9/15 | 2/30 |
| 0.50 | 8/15 | 4/30 |
| 0.55 | 4/15 | 9/30 |
| 0.60 | 2/15 | 12/30 |
| 0.65 | 0/15 | 15/30 |

choose_threshold at max-neg-pass 0.1: 0.6136 -> 1/15 negatives pass, rejects 13/30 answerable.

## Gated effect

| arm | t=0.40 negatives still invented | t=0.40 answerable blocked | t=0.45 negatives still invented | t=0.45 answerable blocked | t=0.50 negatives still invented | t=0.50 answerable blocked |
|---|---|---|---|---|---|---|
| smollm2-135m | 10/15 | 1/30 | 8/15 | 2/30 | 8/15 | 4/30 |
| lfm2.5-350m | 10/15 | 1/30 | 8/15 | 2/30 | 7/15 | 4/30 |
| smollm2-360m | 11/15 | 1/30 | 9/15 | 2/30 | 8/15 | 4/30 |
| gemma3-270m | 10/15 | 1/30 | 9/15 | 2/30 | 8/15 | 4/30 |
| qwen3-0.6b | 5/15 | 1/30 | 5/15 | 2/30 | 5/15 | 4/30 |
| gemma4-e2b | 0/15 | 1/30 | 0/15 | 2/30 | 0/15 | 4/30 |
| haiku-5-5 | 1/15 | 1/30 | 1/15 | 2/30 | 1/15 | 4/30 |

## choose_models

bar=0.75, max-mb=350: small = None, better = smollm2-360m.

A human makes the final shipping decision in the results doc.
