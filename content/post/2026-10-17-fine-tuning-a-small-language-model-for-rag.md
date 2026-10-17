---
title: "Fine-tuning a small language model for RAG in a browser on a Mac"
date: 2026-10-17T11:00:00-04:00
draft: true
slug: "fine-tuning-a-small-language-model-for-rag"
categories: ["machine learning", "ai", "search", "javascript"]
keywords: ["fine-tuning", "lora", "mlx", "qwen3", "small language models", "rag", "retrieval augmented generation", "transformers.js", "distillation", "llm evaluation", "onnx", "browser"]
description: "Fine-tuning Qwen3-0.6B on a Mac so it stops making things up when it summarises my blog in your browser. What worked, what didn't, and how to do it for your own site."
related:
  - rag-with-a-small-language-model-in-the-browser
  - semantic-search-in-your-browser
---

{{<audio src="/audio/2026-10-17-fine-tuning-a-small-language-model-for-rag.mp3" type="mp3">}}

[Last week's post](/rag-with-a-small-language-model-in-the-browser/) ended with a hunch. The small models that run in your browser on ["ask my blog"](/ask/) were bad at summarising four passages in two sentences, and they'd happily make up an answer to questions the blog doesn't cover. But a 0.6B-parameter model doesn't need to know everything. It needs to do one job: read four passages, and either summarise them or say they don't answer the question. "That sounds like a fine-tuning problem", I wrote, "and maybe a follow-up post."

So here's that follow-up. It took four rounds of training data to get there, and two of the three that didn't work are more interesting than the one that did. The short version: the fine-tuned Qwen3-0.6B is now the default on [ask my blog](/ask/). It's right about as often as the original, it's wrong a third as often, and it never answered a question the blog doesn't cover. It's also a smaller download. The model, the dataset and the code are all public, so you can [put it on your own site](#do-it-yourself).<!-- more -->

## The job, and the plan

The model gets a system prompt ("answer in at most two sentences, using only these passages, or say the blog doesn't seem to cover it"), four numbered passages that search found, and a question. That's it. A good answer either states what the passages say, or says "The blog does not seem to cover this." when they don't answer it.

Fine-tuning a model for that means showing it a few thousand examples of the job done well. The plan:

1. **Training data from openly licensed writing, not my blog.** My blog's 45 eval questions from the last post are the test, so training on my posts would be cheating; and there are only 16 of them anyway. Instead I used the [Go blog](https://go.dev/blog), the [Rust blog](https://blog.rust-lang.org), the [Rust RFCs](https://rust-lang.github.io/rfcs/) and the [Python PEPs](https://peps.python.org): 2,193 documents of technical writing, licensed so I can publish the dataset afterwards.
2. **The same retrieval as the blog.** Each document is chunked and embedded exactly like the [semantic search on this blog](/semantic-search-in-your-browser/), and each training question gets the top four passages that search returns. So the model trains on passages that are as noisy as the ones it gets in production: sometimes the answer is in passage 1, sometimes in passage 4, sometimes a near-duplicate from a different post sits next to it.
3. **Claude writes the examples.** Claude Sonnet 5.5 wrote the questions, about a single passage. Some have the answer among the four passages, for some I removed the document the question came from (so the right answer is the refusal), and some are near-misses: related questions the passages probably don't answer. Claude Opus 5.5 then answered every one of them from the passages, using the same system prompt the blog uses. That makes this a form of distillation: a big model demonstrates the job, a small one learns to imitate it[^anthropic].
4. **Train on a Mac.** [LoRA](https://arxiv.org/abs/2106.09685)[^lora] with [mlx-lm](https://github.com/ml-explore/mlx-lm) on an M4 Mac mini with 24 GB of memory. One pass over the 4,500 training examples takes about an hour and twenty minutes.
5. **Export it for the browser** in the same 4-bit format the page already loads, and run the same eval as last time: 30 questions the blog answers, 15 it doesn't, graded by Opus against the passages.

One more thing about that last step: I compare each fine-tune against the base model exported the same way, so the fine-tune is the only difference. That base model scores 17 of 30 faithful answers, not the 18 from the last post[^base].

## v1: worse than doing nothing

The first dataset had about 4,500 examples, with Opus's answers as written: usually two dense sentences. After training, Qwen3-0.6B was faithful on **8 of 30** questions, against 17 before I touched it. It did learn to refuse: it never made up an answer for any of the 15 questions the blog doesn't cover, against 2 for the base model. But on the questions the blog does answer, it got a lot worse.

It had picked up two habits. The first came straight from the training data. When Opus could answer part of a question, it would answer that part and add something like "the blog does not go into more detail about why". That's a perfectly good answer from a model that can tell what's missing. About 10% of the training answers had one of those clauses, and the fine-tune learned to add one regardless, to a third of its answers, usually about something the passages *did* explain.

The second habit was worse: it packed in more details, and got them wrong. Here's what the base model and v1 say to "What does the blog say about embeddings and cosine similarity?":

> "The blog discusses embeddings as a way to capture semantic relationships between words, using cosine similarity as a measure of similarity between vectors." (Qwen3-0.6B)

> "The blog says embeddings capture semantic relationships, not just lexical ones, and that "King" and "bicycle" are close together, "King" and "bicycle" are far apart, "Beer" and "alcoholic beverage" are neighbors." (v1)

The base model is vague, but right. v1 sounds like it read the post, and it's wrong: in the [semantic search post](/building-a-semantic-search-engine-in-250-lines-of-python/) "king" and "queen" are close together and "bicycle" is far away. It took the shape of Opus's answers (several specific facts, quoted terms, a second sentence) without the careful reading that produced them.

## v2: the loss went down, the answers got worse

The hedges were the easy fix: a script stripped the "the blog doesn't explain X" clauses from the training answers (and dropped the examples that started with one), and I trained again. The hedges disappeared. The answers didn't get better: **9 of 30**.

This time I evaluated checkpoints along the way, and that's where it got interesting:

{{< svg "loss-vs-answers.svg" "Fine-tune v2: validation loss per checkpoint, and faithful answers on the blog's eval. Hover a dot for details." >}}

Validation loss, the number you watch while fine-tuning, improved at every checkpoint. On the blog's questions, the model got worse at every checkpoint: 18, 11, 9 faithful answers. The loss doesn't measure what I care about. It measures how closely the model imitates Opus's answers, word for word, on held-out Go, Rust and Python passages. Dense answers that combine several facts are exactly what a 0.6B model can imitate in form but not in substance, so the better it imitated them, the more specifics it stated, and the more of them it got wrong.

Two lessons from that. Pick checkpoints on the thing you care about, not on the loss: from here on, every checkpoint answered the dataset's 260 held-out examples, and Opus graded those answers, about a dollar per checkpoint through the [Batch API](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing). And if the model can't do what the training answers do, more training makes it worse.

## v3: say less

So for v3 I kept the questions and the passages and changed only the answers. Opus regenerated all of them with stricter instructions: one short sentence with the fact the question asks for, in the passage's own words; don't combine facts from different passages; don't comment on what's missing. A second sentence only if the question asks for two things. The answers went from 180 to 123 characters on average, and the embeddings question now gets this:

> "The key insight is that these vectors capture semantic relationships, not just lexical ones." (v3)

That's not a great summary, but every word of it is in the post. And that's the trade v3 makes across the board:

{{< svg "versions.svg" "Faithful and wrong answers on the 30 questions the blog answers, per version. The ring marks the version on ask my blog. Hover a dot for details." >}}

v3 is faithful on **16 of 30** questions, the same as the base model's 17 for all intents and purposes (with 30 questions, a difference of one is noise). But it's wrong on only **3**, against 9, and it said "The blog does not seem to cover this." to all 15 questions the blog doesn't cover. Asked which GPU to buy to run Llama 70B, the base model spun a paragraph about choosing the right GPU out of passages about embeddings and a coding agent; v3 declines.

The cost of that caution: on 11 of the 30 answerable questions v3 says the blog doesn't cover it (or gives an extract that doesn't answer the question), against 4 for the base model. For "ask my blog" that's the right trade, I think. The passages are on the page right below the summary, so a refusal costs the reader a few seconds of reading; a confidently wrong summary costs them a wrong idea about what I wrote.

## v4: more of what it was bad at made it worse

Most of v3's wrong refusals were broad questions: "What has the blog written about hashing and bit arrays?", "How can I turn my written articles into something readers can listen to?". Every v3 training question was about one fact in one passage; the blog's eval also has navigational and conceptual ones. So for v4 I added about 1,200 of those: per document, a "what has the blog written about X" and a "how do I do Y" question, answered by Opus in one or two short sentences.

It made things worse: **13 of 30**. v4 stopped refusing the broad questions, and started garbling them instead, in exactly the way v1 did:

> "The blog explains that embeddings capture semantic relationships, not just lexical ones, so words like "king" and "bicycle" are close together, not just words that look similar." (v4)

An answer to a broad question has to combine several passages, and combining passages is the thing a 0.6B model gets wrong, no matter how short the target answer is. What it *can* learn is to find the sentence that answers the question and repeat it, or to say nothing. So v3 is the one on the page.

## What I'd take away

- **The training answers matter more than anything else.** v1, v3 and v4 used the same training setup; only what the answers looked like changed. A small model copies the style of its training data far more readily than the skill behind it, so the style has to be one it can actually pull off.
- **Don't trust the loss.** Evaluate checkpoints on the task, with a held-out set from documents the model never saw, and keep the real test (my 45 questions) for the very end, once.
- **Small models extract; they don't summarise.** Ask for the sentence that answers the question, not a synthesis.
- **Negative results are cheap at this size.** Each experiment was an hour and a half of training on a Mac mini and a few dollars of grading. That made it easy to try the obvious next thing, and to find out it didn't work.

Some honesty about the numbers, too. Thirty questions is a small test: v3's 16 versus the base model's 17 is a tie, and the difference between 3 and 9 wrong answers is the part I'd bet on. And Claude both wrote the training answers and graded the results, so the grader may like answers in its own style. The 260 held-out examples and my blog's questions blunt that (neither was ever trained on), but they don't remove it.

## Do it yourself

Nothing in the model is specific to my blog: it never saw a single one of my posts in training. So there are three levels of doing this yourself:

1. **Use the model.** [`bartdegoede/qwen3-0.6b-small-rag`](https://huggingface.co/bartdegoede/qwen3-0.6b-small-rag) is on Hugging Face, in the q4f16 format [transformers.js](https://huggingface.co/docs/transformers.js) loads on WebGPU or in WebAssembly, and as regular weights for Python. The [browser example](https://github.com/bartdegoede/small-rag-finetune/tree/main/examples/browser) is a single static page: build a search index from a folder of markdown posts with one command, serve the folder, and ask away.
2. **Check it on your posts first.** Write 30 to 50 questions about your posts, some your posts answer and some they don't, and [run the eval](https://github.com/bartdegoede/small-rag-finetune#evaluate-it-on-your-own-site): it retrieves passages from your posts exactly like the page does, runs the model, and has Opus grade the answers. That's about 20 cents for 45 questions. On my posts as they are today, it gets 18 of 30 right and correctly refuses 13 of 15.
3. **Train your own.** The [dataset](https://huggingface.co/datasets/bartdegoede/small-rag-answers) and the [code](https://github.com/bartdegoede/small-rag-finetune) are public. The most likely reason to retrain: the system prompt and the refusal say "blog", and for documentation you'd want them to say "the documentation". That means regenerating the answers (the v3 answers cost about $14 through the Batch API) and an hour or two of training on an Apple Silicon Mac.

There's one more small win in there. The official Qwen3-0.6B files are 579 MB; the fine-tune is 358 MB, because its export uses one 4-bit matrix for both the input embeddings and the output layer, which the model ties anyway. That's close to the 350 MB budget I set for the page in the last post.

## What's next

The obvious next experiment is a bigger student. In the last post Gemma 4 E2B was faithful 28 times out of 30 without any fine-tuning, at 3.1 GB. Somewhere between 0.6B and that, there's probably a model that can learn to summarise rather than extract, and still be a reasonable download. In the meantime, [ask my blog something](/ask/), and if you want to see the difference for yourself, the original Qwen3-0.6B is still there under "Other models" to compare.

[^anthropic]: To be transparent: this whole project leans on Anthropic's models, which also wrote a fair share of the code with me. The dataset card says which model wrote what.

[^lora]: Low-rank adaptation: instead of updating all 600 million weights, you train small extra matrices next to some of them (here rank 8, on every layer), under 1% of the parameters. It's much cheaper, it fits in a Mac's memory, and afterwards the extra matrices are merged back into the model so it's the same size as before.

[^base]: The last post used the official ONNX files from [onnx-community](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX); here everything goes through my own export (more on that [below](#do-it-yourself)). One question's difference, in other words, and well within the noise.
