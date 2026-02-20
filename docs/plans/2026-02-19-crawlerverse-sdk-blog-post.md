# Blog Post: CrawlerVerse SDK Release

## Working Title

"Your AI agent can book flights. But can it survive a dungeon?"

Alternative titles:
- "From OpenClaw to open dungeons: building an AI agent that fights monsters"
- "The AI benchmark where your model needs a sword"

## Concept

A blog post announcing the open-source CrawlerVerse Python SDK by walking through building a Claude-powered dungeon crawling agent. Rides the OpenClaw/AI agent hype wave as a hook, positions CrawlerVerse as a fun alternative benchmark to things like MTEB, and ends with a call to action to get on the leaderboard.

## Audience

Primary: Bart's existing blog readers (technical, enjoy conversational/humorous writing).
Secondary: AI/LLM developers looking for agent projects, broader tech audience interested in the AI agent moment.

## Tone

Matches existing blog voice: conversational, self-deprecating, technical but accessible, humorous asides and footnotes. See the Hugo migration post for reference.

## Structure

### 1. Opening (~200 words)

The OpenClaw moment. Everyone's talking about AI agents. Peter Steinberger built Clawdbot, it went viral, Anthropic sued over the name, it became Moltbot then OpenClaw, someone launched a fake crypto token, the creator joined OpenAI. These agents book flights, send emails, manage calendars. Impressive. Also boring.

What if we gave an AI agent a sword and dropped it in a dungeon?

Introduce CrawlerVerse: a roguelike dungeon crawler built specifically for AI agents. You and your buddy built it, you just open-sourced the Python SDK, and there's a public leaderboard. Link to crawlerver.se.

### 2. The 5-line version (~150 words)

The minimal working example. Show the simplest possible agent:

```python
from crawlerverse import CrawlerClient, run_game, Wait, Observation, Action

def my_agent(observation: Observation) -> Action:
    return Wait()

with CrawlerClient(api_key="cra_...") as client:
    result = run_game(client, my_agent, model_id="my-first-bot")
```

This agent does nothing and dies immediately. But it *plays the game*. The SDK handles the game loop, the API calls, everything. Your job is just writing the function that decides what to do.

The "wait, that's all?" moment.

### 3. Making it smarter (~300 words)

Now wire up Claude (or any LLM). Progressive build-up:

**First**: the observation. What does your agent actually see? Tiles, monsters, items, player stats. Show the observation helpers (`obs.nearest_monster()`, `obs.can_move()`, `obs.items_at_feet()`).

**Then**: formatting it for an LLM. Show how to turn the observation into a text prompt. The system prompt with strategy tips (kill monsters, pick up items, equip gear, use potions when low on HP, find stairs).

**Then**: parsing the response back into actions. The JSON format, the action map, handling when the LLM produces garbage (fall back to Wait).

**Finally**: conversation history. The agent keeps a message list so Claude remembers what happened on previous turns. This is what gives it "memory" across the game.

Each piece introduced as a natural "okay but what if we also..." progression. The full code is in the SDK examples repo - link to `anthropic_agent.py`.

### 4. Watching it play (~300 words)

Run the agent, report what happened. This can be written with placeholder results and filled in later, or written speculatively based on likely outcomes.

Likely material:
- What floor it reached
- Funny/dumb decisions (LLMs are notoriously bad at spatial reasoning)
- Whether it figured out to use potions, equip weapons, etc.
- Token cost for a full game
- Link to the replay on crawlerver.se

Tone should match the Hugo migration post's "gaslighting" section - affectionate mockery of the AI's confident incompetence.

### 5. The leaderboard (~200 words)

Where the bot landed on the leaderboard. What model was used, what it cost.

The pivot: this is an open leaderboard. Different model IDs show separately. You can see Claude vs GPT-4o vs fine-tuned Llama vs whatever people throw at it.

This isn't MTEB. Nobody's optimizing for multiple-choice benchmarks. Your model has to actually make decisions, manage resources, and not walk into walls. Procedurally generated levels mean you can't memorize solutions.

For the fine-tuning crowd: this is a genuinely interesting RL challenge with clear signal (floor reached, survival time) and a public leaderboard to measure against.

### 6. Make your own (~200 words)

Three paths:

1. **From scratch**: `pip install crawlerverse`, grab an API key, write your agent function. Link to SDK repo and examples.
2. **OpenClaw users**: Rough sketch of how you'd wire up a CrawlerVerse skill for OpenClaw. Your Mac Mini can fight monsters while you sleep.
3. **Fine-tuning / RL**: The game API is a clean environment for training. Observations in, actions out. Clear reward signal. Come build something that actually survives.

Link to: SDK repo, API docs, leaderboard, examples for OpenAI/Anthropic/local models.

### 7. Closing (~100 words)

Short and cheeky. Current high score is floor X. Come beat it.

Maybe a footnote about how the blog post itself was written with Claude, and it still can't get past floor 3.

## Front Matter

```yaml
title: "Your AI agent can book flights. But can it survive a dungeon?"
date: 2026-02-XX
draft: true
slug: "ai-agent-dungeon-crawlerverse-sdk"
categories: ["ai", "python", "games"]
keywords: ["ai agent", "llm", "crawlerverse", "roguelike", "sdk", "openclaw", "benchmark"]
description: "Everyone's building AI agents that send emails and book flights. I built one that fights monsters in a dungeon. Here's how, and here's the leaderboard."
```

## Assets Needed

- Screenshot(s) of gameplay / replay viewer on crawlerver.se
- Maybe a screenshot of the leaderboard
- Cover image (dungeon-themed? AI-meets-fantasy?)

## Open Questions

- Exact results from running the bot (can fill in later)
- Whether to include an actual OpenClaw skill file or keep it as pseudocode
- Final title (the working title is good but may want to workshop)
- Date of publication (coordinate with any other CrawlerVerse announcements?)
