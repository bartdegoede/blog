---
title: "Client-side semantic search for your static site"
date: 2026-07-10T10:00:00-07:00
draft: false
slug: "semantic-search-in-your-browser"
categories: ["how-to", "search", "javascript", "machine learning", "ai", "hugo"]
keywords: ["semantic search", "embeddings", "hybrid search", "model2vec", "static embeddings", "browser", "wasm", "quantization", "reciprocal rank fusion", "hybrid search", "static site"]
description: "This blog now has semantic search that runs entirely in your browser. No server, no API keys, no 23 MB transformer. The whole model is a 4 MB lookup table, and extends the existing keyword search with semantic capabilities."
cover:
    image: "/img/2026-07-10-semantic-search-in-your-browser/cover.png"
related:
  - building-a-semantic-search-engine-in-250-lines-of-python
  - building-a-full-text-search-engine-150-lines-of-code
  - searching-your-hugo-site-with-lunr
---

{{<audio src="/audio/2026-07-10-semantic-search-in-your-browser.mp3" type="mp3">}}

Eight years ago I [added client-side search to this blog with Lunr.js](/searching-your-hugo-site-with-lunr/). It creates an inverted index at build time, ships it as JSON, and matches strings in your browser. No server-side engine required. It has worked fine ever since, in the sense that it finds a post if you type a word that is actually in it.

Earlier this year I wrote a [semantic search engine in ±250 lines of Python](/building-a-semantic-search-engine-in-250-lines-of-python/) (the kind that lets you find the "London Beer Flood" when you search for "alcoholic beverage disaster in England," because it understands that beer is alcoholic and a flood is a disaster). That one needs a machine with `sentence-transformers` installed and a few hundred megabytes of PyTorch; to serve something like that in a production server requires beefy machines with expensive RAM. Not something you run in a browser tab.

So this blog had keyword search that runs anywhere and understands nothing, but no semantic search that understands things but can't run anywhere near a static site. This post is about closing that gap: **semantic search that runs entirely in your browser, with no server and no API, where the entire model is essentially a 4 MB lookup table.** You can try all three of the models I benchmarked, [further down](#the-benchmark-your-hardware-my-corpus), running live on your own hardware (I can't afford GPU clusters).<!-- more -->

Doing this surfaced a couple things, chief among which that the keyword search had a bug for a couple of years. TUrns out that doing proper evals is important.

## The obvious approach costs 23 megabytes

The models that power [the Python post](/building-a-semantic-search-engine-in-250-lines-of-python/) (sentence-transformers like `all-MiniLM-L6-v2`) can, in fact, run in a browser. [Transformers.js](https://github.com/huggingface/transformers.js) will download an ONNX build of one and run it on WebAssembly. I benchmarked it, and on my laptop, the quantized model plus its runtime is **23.45 MB** over the wire, takes about two seconds to load and become available, and then embeds a query in ±18 ms.

Twenty-three megabytes is a bit rich to embed a search box query, for a blog that has 14 posts. That is roughly a dozen high-resolution photos worth of bytes to download so we can have fancy search. It works, and for some applications it is completely worth it, but it is not something I want to inflict on someone who clicked through to read about bloom filters, especially not on a mobile connection.

The thing is, you do not need a transformer to embed a search query. You need a vector that's good enough, and there is a much cheaper way to get one.

## A static embedding model is a lookup table

The trick is a family of models called [model2vec](https://github.com/MinishLab/model2vec) (the specific ones are named "potion"). They are distilled from a real sentence-transformer, but the result is not a neural network. It is a table.

Here is the model's entire forward pass. Not a simplification — the whole thing, from the library's source:

```python
ids = tokenize(text)          # split into subword token ids
rows = embedding[ids]         # look up one vector per token
vector = rows.mean(axis=0)    # average them
vector = vector / norm(vector)  # normalise to unit length
```

That is it. Tokenize, look up a row per token, average, normalize. There is no attention, no layers, no inference. "Running the model" is a handful of array lookups and an average. For `potion-base-8M`, the table is 29,528 tokens by 256 dimensions of float32 (about 30 MB) and it reaches [81% of MiniLM's retrieval quality](https://huggingface.co/minishlab/potion-retrieval-32M) while being, definitionally, a dictionary lookup.

Thirty megabytes is still too much, but a table is a much friendlier thing to shrink than a transformer.

## Building the index: chunking, and a cache that never earns its keep

Embeddings are generated at build time. On my laptop, whenever I run `hugo`, [a Python script](https://github.com/bartdegoede/blog/blob/main/scripts/build_search_index.py) walks through the posts, strips out the front matter and the code blocks, splits each post into overlapping 600-character-ish chunks, embeds every chunk, and writes the vectors to a file the browser downloads when a user clicks the search input box.

The chunking matters more than I expected, because of that averaging step. A static embedding is the *mean* of its token vectors, and if you average an entire 15,000-character post into one vector, you get something that points at "generic English prose about software" and not much else. The rare, distinctive words (terms like `pydub` or `mmh3`) get drowned out by the hundreds of ordinary words around them. Chopping the post into smaller chunks helps keep those signals sharp. I'll come back to this, because it turns out to be the key to why some models beat others.

I also built an embedding cache, keyed on a hash of each chunk's text, so that re-embedding only touches chunks that changed. This turned out to be a waste of time and tokens. Embedding every chunk of this blog is a few hundred lookups and an average; it takes about ten milliseconds. I built a cache to speed up an operation that is already pretty instantaneous (turns out 14 blog posts is not a lot of data). It would matter more for the MiniLM model, where embedding is a real neural network forward pass, but I'm not shipping that one. So the cache sits there, correct and pointless, and I've left it in as a reminder that overengineering is easy.

## Shrinking the table: the model's stopword list is hiding in plain sight

The table is 30 MB because it is float32. Quantizing it to int8 makes it a quarter of the size. The catch is that you cannot just clip everything to the same scale, and understanding *why* was one of my favorite things I learned building this.

Look at what the row magnitudes actually are. If you sort every token in `potion-base-8M` by the length of its vector, the shortest vectors (i.e. the ones closest to zero) are:

```
a  .  ,  -  )  the  to  and  of  in
```

And the longest are:

```
turkmenistan  seychelles  guantanamo  hemingway  vanuatu
```

This is not a coincidence and it isn't noise either. **The model's stopword list is its row magnitudes.** When you average token vectors together, a word with a tiny vector barely moves the result, and a word with a big vector dominates it. The model has learned, with no stopword list and no special-casing, that a word like "the" should contribute almost nothing and a word like "guantanamo" should contribute a lot. It's kinda beautiful, and it's sitting right there in the geometry.

Which is why quantization needs a *per row* scale: each token gets its own float32 multiplier, so that the relative magnitudes survive being crushed into int8. However, turns out that it didn't matter much anyway.

I measured it; I quantized the real table with a single global scale and checked how much it actually degraded the query vectors. The answer was: almost nothing. Aggregate cosine similarity against the original stayed at 0.9998. A global scale zeroes out exactly two rows in the entire 29,528-token vocabulary (`.` and `a`) which are precisely the two tokens the model had already decided contribute pretty much nothing. The mechanism is real; it just doesn't matter for this particular model.

I kept the per-row scales anyway, because they cost 118 KB out of 4 MB and they're correct, but more like "cheap insurance" than "load-bearing". The whole int8 table, per-row scales and all, reproduces the original float32 model to a cosine of **0.999958**. Good enough to ship a lookup table in the browser rather than a model.

## WordPiece in eighty lines, and its three gotchas

The browser has the token table, but it still has to turn your typed query into token ids the same way we did in Python, so we can look up the right rows. That means reimplementing the BERT WordPiece tokenizer in JavaScript. It's about eighty lines, and it has three gotchas that could each silently poison query vector:

1. **No `[CLS]`/`[SEP]`.** BERT tokenizers normally wrap your text in special marker tokens. The `tokenizer.json` config even has a section describing how. `model2vec` doesn't use it, but calls the tokenizer with `add_special_tokens=False` instead. Add the markers and you're averaging in two vectors that shouldn't be there.

2. **Unknown tokens are *deleted*, not embedded.** If a word isn't in the vocabulary, `model2vec` drops it from the sequence entirely rather than substituting an `[UNK]` vector. So a query made entirely of gibberish produces an empty token list and a zero vector, and you have to handle that instead of dividing by zero. (In practice this is nearly unreachable; with a 29,528-token vocabulary, every single character is in the vocabulary, so the only way to trigger it is a word longer than 100 characters.)

3. **`"strip_accents": null` means accents *are* stripped.** This one is a little nasty. The config says `strip_accents` is null, which reads like "off." But in HuggingFace's tokenizer library, a null value inherits from the `lowercase` setting, which is on. So `café` becomes `cafe`. If we'd copy the config literally, every accented query drifts.

Some frustrations and a bunch of Claude generated test strings ( `pydub`, `café naïve`, `C++ vs C#`, `日本語のみ`) later, I'm reasonably confident the [JS tokenizer](https://github.com/bartdegoede/blog/blob/main/assets/js/semantic/tokenizer.js) matches the BERT WordPiece tokenizer.

## Search is a few hundred dot products

With the query embedded, search is almost anticlimactic. There are a few hundred chunk vectors (one per chunk of every post). Computing the cosine similarity against all of them is a few hundred dot products of 128 numbers each, tens of thousands of multiply-adds, which a browser on a reasonably modern machine does in a fraction of a millisecond. Then we group the chunks by post, take each post's best-scoring chunk, and sort. On my machine (M1 MacBook Air) the entire query (tokenize, embed, score every chunk, rank) takes about **0.4 milliseconds**.

In a production setting, this is where you reach for approximate-nearest-neighbour indexes (HNSW and friends), and if you have a bazillion documents you should. With a few hundred, an ANN index would be slower than the brute-force loop and much larger on disk. It's worth saying out loud because "vector search" in this case isn't a complex database system,but just a `for` loop.

There's one wrinkle worth knowing if you build one of these. The document vectors are stored as int8. Cosine similarity is invariant to a positive scale, and the document matrix uses one global scale, so the browser can dot a float32 query straight against the raw int8 bytes and get the right ranking without ever un-quantizing them. But `int8 × int8` in JavaScript overflows silently; a dot product whose true value is three million comes back as `-64`, no error, no warning. So it's better to accumulate into a regular float. I mention it because this was a fun one to debug[^wat].

## Two search engines that are each blind in a different way

Before adding semantic search, I figured I'd do the responsible thing and measured how bad the existing keyword search actually was, so I'd have a baseline to beat. I had Claude create a set of thirty test queries and split them into three kinds:

- **Exact tokens**: `pydub`, `lunr`, `mmh3`, `papermod`. Words that literally appear in a post.
- **Paraphrases**: "find documents by what they mean instead of which words they contain." Concepts, in different words than the post uses.
- **Navigational**: "how do I add search to a static site." Broad intent.

Keyword search would surely ace the exact tokens and fail the paraphrases. Then I ran it, and it failed `pydub`.

`pydub` is a Python library I've used in [a previous post](/use-google-cloud-text-to-speech-to-create-an-audio-version-of-your-blog-posts/). The word is right there in the text-to-speech post. And Fuse.js, the fuzzy-search library this blog uses, returned nothing. It turned out my configuration told Fuse to only score matches near the *start* of a field; a setting called `location`, with a `distance` window of 1000 characters. `pydub` first appears about 3,700 characters into that post, well outside the window, so as far as my search box was concerned it did not exist. The same was true for `mmh3`, and for any distinctive word that happened to appear deep in a long post. The words that *did* work only worked because they were in a title.

My keyword search had been quietly broken for years, and I only found out because I was about to benchmark against it. Derp.

And the two engines turn out to be blind in exactly complementary ways:

| | keyword finds it | semantic finds it |
|---|---|---|
| `pydub` (exact token, out of vocabulary) | ✅ | ❌ |
| "find documents by what they mean" (paraphrase) | ❌ | ✅ |

Keyword search is perfect on the exact tokens and returns *literally nothing* for all ten paraphrases; not bad results, just zero results. Semantic search is the mirror image: it nails the paraphrases and stumbles on the proper nouns, because `pydub` isn't in its vocabulary and gets shattered into meaningless subword fragments. Neither is better. They fail on disjoint sets.

## Reciprocal Rank Fusion, or: how to merge different search result sets

If each engine catches what the other misses, you want both. The problem is combining them. Keyword search returns a fuzzy-match *distance*; vector search returns a *cosine similarity*. These live on different scales that mean different things, and averaging them is meaningless; it'd be like adding a temperature to a weight.

The answer here is [Reciprocal Rank Fusion](https://medium.com/@devalshah1619/mathematical-intuition-behind-reciprocal-rank-fusion-rrf-explained-in-2-mins-002df0cc5e2a). Run queries against both indices, throw away the scores entirely and keep only the *ranks*. Each document's "fused score" is the sum, over both engines, of `1 / (k + rank)`, with `k` conventionally 60. A document ranked first by one engine and unranked by the other scores `1/61`. A document ranked third by *both* scores `1/63 + 1/63`, which is larger. The `k` flattens the top of the curve so that "both engines quite liked this" beats "one engine loved it", which is exactly what you want when one engine is blind to paraphrase and the other to proper nouns. It's about ten lines of code, it has a single parameter with a sensible default, and it never has to compare the two incomparable scores. When you search this blog now, that's what runs: keyword and semantic, fused by rank. This is easily extensible to many sources of ranked lists.

## The benchmark: it'll have to run on your hardware

I benchmarked three query encoders: the model2vec lookup table I've been describing, MiniLM q8 through transformers.js, and [ternlight](https://github.com/soycaporal/ternlight), a clever BitNet-style ternary model compiled to WebAssembly that originally sent me down this whole path.

The widget below runs all three **in your browser, on your hardware, because that's what matters for this anyway**. Each has its own Run button because one of them downloads 23 MB and you should get to decide whether you want to pay that on your connection. The download sizes are constants I measured (your browser can't see the size of a cross-origin download that doesn't send the right header); the timings are live on your device.

{{< benchmark >}}

On my laptop the story is pretty clear: the lookup table is **4.2 MB and embeds a query in a third of a millisecond**; MiniLM is **23.5 MB and 18 milliseconds**; ternlight sits in between. And in retrieval quality, measured over those thirty labeled queries, the lookup table scores just as well as MiniLM. *Just as well*. At a fifth of the size and roughly fifty times the speed.

Caveat on that claim, though; thirty queries is a small sample and I nearly fooled myself with it. Twice.

## The metric couldn't see anything

Initially, the headline metric was `recall@3`: did a relevant post make the top three? On a thirteen-post corpus, "top three of thirteen" is not a very high bar (random guessing clears it about a quarter of the time) and it turned out that almost every model cleared it on almost every query. Five different configurations tied at exactly 0.978. `Recall@3` could not tell a 4 MB lookup table apart from a 23 MB transformer.

Worse, it produced confident nonsense. Pure semantic search scored a *perfect* 1.000 on the exact-token queries; it apparently found `pydub` every time. Except it didn't:

```
pydub  →  1. Free SSL on GitHub Pages       (wrong)
          2. Let's Encrypt on GitHub Pages   (wrong)
          3. Text-to-Speech with pydub       (correct)
```

The right post is third, behind two completely unrelated ones, and `recall@3` scored that as a hit. The metric was rewarding the model for landing the right answer in a bucket wide enough that landing it there meant almost nothing. Switching to recall@**1** ("is the first result correct?") separated the models more cleanly and told a different story. Lesson learned: a metric is worthless if the metric can't see the thing you care about. I only caught it because the results looked *too* good.

## What shipped, and how to steal it

The search box on [the homepage](/) now runs keyword, semantic, and hybrid search, with a toggle so you can compare and watch them disagree. Type `pydub` and flip to semantic mode to see it get the answer wrong; flip to hybrid to see it get it right again. The whole thing is a 4 MB lookup table, a tiny document index, and about 300 lines of dependency-free JavaScript, lazy-loaded only when you focus the search box so the page itself pays nothing.

The build pipeline (the chunking, the quantization, the eval harness, all of it) is a Python package you can point at your own site:

```bash
pip install static-site-search-eval
sss-eval build --corpus content/post --outdir static/search \
  --model minishlab/potion-base-8M --dims 128 --chunk-size 600
```

The [code is on GitHub](https://github.com/bartdegoede/static-site-search-eval), the thirty eval queries are in there too so you can try it out for yourself. If you run the benchmark above on a phone over cellular, you'll likely feel the 23 MB, and understand why the lookup table was worth the trouble.

[^wat]: All time classic https://www.destroyallsoftware.com/talks/wat
