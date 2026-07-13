---
title: "Your OpenClaw can book flights. But can it survive a dungeon crawl?"
date: 2026-02-19T12:00:00-07:00
draft: false
slug: "ai-agent-dungeon-crawl"
categories: ["ai", "python", "games"]
keywords: ["ai agent", "llm", "crawlerverse", "roguelike", "sdk", "openclaw", "benchmark", "claude"]
description: "Everyone's building AI agents that send emails and book flights. How about one that fights monsters in a dungeon? Here's how you can too."
cover:
    image: "/img/2026-02-19-ai-agent-dungeon-crawlerverse-sdk/cover.png"
related:
  - running-a-coding-agent-locally
---

{{<audio src="/audio/2026-02-19-ai-agent-dungeon-crawlerverse-sdk.mp3" type="mp3" backup_src="/audio/2026-02-19-ai-agent-dungeon-crawlerverse-sdk.ogg" backup_type="ogg">}}

AI agents are having a *moment*. [OpenClaw](https://clawd.bot/) (née Clawdbot, née Moltbot[^naming]) just hit 200k GitHub stars. People are driving a Mac Mini shortage just to manage their email, book flights, and order groceries. Someone launched a [fake $CLAWD crypto token](https://finance.yahoo.com/news/fake-clawdbot-ai-token-hits-121840801.html) that hit $16 million before crashing 90%. Its creator [joined OpenAI](https://steipete.me/posts/2026/openclaw). There's a [social network for AI agents](https://techcrunch.com/2026/01/30/openclaws-ai-assistants-are-now-building-their-own-social-network/) now.

These agents can do genuinely useful and awesome things. But let's be honest: sending emails and checking you in for flights is not exactly *exciting*. What if, instead of a boarding pass, we gave our AI agent a sword?<!-- more -->

[My buddy](https://github.com/reluctantfuturist/) and I have been building [CrawlerVerse](https://crawlerver.se/), a roguelike dungeon crawler designed specifically for AI agents. Think [Dungeon Crawl Stone Soup](https://crawl.develz.org/) but it also has an API, and 3d dice if you want to use your wetware/brain to play yourself. You or your agent get dropped into a procedurally generated dungeon, receive observations about what is visible (there's monsters, items, walls, stairs), and has to decide what to do each turn. Kill monsters. Pick up loot. Don't die[^mages].

We just open-sourced the [Python SDK](https://github.com/crawlerverse/crawlerverse-sdks), and there's a public [leaderboard](https://crawlerver.se/leaderboard). So now you could build an agent and let it loose in a dungeon, and give your Clawdbot something to do while it waits for your texts about ordering DoorDash.

# A dumbass bot

Here's the simplest possible agent:

```python
from crawlerverse import CrawlerClient, run_game, Wait, Observation, Action

def my_agent(observation: Observation) -> Action:
    # it waits, that all it does
    return Wait()

# request an API key at https://www.crawlerver.se/agent-api/waitlist
# ping me if I don't approve your key fast enough
with CrawlerClient(api_key="cra_...") as client:
    result = run_game(client, my_agent, model_id="my-monster-slaying-bot")
    print(f"Floor {result.outcome.floor}, turns: {result.outcome.turns}")
```

That's it. Your agent receives an observation, returns an action. The SDK handles the game loop, API calls, retries, all that jazz. This particular agent waits every turn and will get eaten by the first roaming monster that happens to walk into the room its crawler is waiting in, but it *works*. It "plays" the game. It will show up on the leaderboard[^dead_last].

The `observation` tells you everything your agent can see: visible tiles, monster positions and health, items on the ground, your inventory, player stats (HP, attack, defense), equipped gear, and which directions you can move. The action is one of: move, attack, wait, pickup, drop, use, equip, enter portal, or ranged attack. This is exactly the same you would see as a human playing the game.

Let's make it less suicidal.

# Giving it some brains

The SDK has some [example agents](https://github.com/crawlerverse/crawlerverse-sdks/tree/main/python/examples) for Anthropic, OpenAI, and local models. Let's walk through the Claude one, because that's what I had lying around[^tokens].

## Step 1: Tell the bot what it can see

First, we need to turn the observation into something an LLM can understand. The SDK gives you typed Python objects; the LLM needs text.

```python
def format_observation(obs: Observation) -> str:
    p = obs.player

    # Basic stats the LLM needs to make decisions
    lines = [
        f"Turn {obs.turn} | Floor {obs.floor}",
        f"HP: {p.hp}/{p.max_hp} | ATK: {p.attack} | DEF: {p.defense}",
        f"Position: ({p.position[0]}, {p.position[1]})",
    ]

    # What gear we're wearing (if any)
    if p.equipped_weapon:
        lines.append(f"Weapon: {p.equipped_weapon}")
    if p.equipped_armor:
        lines.append(f"Armor: {p.equipped_armor}")

    # What we're carrying
    if obs.inventory:
        inv = ", ".join(f"{i.name} ({i.type})" for i in obs.inventory)
        lines.append(f"Inventory: {inv}")

    # Which directions aren't blocked by walls
    passable = [d.value for d in Direction if obs.can_move(d)]
    lines.append(f"Passable directions: {', '.join(passable)}")

    # Everything we can see: tiles, monsters, and items on the ground
    lines.append("\nVisible tiles:")
    for tile in obs.visible_tiles:
        parts = [f"  ({tile.x},{tile.y}) {tile.type}"]
        if tile.monster:
            m = tile.monster
            parts.append(f"[MONSTER: {m.type} HP:{m.hp}/{m.max_hp}]")
        if tile.items:
            parts.append(f"[ITEMS: {', '.join(tile.items)}]")
        lines.append(" ".join(parts))

    return "\n".join(lines)
```

Each turn, the LLM gets something like this:

```
Turn 14 | Floor 1
HP: 8/10 | ATK: 3 | DEF: 1
Position: (5, 3)
Weapon: short-sword
Passable directions: north, east, southeast

Visible tiles:
  (5,2) floor
  (6,3) floor [ITEMS: health-potion]
  (6,2) floor [MONSTER: goblin HP:4/6]
  (4,3) wall
```

## Step 2: Tell the bot what it can do

The system prompt is where the strategy lives. You can get surprisingly far with a basic set of instructions:

```python
SYSTEM_PROMPT = """\
You are an AI agent playing Crawlerver.se, a roguelike dungeon game.
Each turn you receive an observation and must choose ONE action.
Respond with a JSON object (no markdown, no explanation).

## Actions
  {"action": "move", "direction": "<dir>"}
  {"action": "attack", "direction": "<dir>"}
  {"action": "ranged_attack", "direction": "<dir>", "distance": <1-15>}
  {"action": "pickup"}
  {"action": "drop", "itemType": "<item>"}
  {"action": "use", "itemType": "<item>"}
  {"action": "equip", "itemType": "<item>"}
  {"action": "wait"}
  {"action": "enter_portal"}

Directions: north, south, east, west, northeast, northwest, southeast, southwest

## Strategy Tips
- Kill monsters to clear the path. Attack adjacent monsters.
- Pick up items (potions, weapons, armor), they help you survive.
- Equip weapons and armor for better stats.
- Use health potions when HP is low.
- Find stairs down to descend to the next floor.
- Explore systematically; avoid getting surrounded.

Always include a "reasoning" field explaining your decision."""
```

This is *the* part to mess around with. More on that later.

## Step 3: Parse the response

LLMs are not known for consistently producing valid JSON[^json], so we need some defensive parsing:

```python
def parse_action(raw: str) -> Action:
    text = raw.strip()
    # Strip markdown code fences if the LLM ignores our instructions
    # Gemini does this A LOT
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]

    # Find JSON if buried in other text
    if not text.startswith("{"):
        start = text.find("{")
        if start >= 0:
            end = text.rfind("}")
            if end > start:
                text = text[start : end + 1]

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return Wait(reasoning="Failed to parse response")

    action_type = data.get("action", "wait")
    cls = ACTION_MAP.get(action_type)
    if cls is None:
        return Wait(reasoning=f"Unknown action: {action_type}")

    # Build the action from the response fields
    valid_fields = set(cls.model_fields.keys())
    kwargs = {k: v for k, v in data.items()
              if k != "action" and k in valid_fields}

    try:
        return cls(**kwargs)
    except Exception:
        return Wait(reasoning=f"Failed to construct {action_type}")
```

The fallback is always `Wait()`. Better to skip a turn than to crash the game because your AI of choice decided to write a haiku instead of JSON.

## Step 4: Wire it up

Now we connect the pieces. The agent keeps a conversation history so the LLM "remembers" what happened on previous turns; this is what gives it "memory" across the game.

```python
def make_agent(model: str = "claude-haiku-4-5-20251001"):
    client = Anthropic()
    messages: list[dict] = []

    def agent(obs: Observation) -> Action:
        prompt = format_observation(obs)
        messages.append({"role": "user", "content": prompt})

        # Prefill with "{" to force JSON output
        # This is another stupid trick I learned while doing this
        prefill = {"role": "assistant", "content": "{"}
        response = client.messages.create(
            model=model,
            system=SYSTEM_PROMPT,
            messages=[*messages, prefill],
            temperature=0.3,
            max_tokens=200,
        )

        reply = "{" + response.content[0].text
        messages.append({"role": "assistant", "content": reply})
        return parse_action(reply)

    return agent
```

The `"{" prefill` trick is worth calling out. By starting the assistant's response with `{`, we're nudging the LLM to continue with JSON rather than English (or Chinese if you're on GLM). It's not bulletproof (hence the defensive parser), but it works okay.

Run it:

```python
agent = make_agent()
with CrawlerClient() as client:
    result = run_game(client, agent, model_id="claude-haiku-4.5")
    print(f"Game over! Floor {result.outcome.floor}")
    print(f"Watch replay: {result.spectator_url}")
```

The full example with error handling, debug output, and game resumption is in [`examples/anthropic_agent.py`](https://github.com/crawlerverse/crawlerverse-sdks/blob/main/python/examples/anthropic_agent.py). There are equivalent examples for [OpenAI](https://github.com/crawlerverse/crawlerverse-sdks/blob/main/python/examples/openai_agent.py) (works with any OpenAI-compatible API, including Ollama and LMStudio) and [local models](https://github.com/crawlerverse/crawlerverse-sdks/blob/main/python/examples/local_llm_agent.py).

If there are currently bots playing, you can see them strugg.. crushing their dungeons [live](https://www.crawlerver.se/live). Every game also produces shareable replay links to show off to your friends how great your bot is doing!

# The leaderboard

{{< figure src="/img/2026-02-19-ai-agent-dungeon-crawlerverse-sdk/leaderboard.jpg" title="The CrawlerVerse leaderboard. Your bot's name could be here." >}}

The [CrawlerVerse leaderboard](https://crawlerver.se/leaderboard) tracks the best run for each model ID. When you call `run_game`, you pass a `model_id` string that identifies your agent on the leaderboard. So `claude-haiku-4.5` and `gpt-4o` show up as separate entries, and your fine-tuned `my-custom-llama-v3` would get its own row too.

This is almost like a benchmark, but not the boring kind. Nobody's picking between four multiple choice options on a standardized test. Your model has to explore a dungeon it's never seen before, manage health and inventory, decide when to fight and when to run, and not walk into walls. The levels are procedurally generated, so you can't memorize solutions.

If you're in the fine-tuning or RL space and you're tired of optimizing for [MTEB](https://huggingface.co/spaces/mteb/leaderboard), I think this could be more interesting (definitely not biased). The signal is clean (floor reached, turns survived) and the leaderboard is public.

# Build your own

Three ways in, depending on who you are:

## "I just want to try it"

```bash
pip install crawlerverse
```

Grab an API key from [crawlerver.se](https://crawlerver.se/agent-api/waitlist), copy one of the [example agents](https://github.com/crawlerverse/crawlerverse-sdks/tree/main/python/examples), and run it. You'll have a bot on the leaderboard in five minutes.

The SDK supports both sync and async clients, so if you want to run multiple games concurrently:

```python
from crawlerverse import AsyncCrawlerClient, async_run_game

async with AsyncCrawlerClient() as client:
    result = await async_run_game(client, my_agent)
```

N.B.: we do have some basic rate limiting set up, and we're just nerds trying to have fun, so be nice.

## "I have an OpenClaw running on a Mac Mini"

If you're one of the people that managed to snag a Mac Mini and set up OpenClaw, you can wire up a CrawlerVerse [skill](https://docs.openclaw.ai/tools/skills). Create a folder at `~/.openclaw/skills/crawlerverse/` with a `SKILL.md`:

````markdown
---
name: crawlerverse
description: Play CrawlerVerse, a roguelike dungeon crawler game. Use when the user wants to play a dungeon game, fight monsters, or compete on the CrawlerVerse leaderboard.
tools: Bash
metadata: {"openclaw":{"requires":{"env":["CRAWLERVERSE_API_KEY"]}}}
---

# CrawlerVerse Dungeon Crawler

Play a roguelike dungeon game via the CrawlerVerse API.

## Setup
Run `pip install crawlerverse` if not already installed.

## How to Play
Run the game script:
```bash
python ~/.openclaw/skills/crawlerverse/scripts/play.py
```

The script will start a game and ask you to make decisions each turn.
Each turn you'll see what's around you (monsters, items, walls) and
need to choose an action: move, attack, pickup items, use potions, etc.

## Strategy
- Attack adjacent monsters to clear the path
- Pick up and equip weapons and armor
- Use health potions when HP is low
- Find stairs to descend to the next floor
- Explore systematically, don't get surrounded
````

Then add a `scripts/play.py` that uses the SDK's `run_game` with a callback that asks OpenClaw for each decision — same pattern as the Claude example above, but using OpenClaw's LLM instead. The [anthropic_agent.py](https://github.com/crawlerverse/crawlerverse-sdks/blob/main/python/examples/anthropic_agent.py) example is a good starting point to adapt.

Your Mac Mini can fight monsters while you sleep. Each game takes a few minutes and a handful of cents in tokens, so you could leave it grinding the leaderboard overnight and check the results in the morning.

## "I want to train a model for this"

The game API is a pretty clean RL environment. Observations in, actions out. Discrete action space (9 actions, 8 directions). Clear reward signal (floor reached, monsters killed, turns survived). Episodes are short enough to iterate quickly.

The [API docs](https://crawlerver.se/docs/agent-api) cover everything you need. The Python SDK is MIT licensed. The leaderboard is waiting.

Some ideas to get you started:
- **Prompt engineering**: the system prompt in the example is basic. There's a lot of room for better strategic instructions, few-shot examples, or chain-of-thought reasoning.
- **Fine-tuning**: collect a dataset of game transcripts from good runs and fine-tune a smaller model on it.
- **RL from game outcomes**: use floor reached as a reward signal and train directly on gameplay.

# Come beat the high score

The SDK is at [github.com/crawlerverse/crawlerverse-sdks](https://github.com/crawlerverse/crawlerverse-sdks). The API docs are at [crawlerver.se/docs/agent-api](https://crawlerver.se/docs/agent-api). The leaderboard is at [crawlerver.se/leaderboard](https://crawlerver.se/leaderboard).

Current best run is _literally_ floor 1. Come take it.

[^naming]: The name changes are a whole saga on their own. Steinberger originally called it Clawdbot (a play on Claude bc he _loved_ Claude and Claude Code), Anthropic sent a cease-and-desist, it became Moltbot, then [OpenClaw](https://www.cnbc.com/2026/02/02/openclaw-open-source-ai-agent-rise-controversy-clawdbot-moltbot-moltbook.html). The crypto scammers didn't get the memo and launched a $CLAWD token under the original name.
[^mages]: So at time of writing we built basic ranged combat and a (de)buff system, that will be the foundation for the magic system. I.e. the magic system doesn't exist yet. All I'm saying is maybe don't pick the mage class right now.
[^dead_last]: Dead last, but still technically on there. You could be first for a bit, depending on how quickly you get a key and run this script.
[^tokens]: Gotta use those Claude subscription tokens for something. Your mileage (and invoice) may vary. Any OpenAI compatible API will work too.
[^json]: Understatement of the year. Hi Gemini.
