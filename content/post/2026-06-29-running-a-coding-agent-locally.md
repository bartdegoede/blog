---
title: "Running a coding agent locally for when the budget runs out"
date: 2026-06-29T12:00:00-07:00
draft: false
slug: "running-a-coding-agent-locally"
categories: ["ai", "python", "how-to"]
keywords: ["local ai", "coding agent", "qwen", "mlx", "lm studio", "claude code", "codex", "apple silicon", "pi"]
description: "The all-you-can-eat AI coding era is over. So what do you do on the 22nd of the month, when the token budget's gone and there's over a week of work left? Here's a local coding agent (Pi plus Qwen3-Coder on a MacBook) that's decent enough for the routine stuff and runs for free (if you have enough RAM)."
cover:
    image: "/img/2026-06-29-running-a-coding-agent-locally/cover.png"
related:
  - ai-agent-dungeon-crawl
---

{{<audio src="/audio/2026-06-29-running-a-coding-agent-locally.mp3" type="mp3">}}

In June 2026, Uber told its engineers they each would get a $1500 a month cap for AI coding tools and not a token more. That cap came after the company [burned through its *entire* 2026 AI coding budget in four months](https://techcrunch.com/2026/06/02/uber-caps-employee-ai-spending-after-blowing-through-budget-in-four-months/): Claude Code adoption went from a third of engineers to 84% in about a quarter, power users were running [$500–$2,000 a month](https://simonwillison.net/2026/Jun/3/uber-caps-usage/), and the CTO ended up ["back to the drawing board"](https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/). Uber wasn't alone; Microsoft pulled Claude Code licenses from a division, Walmart capped its internal vibe-coding tool, and TechCrunch wrote about how ["the token bill comes due"](https://techcrunch.com/2026/06/05/the-token-bill-comes-due-inside-the-industry-scramble-to-manage-ais-runaway-costs/).

The all-you-can-eat era is over, or nearing its end at least. Which raises a very practical question for any team: what do you do on the 22nd of the month, when the budget's gone and there's over a week of work left? "Everyone stops shipping" is a bad answer, and going back to artisanal coding unrealistic.<!-- more -->

I've been messing around with LM Studio, Ollama and others, so when I saw [a YouTube video from WWDC](https://www.youtube.com/watch?v=wykPErJ8M-8) about running a coding agent locally with MLX directly, I wanted to see if that would be better. Not because a 30B model on my laptop is going to replace Claude (lol) but because a local agent that's *good enough* for the routine stuff is a decent insurance policy at least, and may even run some of the easy stuff. And it runs on hardware I already have (MacBook Pro with M4 Pro, 48 GB RAM), for the very agreeable price of free[^free].

# The three pieces

A local coding agent is three things talking HTTP:

```
Pi (the agent)  ──OpenAI API──>  a model server  ──>  Qwen3-Coder-30B on MLX
```

- **The model:** `Qwen3-Coder-30B-A3B`, 4-bit. This is [a "mixture-of-experts" model](https://huggingface.co/blog/moe), which means that it has 30B parameters total, but only ±3B are ever activated per token, so the promise is that you get 30B-ish quality at ±3B speed. Tuned for *agentic* coding (multi-step tool use, editing files), which is what an agent actually does. And all that for ±17 GB of weights.
- **The agent:** [Pi](https://github.com/earendil-works/pi), a minimal coding agent (it can read, write and edit, and run bash, and not much else). It speaks plain OpenAI chat completions, which (foreshadowing) turns out to matter a lot.
- **The server:** this is the rabbit hole part.

The agent was the easy choice. Pi is small, it's provider-agnostic, and it doesn't do anything clever with ["billing headers" that break cache for Ollama or LM Studio](https://x.com/hqmank/status/2056205388689891834). Pick Pi, point it at a server, done.

# First pass: the MLX server

Apple's own MLX inference server (`mlx_lm.server`) is the most minimal, "official" thing. It speaks the OpenAI API, it's one `pip install`, it's maintained by the MLX team. How hard could it be? Right?

Reader, there were Some Things™ that needed fixing.

**1. You can't quantize the KV cache.** I wanted a big context window (coding agents constantly re-read files) but at 256K an fp16 KV cache is ±24 GB, which on top of ±17 GB of weights means the machine starts swapping and everything grinds to a screeching halt. The fix is an 8-bit KV cache. `mlx_lm.server` has no flag for it. The *library* it's built on supports KV quantization perfectly well; the server just doesn't expose it (yet)[^kvbits]. So: monkeypatch it is.

**2. The patch silently did nothing.** I patched the quantization in, tests passed, and the server kept using fp16 anyway. Turns out `mlx_lm.server` has *two* code paths: a single-request path (the one I initially patched) and a *batched* one built on a different class, which has no KV quantization and is the **default** for batchable models. My carefully-quantized cache was running at full fp16 the whole time, silently. I only caught it because I'd added logging that printed peak memory.[^logging] Fix: force every request down the single-stream path. (Batching only helps with concurrent requests; I am not letting others run their prompts on my GPU, and my monkeybrain has a hard time with multiple coding agents running simultaneously anyway)

**3. It crashed on the first real edit.** This is the one that would've shipped if I'd trusted my smoke test. Checking tool-calling with a simple prompt — `get_weather(city="Paris")` — passed perfectly. Then I ran a better eval (more on that below) and **every task crashed instantly**: "`stream ended without finish_reason`".

The server was crashing mid-request, every time the agent tried to edit a file. When Pi edits code, the tool-call arguments contain the old and new code, ie strings with **literal newlines in them**. mlx-lm's Qwen3-Coder tool parser tries `json.loads` (invalid because JSON wants escaped newlines), falls back to `ast.literal_eval` (also invalid, Python doesn't like unterminated string literals)[^toolparser], and when both fail, the exception takes down the request handler. My smoke test never caught it because `city="Paris"` is one line. **Real code edits are not one line.** The fix is a tolerant parser that escapes the control characters before parsing.

Four patches (KV quantization, single-stream, logging, tool parser) to get a "minimal, official" server to run a coding agent without crashing. None of it is hard, exactly; it's just that **everything in local AI right now is bleeding edge**, and "official and minimal" turns out to mean "you get to discover the gaps yourself". Fun times were had.

# But is the model any good?

Worth pausing here, because measuring tokens-per-second here answers the wrong question. Speed tells you it's *fast enough*; it tells you nothing about whether the thing can write correct code.

So I built a small eval. Two "real" coding tasks: a cross-file bug, and a function to implement from a failing-test spec, each with a pytest suite as an objective pass/fail oracle. No vibes, just "do the tests go green." Scored against Qwen3-Coder:

| Task | Result | Time |
|------|--------|------|
| Cross-file bug (fails in one file, root cause in another) | ✅ pass | 57s |
| Implement a function from a failing-test spec | ✅ pass | 29s |

Both passed. The feature was clean; the bugfix was correct, with one unnecessary cosmetic edit (the kind of thing you'd shrug at in a junior's PR, or in an AI slop PR for that matter). Which is probably the right mental model still: **a capable junior that works for free and never sleeps, not a senior you leave unsupervised** (well, "free".. have you seen RAM prices recently?). For routine work when the budget's gone? It'll do.

(For the curious: ~88 tok/s at small context, easing to ~45 toward 8K; peak memory plateaued around 21 GB across a real session even as context grew, which was the entire point of the KV quantization. The machine stayed usable, albeit a tad warm).

# The anticlimax: just use LM Studio

Here's where I have to be honest with you. After an evening of having fun patching and debugging, I loaded the *exact same model* into [LM Studio](https://lmstudio.ai/), because it has checkboxes in its model loading screen: **8-bit KV cache. "Start quantizing when context reaches 5000 tokens." Group size.** As a toggle. Sometimes you really don't need to reinvent the wheel huh? 🙃

I ran my eval against it. Both tasks passed, and it **did not crash on the multi-line edits.** LM Studio's MLX runtime parses Qwen3-Coder's tool calls correctly out of the box; the bug that took down my toy server simply isn't there. Same model, same machine, matched settings:

| Server | tok/s | multi-line edits | setup |
|--------|-------|------------------|-------|
| my patched `mlx-lm` | ±85 | works *after* a patch | an evening of yak-shaving |
| LM Studio | ±80 | works | three checkboxes |

So here's my actual recommendation:

**If you want a local coding agent, use Pi + LM Studio.** Download LM Studio, pull `Qwen3-Coder-30B-A3B`, turn on 8-bit KV cache in the load dialog, start its server. Then point Pi at it:

```bash
npm install -g @earendil-works/pi-coding-agent
# ~/.pi/agent/models.json: one provider pointing at http://localhost:1234/v1
cd ~/some/project && pi
```

That's the whole thing. No patches, no rabbit hole.

Would I do the `mlx-lm` version again? Absolutely. Who doesn't love a properly shaved yak? And it's _faster_. Would I _recommend_ it? Probably, if you're into yak-shaving. If you're not, just install LM Studio. Or get [Ollama Max](https://ollama.com/pricing), comes highly recommended by some of my buddies. If you want to own your serving stack, just mess around with it, or compare the shave of your yak with mine, the patched `mlx-lm` launcher is [on Github](https://github.com/bartdegoede/local-ai).

# What about Codex and Claude Code?

Pi is easy mode specifically because it speaks plain OpenAI chat completions. The bigger-name agents have each wandered off into their own API dialect, and a local server doesn't speak those dialects.

**Codex** [removed support](https://github.com/openai/codex/discussions/7782) for OpenAI's own Chat Completions API; current versions only speak the newer **Responses API**:

```
Error loading config.toml: `wire_api = "chat"` is no longer supported.
```

Neither `mlx_lm.server` nor LM Studio serves Responses, so you need a translating proxy in front, or an older Codex pinned to `wire_api = "chat"`. Doable, not delightful.

**Claude Code** speaks only Anthropic's Messages API. To use a local OpenAI server you need a proxy like [`claude-code-router`](https://github.com/musistudio/claude-code-router). It's purpose-built: run `npm install`, a small config pointing at `localhost:1234`, run `ccr code`. It works. It also, amusingly, reintroduces the exact prompt-caching quirks I picked Pi to avoid. Ha. Fine for a budget-ran-out hatch; not how you'd want to drive daily.

The pattern, once you see it: **for local models, the agent that asks the least of your server wins.** Right now that's Pi.

# Would I recommend any of this?

For a genuinely usable local fallback: yes. Pi + LM Studio, an afternoon, zero ongoing cost. The model is good enough for the routine stuff, your machine stays usable, and you're not staring at a spending cap on the 22nd.

And if you're the kind of person who reads "you can't quantize the KV cache from the server" as a personal challenge, the rabbit hole is warm, yaks always need shaving, and the bugs are real. Just know going in that the polished tool already had the checkboxes.

[^free]: Free is my favorite price.
[^kvbits]: Open issues: [Expose `--kv-bits` in `mlx_lm.server`](https://github.com/ml-explore/mlx-lm/issues/1308) (which describes *exactly* this — large models saturating memory on a 48 GB Mac) and [Add KV cache quantization support to server](https://github.com/ml-explore/mlx-lm/issues/1043). Both still open as of 29 June 2026.
[^logging]: Which was its own little yak-shave: the server computes tokens-per-second and peak memory for every request and then throws the numbers away, so I patched *that* too.. and then it still didn't log, because I'd put the logging after the generation loop, and the server breaks out of that loop early and never resumes my generator. Gotta love Python generators.
[^toolparser]: There's history here: an earlier PR [added the `ast.literal_eval` fallback](https://github.com/ml-explore/mlx-lm/pull/1004) (merged March 2026) specifically because Qwen-Coder emits Python-literal-ish arguments that aren't valid JSON. It just doesn't cover multi-line strings, where *both* parsers fail. The broader "Qwen tool calls aren't valid JSON" problem shows up [all](https://github.com/QwenLM/qwen-code/issues/783) [over](https://github.com/waybarrios/vllm-mlx/issues/63) the ecosystem; it's a model-output quirk everyone is patching around independently.
