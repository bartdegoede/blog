---
title: "Semantic search in your browser, for the price of a JPEG"
date: 2026-07-10T10:00:00-07:00
draft: false
slug: "semantic-search-in-your-browser"
categories: ["how-to", "search", "javascript", "machine learning", "ai", "hugo"]
keywords: ["semantic search", "embeddings", "model2vec", "static embeddings", "browser", "wasm", "quantization", "reciprocal rank fusion", "hybrid search", "static site"]
description: "This blog now has semantic search that runs entirely in your browser. No server, no API keys, no 23 MB transformer. The whole model is a 4 MB lookup table, and getting there meant discovering that my keyword search was broken, that my favourite metric couldn't see anything, and that I'd very nearly rigged my own benchmark."
---

{{<audio src="/audio/2026-07-10-semantic-search-in-your-browser.mp3" type="mp3">}}

Eight years ago I [added search to this blog with Lunr.js](/searching-your-hugo-site-with-lunr/). It builds an inverted index at build time, ships it as JSON, and matches strings in your browser. No server. It has worked fine ever since, in the sense that it finds a post if you type a word that is actually in it.

Earlier this year I wrote a [semantic search engine in ±250 lines of Python](/building-a-semantic-search-engine-in-250-lines-of-python/) — the kind that finds the London Beer Flood when you search for "alcoholic beverage disaster in England," because it understands that beer is alcoholic and a flood is a disaster. That one needs a machine with `sentence-transformers` installed and a few hundred megabytes of PyTorch. Not something you run in a browser tab.

So this blog had keyword search that runs anywhere and understands nothing, and I knew how to build semantic search that understands things but runs nowhere near a static site. This post is about closing that gap: **semantic search that runs entirely in your browser, with no server and no API, where the entire model is a 4 MB lookup table.** You can try all three of the models I benchmarked, [further down](#the-benchmark-your-hardware-my-corpus), running live on your own hardware.<!-- more -->

It was going to be a tidy little engineering post. Instead it turned into a catalogue of things I was wrong about: my keyword search was quietly broken, the metric I trusted most couldn't tell any of the models apart, and I came within one decimal place of rigging my own benchmark in my favour. Those are the good parts, so I've left them in.

## The obvious approach costs 23 megabytes

The models that power [the Python post](/building-a-semantic-search-engine-in-250-lines-of-python/) — sentence-transformers like `all-MiniLM-L6-v2` — can, in fact, run in a browser. [Transformers.js](https://github.com/huggingface/transformers.js) will download an ONNX build of one and run it on WebAssembly. I benchmarked it. On my laptop, the quantized model plus its runtime is **23.45 MB** over the wire, takes about two seconds to become ready, and then embeds a query in ~18 ms.

Twenty-three megabytes to embed a search box query. That is roughly a dozen full-resolution photos, downloaded so you can type three words into a text field. It works, and for some applications it is completely worth it, but it is not something I want to inflict on someone who clicked through to read about bloom filters.

The thing is, you do not need a transformer to embed a search query. You need a good enough vector, and there is a much cheaper way to get one.

## The reveal: a static embedding model is a lookup table

The trick is a family of models called [model2vec](https://github.com/MinishLab/model2vec) (the specific ones are named "potion"). They are distilled from a real sentence-transformer, but the result is not a neural network. It is a table.

Here is the model's entire forward pass. Not a simplification — the whole thing, from the library's source:

```python
ids = tokenize(text)          # split into subword token ids
rows = embedding[ids]         # look up one vector per token
vector = rows.mean(axis=0)    # average them
vector = vector / norm(vector)  # normalise to unit length
```

That is it. Tokenise, look up a row per token, average, normalise. There is no attention, no layers, no inference. "Running the model" is a handful of array lookups and an average. For `potion-base-8M`, the table is 29,528 tokens by 256 dimensions of float32 — about 30 MB — and it reaches [81% of MiniLM's retrieval quality](https://huggingface.co/minishlab/potion-retrieval-32M) while being, definitionally, a dictionary lookup.

Thirty megabytes is still too much, but a table is a much friendlier thing to shrink than a transformer, and that is where most of the interesting work turned out to be.

## Building the index: chunking, and a cache that never earns its keep

Embeddings happen at build time. On my laptop, whenever I run `hugo`, a Python script walks the posts, strips out the front matter and the code blocks, splits each post into overlapping ~600-character chunks, embeds every chunk, and writes the vectors to a file the browser downloads.

The chunking matters more than I expected, because of that averaging step. A static embedding is the *mean* of its token vectors, and if you average an entire 15,000-character post into one vector, you get something that points at "generic English prose about software" and not much else. The rare, distinctive words — the `pydub`, the `mmh3` — get drowned out by the thousands of ordinary words around them. Chopping the post into small chunks keeps those signals sharp. I'll come back to this, because it turns out to be the key to why some models beat others.

I also built an embedding cache, keyed on a hash of each chunk's text, so that re-embedding only touches chunks that changed. This was a waste of time, and I want to be honest about that. Embedding every chunk of this blog is a few hundred lookups and an average; it takes about ten milliseconds. I built a cache to speed up an operation that is already instantaneous. It would matter for the MiniLM model, where embedding is a real neural network forward pass — but I'm not shipping that one. So the cache sits there, correct and pointless, and I've left it in as a small monument to solving the wrong problem.

## Shrinking the table: the model's stopword list is hiding in plain sight

The table is 30 MB because it is float32. Quantise it to int8 and it is a quarter of the size. The catch is that you cannot just clip everything to the same scale, and understanding *why* was my favourite thing I learned building this.

Look at what the row magnitudes actually are. If you sort every token in `potion-base-8M` by the length of its vector, the shortest vectors — the ones closest to zero — are:

```
a  .  ,  -  )  the  to  and  of  in
```

And the longest are:

```
turkmenistan  seychelles  guantanamo  hemingway  vanuatu
```

This is not a coincidence and it is not noise. **The model's stopword list is its row magnitudes.** When you average token vectors together, a word with a tiny vector barely moves the result, and a word with a big vector dominates it. The model has learned, with no stopword list and no special-casing, that "the" should contribute almost nothing and "guantanamo" should contribute a lot. It's beautiful, and it's sitting right there in the geometry.

Which is why quantisation needs a *per-row* scale: each token gets its own float32 multiplier, so that the relative magnitudes survive being crushed into int8. I duly implemented that, wrote a stern comment about how a single global scale would "flatten the weighting into mush," and felt good about it.

Then I measured it, and the comment was wrong. I quantised the real table with a single global scale — the mush option — and checked how much it actually degraded the query vectors. The answer was: almost nothing. Aggregate cosine similarity against the original stayed at 0.9998. A global scale zeroes out exactly two rows in the entire 29,528-token vocabulary — `.` and `a` — which are precisely the two tokens the model had already decided contribute nothing. The mechanism I'd described is real; the *consequence* I'd asserted was imaginary.

So I kept the per-row scales anyway, because they cost 118 KB out of 4 MB and they're clearly correct, but I demoted them in my head from "load-bearing" to "cheap insurance." The whole int8 table, per-row scales and all, reproduces the original float32 model to a cosine of **0.999958**. That's the number that lets the browser ship a lookup table instead of a model.

## WordPiece in eighty lines, and its three traps

The browser has the token table, but it still has to turn your typed query into token ids the same way Python did — otherwise it's looking up the wrong rows. That means reimplementing the BERT WordPiece tokenizer in JavaScript, from scratch, with no dependencies. It's about eighty lines, and it has three traps that will each silently poison every query vector if you get them wrong. I'll save you the debugging:

1. **No `[CLS]`/`[SEP]`.** BERT tokenizers normally wrap your text in special marker tokens. The `tokenizer.json` config even has a section describing how. model2vec doesn't use it — it calls the tokenizer with `add_special_tokens=False`, and that config section is a decoy. Add the markers and you're averaging in two vectors that shouldn't be there.

2. **Unknown tokens are *deleted*, not embedded.** If a word isn't in the vocabulary, model2vec drops it from the sequence entirely rather than substituting an `[UNK]` vector. So a query made entirely of gibberish produces an empty token list and a zero vector, and you have to handle that instead of dividing by zero. (In practice this is nearly unreachable — with a 29,528-token vocabulary, every single character is in the vocabulary, so the only way to trigger it is a word longer than 100 characters.)

3. **`"strip_accents": null` means accents *are* stripped.** This one is genuinely nasty. The config says `strip_accents` is null, which reads like "off." But in HuggingFace's tokenizer library, a null value inherits from the `lowercase` setting, which is on. So `café` becomes `cafe`. If your JavaScript reads the config literally, every accented query drifts.

I found these by reading the library's source, and then I made very sure the JavaScript was right by comparing its output against Python's real tokenizer on thirty-six test strings — `pydub`, `café naïve`, `C++ vs C#`, `日本語のみ` — until they matched exactly. That comparison is a committed test, because a tokenizer that's subtly wrong doesn't throw an error; it just quietly returns worse search results forever.

## Search is a few hundred dot products

With the query embedded, search is almost anticlimactic. There are a few hundred chunk vectors — one per chunk of every post. Computing the cosine similarity against all of them is a few hundred dot products of 128 numbers each, tens of thousands of multiply-adds, which a browser does in a fraction of a millisecond. Then I group the chunks by post, take each post's best-scoring chunk, and sort. On my machine the entire query — tokenise, embed, score every chunk, rank — takes about **0.4 milliseconds**.

People reach for approximate-nearest-neighbour indexes (HNSW and friends) for this step, and if you have a million documents you should. With a few hundred, an ANN index would be slower than the brute-force loop and much larger on disk. It's worth saying out loud because "vector search" has become synonymous with "vector database," and at this scale the vector database is a `for` loop.

There's one wrinkle worth knowing if you build one of these. The document vectors are stored as int8. Cosine similarity is invariant to a positive scale, and the document matrix uses one global scale, so the browser can dot a float32 query straight against the raw int8 bytes and get the right ranking without ever un-quantising them. But `int8 × int8` in JavaScript overflows silently — a dot product whose true value is three million comes back as `-64`, no error, no warning. So you accumulate into a regular float. I mention it because it cost me an afternoon.

## Two engines that are each blind in a different way

Here is where the post stopped being tidy.

Before adding semantic search, I did the responsible thing and measured how bad the existing keyword search actually was, so I'd have a baseline to beat. I built a set of thirty test queries — I'll be upfront that these were drafted by Claude and reviewed by me, with the conceptual ones written only from each post's title and description so they wouldn't accidentally quote the post's own vocabulary — and split them into three kinds:

- **Exact tokens**: `pydub`, `lunr`, `mmh3`, `papermod`. Words that literally appear in a post.
- **Paraphrases**: "find documents by what they mean instead of which words they contain." Concepts, in different words than the post uses.
- **Navigational**: "how do I add search to a static site." Broad intent.

Keyword search, I confidently predicted, would ace the exact tokens and fail the paraphrases. Then I ran it, and it failed `pydub`.

`pydub` is a Python library I've written about. The word is right there in the text-to-speech post. And Fuse.js, the fuzzy-search library this blog uses, returned nothing. It turned out my configuration told Fuse to only score matches near the *start* of a field — a setting called `location`, with a `distance` window of 1000 characters. `pydub` first appears about 3,700 characters into that post, well outside the window, so as far as my search box was concerned it did not exist. The same was true for `mmh3`, and for any distinctive word that happened to appear deep in a long post. The words that *did* work only worked because they were in a title.

My keyword search had been quietly broken for years, and I only found out because I was about to benchmark against it. If I'd shipped the comparison as-is, the headline would have been "semantic search dramatically beats keyword search," which would have been true and completely dishonest — I'd have been beating a version of keyword search that couldn't find words that were in the posts. So I fixed it (a two-line change: search the whole field, tighten the fuzziness threshold), and only *then* measured. The fixed baseline is genuinely strong on exact tokens.

And the two engines turn out to be blind in exactly complementary ways:

| | keyword finds it | semantic finds it |
|---|---|---|
| `pydub` (exact token, out of vocabulary) | ✅ | ❌ |
| "find documents by what they mean" (paraphrase) | ❌ | ✅ |

Keyword search is perfect on the exact tokens and returns *literally nothing* for all ten paraphrases — not bad results, zero results. Semantic search is the mirror image: it nails the paraphrases and stumbles on the proper nouns, because `pydub` isn't in its vocabulary and gets shattered into meaningless subword fragments. Neither is better. They fail on disjoint sets.

## Reciprocal Rank Fusion, or: how to add two numbers that aren't comparable

If each engine catches what the other misses, you want both. The problem is combining them. Keyword search returns a fuzzy-match *distance*; vector search returns a *cosine similarity*. These live on different scales that mean different things, and averaging them is meaningless — you'd be adding a temperature to a weight.

The clean answer is [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormack/cormacksigir09-rrf.pdf). Throw away the scores entirely and keep only the *ranks*. Each document's fused score is the sum, over both engines, of `1 / (k + rank)`, with `k` conventionally 60. A document ranked first by one engine and unranked by the other scores `1/61`. A document ranked third by *both* scores `1/63 + 1/63`, which is larger. The `k` flattens the top of the curve so that "both engines quite liked this" beats "one engine loved it" — which is exactly what you want when one engine is blind to paraphrase and the other to proper nouns. It's about ten lines of code, it has a single parameter with a sensible default, and it never has to compare the two incomparable scores. When you search this blog now, that's what runs: keyword and semantic, fused by rank.

## The benchmark: your hardware, my corpus

I benchmarked three query encoders: the model2vec lookup table I've been describing, MiniLM q8 through transformers.js, and [ternlight](https://github.com/soycaporal/ternlight), a clever BitNet-style ternary model compiled to WebAssembly that originally sent me down this whole path.

The widget below runs all three **in your browser, right now, on your hardware**. Each has its own Run button because one of them downloads 23 MB and you should get to decide whether to pay that. The download sizes are constants I measured (your browser can't see the size of a cross-origin download that doesn't send the right header — a small honesty tax); the timings are live on your device.

{{< benchmark >}}

On my laptop the story is stark: the lookup table is **4.2 MB and embeds a query in a third of a millisecond**; MiniLM is **23.5 MB and 18 milliseconds**; ternlight sits in between. And in retrieval quality, measured over those thirty labelled queries, the lookup table scores as well as MiniLM. As *well*. At a fifth of the size and roughly fifty times the speed.

I want to be careful with that claim, though, because thirty queries is a small sample and I nearly fooled myself with it. Twice.

## The metric couldn't see anything

My headline metric was recall@3: did a relevant post make the top three? On a thirteen-post corpus, "top three of thirteen" is a low bar — random guessing clears it about a quarter of the time — and it turned out that almost every model cleared it on almost every query. Five different configurations tied at exactly 0.978. Recall@3 could not tell a 4 MB lookup table apart from a 23 MB transformer.

Worse, it produced confident nonsense. Pure semantic search scored a *perfect* 1.000 on the exact-token queries — it apparently found `pydub` every time. Except it didn't:

```
pydub  →  1. Free SSL on GitHub Pages       (wrong)
          2. Let's Encrypt on GitHub Pages   (wrong)
          3. Text-to-Speech with pydub       (correct)
```

The right post is third, behind two completely unrelated ones, and recall@3 scored that as a hit. The metric was rewarding the model for landing the right answer in a bucket wide enough that landing it there meant almost nothing. Switching to recall@**1** — was the very first result right? — separated the models cleanly and told a completely different, and true, story. The lesson I took: a pre-registered metric is worthless if the metric can't see the thing you care about. I only caught it because the results looked *too* good.

## I almost rigged my own benchmark

The second near-miss was worse, because it would have flattered the exact conclusion I was hoping for.

When I fixed the broken keyword search, I had to pick a fuzziness threshold. I picked one that made `pydub` work, committed it, and moved on. Later, idly, I tried loosening it, and watched the keyword baseline's score on *paraphrase* queries leap from 0.000 to 0.800. Loosen the string matcher enough and it appears to answer conceptual questions nearly as well as embeddings do — which, if true, would mean this entire project was pointless.

It's a mirage. At that loose threshold the keyword engine returns ten of the thirteen posts for a paraphrase query, with scores spanning a range of 0.001, and the "correct" one wins by four ten-thousandths of noise. High recall, zero precision. It's not answering the question; it's returning most of the blog and getting lucky about the order.

But here's the uncomfortable part. My benchmark had a pre-registered rule for choosing which *semantic* model wins — decided before I saw any numbers, exactly so I couldn't fudge it. And that rule did nothing to stop me from tuning the *loser* afterwards. A threshold that made the baseline artificially weak would have made my model look artificially good, entirely within the rules. The fix was to pin the keyword threshold to the value the site actually ships — not the value that makes my model look best — and to add a precision metric so that "returns most of the corpus" can never again masquerade as "answers the question." A commitment device that only binds the outcome you were already going to report honestly isn't much of a commitment device.

## Things I was wrong about, a summary

Since being wrong was the theme, here's the tally, because the wrong predictions were more interesting than the right ones:

- **A global quantisation scale would ruin the model.** It doesn't; it degrades exactly the two tokens that already didn't matter.
- **Averaging a whole post into one vector would just fail.** It doesn't fail — it does *fine* on paraphrase queries, sometimes better than chunking, because the average is a clean summary of the topic. What it destroys is the rare tokens: `pydub`, mentioned four times in 15,000 characters, vanishes into the average. Chunking preserves rare words, not topic. That's a sharper and more useful statement than "chunking is better."
- **Ternlight's 128-token limit was hurting it.** Ternlight only reads the first ~128 tokens of a chunk, and I assumed that truncation was a handicap. So I re-ran it at a chunk size small enough that it sees everything. Its score didn't move at all. It turns out chunk size helps the *lookup table* — because a shorter average is a sharper average — but barely touches a model with actual transformer layers, which isn't averaging in the first place. I had the right observation and the wrong mechanism.

Every one of those I found by measuring something I thought I already knew.

## What shipped, and how to steal it

The search box on [the homepage](/) now runs keyword, semantic, and hybrid search, with a toggle so you can watch them disagree. Type `pydub` and flip to semantic mode to see it get the answer wrong; flip to hybrid to see it get it right again. The whole thing is a 4 MB lookup table, a tiny document index, and about 300 lines of dependency-free JavaScript, lazy-loaded only when you focus the search box so the page itself pays nothing.

The build pipeline — the chunking, the quantisation, the eval harness, all of it — is a Python package you can point at your own site:

```bash
pip install static-site-search-eval
sss-eval build --corpus content/post --outdir static/search \
  --model minishlab/potion-base-8M --dims 128 --chunk-size 600
```

The [code is on GitHub](https://github.com/bartdegoede/static-site-search-eval), the thirty eval queries are in there too so you can disagree with my labels, and everything in this post — every millisecond, every megabyte, every cosine — was measured, mostly while discovering it wasn't what I'd assumed. If you run the benchmark above on a phone over cellular, you'll feel the 23 MB in your bones, and understand why the lookup table was worth the trouble.
