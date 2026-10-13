---
title: "Running RAG with a (small) language model in the browser"
date: 2026-10-12T21:00:00-04:00
draft: true
slug: "rag-with-a-small-language-model-in-the-browser"
categories: ["machine learning", "ai", "search", "javascript", "hugo"]
keywords: ["rag", "retrieval augmented generation", "small language models", "transformers.js", "webgpu", "wasm", "qwen3", "gemma", "llm evaluation", "static site", "browser"]
description: "My blog's search already finds the right passages in your browser. I tried letting a small language model, also running in your browser, summarise them, and measured how often it tells the truth."
---

A few weeks ago I came across [MicroLLM lab](https://stateofutopia.com/experiments/microllmlab/), a page that downloads small language models (25 to 360 million parameters) into your browser and lets you chat with and benchmark them on your own GPU[^petitgpt]. No server, no API key, no account. It's a lovely demo, and it got me thinking about the [semantic search I added to this blog](/semantic-search-in-your-browser/) earlier this year: that already finds the right passages for a question, entirely in the browser, from a 4 MB lookup table. What if a tiny model, also in the browser, read those passages and answered the question?

So I built that: [ask my blog](/ask/). Search finds the four most relevant passages, and a small language model running in your browser summarises them in two sentences. Nothing you type leaves your machine. And because "a small model summarises things" is exactly the sort of sentence that hides a lot of made-up nonsense, I measured how often it's actually faithful to what I wrote. The answer turned out to be the most interesting part.<!-- more -->

{{< video name="ask-webgpu" caption="Ask my blog on WebGPU: Qwen3-0.6B (already cached) answers, then switching to SmolLM2-360M downloads it." >}}

## How it works

The page is retrieval-augmented generation (RAG) with every piece running client-side:

1. **Retrieve.** Your question goes through the same static-embedding search as the homepage, but instead of rolling results up to posts, it keeps the four best-scoring *passages*.
2. **Gate.** If the best passage scores below a threshold, the model isn't called at all and the page says it couldn't find this on the blog. More on why that only half works below.
3. **Prompt.** The passages, numbered, plus a system prompt: answer in at most two sentences, use only these passages, say so if they don't answer the question.
4. **Generate.** A Web Worker runs the model with [transformers.js](https://huggingface.co/docs/transformers.js) on WebGPU, or on the CPU via WebAssembly if your browser doesn't have WebGPU, and streams the answer into the page. It stops as soon as it has two complete sentences.

The passages are shown first, as cards, and the summary sits above them with a label that says it may be wrong. You can search without loading a model at all; you just get the passages. Loading one is an explicit click, because it means downloading a few hundred megabytes from Hugging Face (once; your browser keeps it).

![The download indicator: one square per 4 MB of model](/img/2026-10-12-rag-with-a-small-language-model-in-the-browser/download-blocks.jpg)

Each square is about 4 MB of the download, so a bigger model has visibly more to fill. That's the fun bit. The rest of this post is about the less fun bit.

## Which model?

I wanted something that would be a reasonable click for a reader: a few hundred megabytes, not gigabytes. The candidates that have browser-ready (ONNX) builds were SmolLM2 (135M and 360M parameters), Gemma 3 270M, LFM2.5-350M, Qwen2.5-0.5B and Qwen3-0.6B. For comparison I added two references that would never ship on the page: Gemma 4 E2B, the smallest of Google's new Gemma 4 models at a 3.1 GB download, and Claude Haiku 5.5 through the API, the "just pay someone" option.

One surprise before anything ran: for several of these models the "4-bit" (q4) build is *bigger* than the 4-bit-with-16-bit-floats (q4f16) one, because the q4 export keeps the embedding table in full 32-bit precision. SmolLM2-360M is 390 MB as q4 and 275 MB as q4f16, with identical output. Everything below uses q4f16.

## The eval

I reused the 30 questions from the [semantic search eval](/semantic-search-in-your-browser/), rephrased as things a reader would actually ask ("How did the blog use Lunr to add search?"), and added 15 questions the blog *doesn't* answer. A few of those are far off ("How do I bake sourdough bread at home?"), but most are near-misses designed to tempt a model: "Which GPU should I buy to run Llama 70B locally?", "How does BM25 ranking improve on TF-IDF?", "How do I fine-tune Kokoro to speak in my own voice?" The blog talks *around* all of these without answering them.

Every model got the same four passages and the same prompt, and Claude Opus 5.5 graded each answer against those passages as **faithful** (every claim is in the passages), **unsupported** (at least one claim isn't, even if it happens to be true) or a **non-answer**. I labelled 20 of those grades myself without seeing the judge's verdict; we agreed on 16 of 20 about whether an answer was faithful[^judge]. Claude also generated the question set, which I reviewed.

{{< svg "quality-vs-size.svg" "Faithful answers out of 30 answerable questions, against download size. Hover a dot for details." >}}

| model | download | faithful | made up an answer the blog doesn't have |
|---|---|---|---|
| SmolLM2-135M | 120 MB | 0/30 | 14/15 |
| LFM2.5-350M | 258 MB | 2/30 | 14/15 |
| SmolLM2-360M | 275 MB | 3/30 | 15/15 |
| Gemma 3 270M | 293 MB | 3/30 | 13/15 |
| Qwen3-0.6B | 579 MB | 15/30 | 5/15 |
| Gemma 4 E2B | 3.1 GB | 28/30 | 0/15 |
| Claude Haiku 5.5 (API) | n/a | 27/30 | 1/15 |

Nothing under 350 MB is usable for this. They aren't slightly worse; they're faithful at most three times out of thirty, and they'll confidently answer almost any question you throw at them. Asked which GPU to buy for Llama 70B, with four passages about embeddings and a coding agent on a MacBook:

> "...the best option to run Llama 70B locally is likely to be a NVIDIA GTX 960 or GTX 970. [...] They also offer high memory bandwidth, making them ideal for handling large amounts of data such as the 6.4 million documents required by Llama 70B." (SmolLM2-360M)

> "...a high-performance graphics card (GPU) such as a NVIDIA A100 series (e.g., RTX 3090, RTX 3080, 3070, 3080, 3070M, 3080M)" (Gemma 3 270M)

> "...popular options include RTX 3090, RTR 5900, or newer generations like TensorRT 60+ for improved compute efficiency." (LFM2.5-350M)

Gemma 4 E2B, for the record: "The provided passages do not contain information about which GPU you should buy to run Llama 70B locally." Which is the entire job.

Even on questions the blog *does* answer, the small models garble things. Here's LFM2.5 on the most basic question about my [Bloom filter post](/bloom-filters-bit-arrays-recommendations-caches-bitcoin/), at 73 tokens per second on my laptop's GPU:

![LFM2.5-350M explaining Bloom filters as a hash table with "true negatives"](/img/2026-10-12-rag-with-a-small-language-model-in-the-browser/lfm-bloom-answer.jpg)

Fast, fluent, and wrong: a Bloom filter isn't a hash table, and the whole point of one is that it *can't* give you false negatives. The passages right underneath say exactly that.

Qwen3-0.6B is the interesting one. At 579 MB it's over the budget I'd set myself, and it's faithful half the time, which is a coin flip. But it's the smallest model that's a coin flip rather than a guaranteed miss, so that's what [ask my blog](/ask/) loads by default. The three smaller models are still on the page, labelled as demonstrators, so you can see for yourself what a 300 MB model does with your question[^webgpu-only].

## Small models loop

The first time I ran the small models, most of their answers weren't wrong so much as stuck. SmolLM2-135M, asked how to add OpenSearch support to a website:

> "1. Custom Search: Search from your URL bar 2. Search from your URL bar 3. Search from your URL bar 4. Search from your URL bar [1] Custom Search: Search from your URL bar..."

Gemma 3 270M answered the GPU question with `I'5555555555555555555555...` until it ran out of tokens. That's what happens when you always pick the single most likely next token and nothing discourages repeating it: tiny models fall into a groove and can't get out. A repetition penalty (1.15, which slightly discourages tokens the model has already seen) fixes the loops. It doesn't fix the faithfulness; the models just write longer, more varied nonsense instead. All the numbers above are with the penalty on.

## The gate catches the obvious ones

The relevance gate seemed like the cheap fix for made-up answers: if search can't find anything relevant, don't ask the model. It works for the far-off questions; "How do I bake sourdough bread?" scores 0.25 against the best passage on the blog, and a threshold of 0.45 stops it (which is good, because Gemma 3's answer was a bread recipe). But the near-misses score 0.54 to 0.63, *higher* than several questions the blog actually answers, because they land on posts about the same topic. To block those, the threshold would have to reject 13 of the 30 real questions too.

So the gate only catches the obviously off-topic questions, and the rest is on the model. That's the real reason size matters here: Gemma 4 and Haiku say "the passages don't cover this", and the small models never do.

## Is it worth renting a GPU, or paying for an API?

The 3.1 GB Gemma 4 E2B matches Claude Haiku on quality, so what would it cost to run it for readers instead of making them download it? The cheapest sensible cloud GPU for it, an NVIDIA L4 on Google Cloud, is about $0.71 an hour[^gpu], or **$516 a month** to keep running. This blog gets a few hundred readers a month. Even if every one of them asked a question, that's around a dollar per question.

Haiku answered all 45 eval questions for **$0.006**. At 500 questions a month it would cost about seven cents.

So: renting a GPU makes no sense at blog scale, paying for an API is practically free *and* as good as the best local model, and running in the browser is free for me but costs you a download and, with today's small models, a lot of accuracy. The honest pitch for the browser version is privacy and the fact that it works at all, not quality.

## Shorter is safer

If two sentences from Qwen3 are only right half the time, would letting it say more help? I ran Qwen3-0.6B and Gemma 4 E2B again, allowing two, four or six sentences.

{{< svg "faithfulness-vs-length.svg" "Faithful answers out of 30 when the model may use 2, 4 or 6 sentences." >}}

Both get *less* faithful with more room, but the small model falls off a cliff: Qwen3 goes from 15 to 9 to 5 faithful answers out of 30. Every extra sentence is another chance to say something the passages don't. At six sentences it stops declining the GPU question altogether and helpfully summarises every passage instead, before concluding that "the answer would depend on whether the user needs a high-performance GPU or a standard one."

Gemma 4 slips too (28, 26, 24), but it barely uses the extra room (about 2.8 sentences when allowed 6) and never makes up an answer to a question the blog doesn't cover. The smaller the model, the shorter the leash; the page stops at two sentences.

## Things I didn't expect

- **The CPU path is 15 times slower.** On WebGPU, Qwen3 generates about 20 tokens a second. Without WebGPU, transformers.js falls back to WebAssembly, which on GitHub Pages runs on a single thread: multi-threaded WebAssembly needs two HTTP headers (COOP and COEP) that GitHub Pages can't send. That's 1.2 tokens a second, or 30 to 60 seconds per answer. The page warns you before you load a model.
- **Two of the small models can't run on the CPU at all.** Gemma 3 270M and LFM2.5's q4f16 builds use a quantized-embedding operation that ONNX Runtime's WebAssembly backend has no implementation for. On a browser without WebGPU, they're greyed out.
- **"Stop" doesn't reach a busy CPU worker.** On WebGPU the worker yields while it waits for the GPU, so a stop message gets through. On single-threaded WebAssembly it never yields, so the stop arrives after the answer is finished. The page now kills the worker and reloads the model from the browser cache instead, which takes a couple of seconds.
- **Small models cite their sources anyway.** Qwen3 likes to write "as described in [1]". I'd planned to strip those, but they're actually useful, so they now link to the matching source card.

## What's next

The obvious next step is making the small models less bad at this one job. A 300 MB model doesn't need to know everything; it needs to read four passages and either summarise them or say they don't answer the question. That sounds like a fine-tuning problem, and a follow-up post.

The other idea is the homepage search box: if you've already loaded a model on [ask my blog](/ask/), the homepage could quietly use it to improve search, without ever downloading anything on its own. In the meantime: [ask my blog something](/ask/), and check the passages before you believe the summary.

[^petitgpt]: It was in turn inspired by [petitgpt](https://github.com/yangqi0/petitgpt). I didn't reuse any MicroLLM lab code (the repository doesn't say what license it's under); the page here is built on transformers.js directly.

[^judge]: Most of the remaining disagreement was about *which kind* of bad an answer was (I'd call rambling nonsense a non-answer; the judge calls it unsupported if it contains a single invented claim). On the faithful-or-not question the judge was stricter than me twice and more lenient twice. The gap between the small models and the rest is far bigger than that noise.

[^webgpu-only]: Two of them only on WebGPU; see the CPU caveats further down.

[^gpu]: A `g2-standard-4` instance (one L4) in us-central1, on demand, via [computeprices.com](https://computeprices.com/providers/google/gpus/l4) on 12 October 2026.
