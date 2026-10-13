---
title: "Running RAG with a (small) language model in the browser"
date: 2026-10-12T22:57:56-04:00
draft: false
slug: "rag-with-a-small-language-model-in-the-browser"
categories: ["machine learning", "ai", "search", "javascript", "hugo"]
keywords: ["rag", "retrieval augmented generation", "small language models", "transformers.js", "webgpu", "wasm", "qwen3", "gemma", "llm evaluation", "static site", "browser"]
description: "My blog does semantic search in your browser. Now it also runs a (small) language model in your browser."
cover:
    image: "/img/2026-10-12-rag-with-a-small-language-model-in-the-browser/cover.jpg"
    alt: "Pencil sketch of a laptop running ask my blog, a mug reading two sentences max, and sticky notes: retrieve, summarize, check the sources"
related:
  - semantic-search-in-your-browser
  - building-a-semantic-search-engine-in-250-lines-of-python
---

{{<audio src="/audio/2026-10-12-rag-with-a-small-language-model-in-the-browser.mp3" type="mp3">}}

A few weeks ago [MicroLLM lab](https://stateofutopia.com/experiments/microllmlab/) was featured in [Hacker Newsletter](https://buttondown.com/hacker-newsletter/archive/812/). It shows off how you can run small language models (25 to 360 million parameters) in a browser on the users' own GPU (or CPU)[^petitgpt]. No server, no API key, no account. Pretty nifty, so it got me thinking about the steps after [semantic search I added to this blog](/semantic-search-in-your-browser/): that already provides the "R" in RAG[^RAG] for a question, and it does that entirely in the browser, from a 4 MB lookup table. What if a tiny model, also in the browser, read those passages and answered the question?

So I built that: ["ask my blog"](/ask/)[^naming]. Search finds the four most relevant passages, and a small language model running in your browser summarises them in two sentences. Nothing you type leaves your machine. And because "a small model summarizes things" is exactly the sort of sentence that hides a lot of made-up nonsense, I measured how often it's actually faithful to what I wrote. Turns out small models have some limitations.<!-- more -->

{{< video name="ask-webgpu" caption="Ask my blog on WebGPU: Qwen3-0.6B (already cached) answers, then switching to SmolLM2-360M downloads it." >}}

## How it works

The page is retrieval-augmented generation (RAG) with every piece running client-side:

1. **Retrieve.** Your question goes through the same static-embedding search as the homepage, but instead of rolling results up to posts, it keeps the four best-scoring *passages*.
2. **Gate.** If the best passage scores below a threshold, the model isn't called at all and the page says it couldn't find this on the blog. The idea is to not bother if a user asks something there's no data for. More on why that only half works below.
3. **Prompt.** The passages, numbered, plus a system prompt: answer in at most two sentences, use only these passages, say so if they don't answer the question.
4. **Generate.** A Web Worker runs the model with [transformers.js](https://huggingface.co/docs/transformers.js) on WebGPU, or on the CPU via WebAssembly if your browser doesn't have WebGPU, and streams the answer into the page. It stops as soon as it has two complete sentences.

The passages are shown first, as cards, and the summary will sit above them. You can search without loading a model at all; you just get the passages. Loading one is an explicit click, because it means downloading a few hundred megabytes from Hugging Face (once; your browser caches it). There's also a button to clear the cache/

![The download indicator: one square per 4 MB of model](/img/2026-10-12-rag-with-a-small-language-model-in-the-browser/download-blocks.jpg)

## Which model?

I wanted something that would be a reasonable click for a reader: a few hundred megabytes, not gigabytes (what if someone reads this on the bus). The candidates that have browser-ready (ONNX) builds were SmolLM2 ([135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) and [360M](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct) parameters), [Gemma 3 270M](https://huggingface.co/onnx-community/gemma-3-270m-it-ONNX), [LFM2.5-350M](https://huggingface.co/onnx-community/LFM2.5-350M-ONNX), [Qwen2.5-0.5B](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct) and [Qwen3-0.6B](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX). For comparison I added two references that would never ship on the page: [Gemma 4 E2B](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX), the smallest of Google's new Gemma 4 models at a 3.1 GB download, and [Claude Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5) through the API, the "just pay someone" option.

One surprise before anything ran: for several of these models the "4-bit" (q4) build is *bigger* than the 4-bit-with-16-bit-floats (q4f16) one, because the q4 export keeps the embedding table in full 32-bit precision. SmolLM2-360M is 390 MB as q4 and 275 MB as q4f16, with identical output. Everything below uses q4f16.

## The eval

I reused the 30 questions from the [eval I did for the semantic search post](/semantic-search-in-your-browser/), rephrased as actual questions ("How did the blog use Lunr to add search?"), and added 15 questions this blog definitely *doesn't* answer. A few of those are far off ("How do I bake sourdough bread at home?"), but most are near-misses designed to tempt a model into predicting plausible-sounding-but-wrong-tokens: "Which GPU should I buy to run Llama 70B locally?", "How does BM25 ranking improve on TF-IDF?", "How do I fine-tune Kokoro to speak in my own voice?" The blog talks *about* these, or similar things, but doesn't have and answer for those.

Every model got the same four passages and the same prompt, and Opus 5.5 graded each answer against those passages as **faithful** (every claim is in the passages), **unsupported** (at least one claim isn't, even if it happens to be true) or a **non-answer**. I labelled 20 of those grades myself without seeing the judge's verdict; we agreed on 16 of 20 about whether an answer was faithful[^judge]. Claude also generated the question set, which I reviewed.

{{< svg "quality-vs-size.svg" "Faithful answers out of 30 answerable questions, against download size. Hover a dot for details." >}}

{{< eval-table >}}

Turns out nothing off the shelf under 350 MB is usable for this. They aren't slightly worse; they're faithful **at most three times out of thirty**, and they'll happily answer almost any question you throw at them. Asked which GPU to buy for Llama 70B, with four passages about embeddings and a coding agent on a MacBook:

> "...the best option to run Llama 70B locally is likely to be a NVIDIA GTX 960 or GTX 970. [...] They also offer high memory bandwidth, making them ideal for handling large amounts of data such as the 6.4 million documents required by Llama 70B." (SmolLM2-360M)

> "...a high-performance graphics card (GPU) such as a NVIDIA A100 series (e.g., RTX 3090, RTX 3080, 3070, 3080, 3070M, 3080M)" (Gemma 3 270M)

> "...popular options include RTX 3090, RTR 5900, or newer generations like TensorRT 60+ for improved compute efficiency." (LFM2.5-350M)

Gemma 4 E2B, for the record, correctly decided that "The provided passages do not contain information about which GPU you should buy to run Llama 70B locally." Good job Google.

Even on questions the blog *does* answer, the small models are prone to garble things. Here's LFM2.5 on the most basic question about my [Bloom filter post](/bloom-filters-bit-arrays-recommendations-caches-bitcoin/), at 73 tokens per second on my laptop's GPU:

![LFM2.5-350M explaining Bloom filters as a hash table with "true negatives"](/img/2026-10-12-rag-with-a-small-language-model-in-the-browser/lfm-bloom-answer.jpg)

Fast, fluent, and wrong. A Bloom filter isn't a hash table: it's a bit array, and an element counts as "probably in the set" only if every one of its *k* hash functions lands on a bit that's set. The last clause is actually correct (a missing bit means the element was never added, which is why Bloom filters can't give false negatives), but the rest is made up. To be fair to the model, search didn't hand it the section that explains how Bloom filters work; the four passages it got were about use cases and the interactive demo. A summary can only be as good as the passages it reads. Seems like there's some work to do on the relevance scoring in my little search engine that could.

Qwen3-0.6B is the interesting one. At 579 MB it's pretty thicc, and over the budget I'd set myself. It's faithful half the time, which is basically a coin flip. However, it's the smallest model that's a coin flip rather than a pretty much guaranteed miss, so that's what ["ask my blog"](/ask/) loads by default. You can also choose three smaller models so you can see for yourself what a non-finetuned 300 MB model does with your question[^webgpu-only].

## Small models loop

The first time I ran the small models, most of their answers weren't wrong so much as stuck. SmolLM2-135M, asked how to add OpenSearch support to a website:

> "1. Custom Search: Search from your URL bar 2. Search from your URL bar 3. Search from your URL bar 4. Search from your URL bar [1] Custom Search: Search from your URL bar..."

Gemma 3 270M answered the GPU question with `I'5555555555555555555555...` until it ran out of tokens. That's what happens when you always pick the single most likely next token and nothing discourages repeating it: tiny models fall into a groove and can't get out (I saw it happen pretty often when I was playing around with MicroLLMLab too). The easy fix is a repetition penalty (1.15 in this case, which slightly discourages tokens the model has already seen). It doesn't fix the faithfulness or quality; the models just write longer, more varied nonsense instead. All the numbers above are with the penalty set to 1.15.

## A relevance gate to catch the obvious ones

A relevance gate seemed like the cheap fix for made-up answers: if search can't find anything relevant, don't ask the model. It works for the far-off questions; "How do I bake sourdough bread?" scores 0.25 against the best passage on the blog, and a threshold of 0.45 stops it (which is good, because Gemma 3's answer was a bread recipe). But the near-misses score 0.54 to 0.63, *higher* than several questions the blog actually answers, because they land on posts about the same topic. To block those, the threshold would have to reject 13 of the 30 real questions too.

So the gate only catches the obviously off-topic questions, and the rest is on the model. That's the real reason size matters here: Gemma 4 and Haiku say "the passages don't cover this", and the small models never do.

## Is it worth renting a GPU, or paying for an API?

Usually, yes. At current pricing (yay competition) it's almost never worth it, unless you have strong reasons not to (ie compliance, privacy, air gapped deployments, etc). As a thought exercise tho: the 3.1 GB Gemma 4 E2B matches Haiku on quality, so what would it cost to run it for readers instead of making them download it? The cheapest sensible cloud GPU for it, an NVIDIA L4 on Google Cloud, is about $0.71 an hour[^gpu], or **$516 a month** to keep running. For the amount of readers this blog sees in a month, assuming each and everyone asks a question, that would be over a dollar per question.

Haiku on the other hand answered all 45 eval questions for **$0.006**. At 500 questions a month (a guy can dream) it would cost about seven cents. In other words, if you have a real use case, start with Haiku[^chipotlai].

## Shorter is safer

If two sentences from Qwen3 are only right half the time, would letting it say more help? I ran a quick experiment with Qwen3-0.6B and Gemma 4 E2B, allowing for two, four or six sentences.

{{< svg "faithfulness-vs-length.svg" "Faithful answers out of 30 when the model may use 2, 4 or 6 sentences." >}}

Both get *less* faithful with more room, but the smaller model falls off a cliff: Qwen3 goes from 15 to 9 to 5 faithful answers out of 30. Every extra sentence is another chance to hallucinate. At six sentences it stops declining the GPU question altogether and helpfully summarises every passage instead, before concluding that "the answer would depend on whether the user needs a high-performance GPU or a standard one."

Gemma 4 slips too (28, 26, 24), but it barely uses the extra room (about 2.8 sentences when allowed 6) and never makes up an answer to a question the blog doesn't cover. Shoutout to Gemma 4 btw, this model family is pretty awesome. This is a great option for finetuning.

## What's next

The next step would be making the small models less bad at this one job. A 300 MB model doesn't need to know everything; it needs to read four passages and either summarise them or say they don't answer the question. That sounds like a fine-tuning problem, and maybe a follow-up post.

The other idea is the homepage search box: if you've already loaded a model on ["ask my blog"](/ask/), the homepage could quietly use it to improve search, without ever downloading anything on its own. In the meantime: [ask my blog something](/ask/), and check the passages before you believe the summary.

[^petitgpt]: It was in turn inspired by [petitgpt](https://github.com/yangqi0/petitgpt). I didn't reuse any MicroLLM lab code (the repository doesn't say what license it's under); the page here is built on transformers.js directly.

[^RAG]: [Retrieval-augmented generation](https://en.wikipedia.org/wiki/Retrieval-augmented_generation). The TLDR is that you use a search tool or engine to find the appropriate context for a LLM to do its inference. It's like how Claude Code greps through your code, or when ChatGPT searches the web. Is this overkill for the couple of posts I have? Absolutely. Fun tho.

[^naming]: Naming things is the hardest thing in computer science amirite.

[^judge]: Most of the remaining disagreement was about *which kind* of bad an answer was (I'd call rambling nonsense a non-answer; the judge calls it unsupported if it contains a single invented claim). On the faithful-or-not question the judge was stricter than I was twice, and more lenient twice. The gap between the small models and the rest is far bigger than that noise.

[^webgpu-only]: Two of them only on WebGPU; see the CPU caveats further down.

[^gpu]: A `g2-standard-4` instance (one L4) in us-central1, on demand, via [computeprices.com](https://computeprices.com/providers/google/gpus/l4) on 12 October 2026.

[^chipotlai]: Don't be like Chipotle tho and [let just anyone](https://github.com/cyberpapiii/chipotlai-max) rack up your inference bill; more so, if you have a static site, please, don't put your Anthropic/OpenAI API key in there.
