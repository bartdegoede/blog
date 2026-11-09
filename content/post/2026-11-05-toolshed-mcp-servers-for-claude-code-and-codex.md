---
title: "Toolshed: one place to keep the MCP servers for Claude Code and Codex"
date: 2026-11-09T08:00:00-05:00
draft: false
slug: "toolshed-mcp-servers-for-claude-code-and-codex"
categories: ["ai", "open-source", "golang", "how-to"]
keywords: ["mcp", "model context protocol", "claude code", "codex", "mcp servers", "go", "tui", "keychain", "secrets", "import", "goreleaser", "homebrew"]
related:
  - running-a-coding-agent-locally
description: "Adding an MCP server to a coding agent means hunting for a JSON snippet, pasting an API token into a dotfile, and doing it all again for the other agent. Toolshed is a TUI and one command to add any MCP server to Claude Code and Codex, with the secrets living in your keychain rather than in config files."
cover:
    image: "/img/2026-11-05-toolshed-mcp-servers-for-claude-code-and-codex/cover.jpg"
    alt: "Illustration of a small wooden tool shed with its doors open, a pegboard of glowing plug-in modules inside, and cables running out to two terminal windows on either side"
---

{{<audio src="/audio/2026-11-05-toolshed-mcp-servers-for-claude-code-and-codex.mp3" type="mp3">}}

Every time I want to give one of my coding agents a new tool, the routine is the same: find the right JSON snippet in some README, paste an API token into a config file in my home directory, do it again for the other agents I run, and hope the server actually starts (and keeps starting). So I built [toolshed](https://github.com/bartdegoede/toolshed), a TUI and one command that adds any MCP server to Claude Code *and* Codex, with the secrets in the OS keychain instead of in my dotfiles.<!-- more -->

> **Where this came from.** At [StubHub](https://www.stubhub.com) (I worked here) we used an internal tool built on a similar idea. We mostly use it to hook our agents up to internal tools, some (most) of which don't have an MCP server at all, so that tool wraps around existing CLIs that use your personal credentials. I used that tool a lot, and I liked it enough that I wanted something like it for my own projects. `toolshed` is a separate, open-source project that I wrote from scratch and improved upon on my own time. It doesn't contain any StubHub code or information, it isn't the tool we use at work, and it's not affiliated with or endorsed by StubHub. Opinions here are my own.

# Managing many MCPs gets annoying

[MCP](https://modelcontextprotocol.io) (the Model Context Protocol) is a standard that lets coding agents talk to tools: a server advertises a list of tools and their descriptions ("search Jira", "open a browser", "query the database") the agent can call to do work or retrieve relevant information. There are servers for nearly everything now, and when there isn't one, writing your own is a prompt away with an AI subscription.

This is all fine if you only have a couple, and use only one coding agent. To add one, you:

1. find the appropriate incantation in the server's README (is it `npx`? `uvx`? a Docker image? a URL?);
2. register it with Claude Code (or Codex), either with `claude mcp add` or by editing `~/.claude.json`;
3. paste an API token into that same JSON file, in plain text, next to everything else;
4. do it all again for Codex, which has its own CLI (`codex mcp add`) and its own TOML config (`~/.codex/config.toml`);
5. restart the agent, and find out whether the server actually starts.

None of this is hard. It's tedious, the tokens sit in plain text in my home directory, and with every MCP, agent and project you add, you keep adding cognitive overhead ("does Codex have access to this one?", "is it enabled for my user or just for a project?").

What this does is give you a CLI to manage this more easily for Claude Code and Codex, and stores credentials in your keychain (on MacOS or Linux). It is also an MCP server itself so your favorite agent can manage your MCPs for both agents through it.

# What it looks like

{{< figure src="/img/2026-11-05-toolshed-mcp-servers-for-claude-code-and-codex/demo.gif" alt="Terminal recording of the toolshed TUI: installing a server with a secret into Claude Code and Codex, adding one and seeing its tools, Claude Code using a tool and adding the Playwright server itself, approving that server in the TUI, and the import screen for a server set up by hand" title="Install a server, or let your agent add one, approve it, and import what you already have" >}}

Run `toolshed` and you get a list of your tools (plus a few built-in examples). Press `a` to add one, `t` to start it and see which tools it offers, and `i` to install it. If you'd rather type than browse:

```sh
toolshed add memory --npx @modelcontextprotocol/server-memory
#  ✓ Added memory
#    ✓ pinned to 2.1.0
#  ✓ memory offers 9 tools
#      create_entities   Create multiple new entities in the knowledge graph
#      …

toolshed install memory
#  ✓ memory → claude, codex
```

`--npx` and `--uvx` cover npm and Python packages, `--url` covers remote servers, and anything after `--` is just a command:

```sh
toolshed add fetch --uvx mcp-server-fetch
toolshed add docs  --url https://mcp.context7.com/mcp
toolshed add jira  --secret JIRA_TOKEN -- jira-mcp --site acme
toolshed add acme  --url https://mcp.acme.com/mcp \
  --header 'Authorization=Bearer ${ACME_TOKEN}' --secret ACME_TOKEN
```

Packages get pinned to the version that's current when you add them. Without that, `npx -y` fetches whatever was published last every time your agent starts the server, and runs it with your token in its environment. `toolshed upgrade` moves them to a newer release when you decide to.

If you've already added MCP servers manually, `toolshed import` (or `m` in the TUI) finds the ones Claude Code and Codex already have and tries to determine which of their values are secrets. It guesses from names like `GITHUB_TOKEN` or an `Authorization` header, and you check the guesses (you can add the ones it missed). The secrets move into the keychain, and the server is installed again through toolshed, so the token leaves the config file. Your registry only gets the names, never the values.

{{< figure src="/img/2026-11-05-toolshed-mcp-servers-for-claude-code-and-codex/import.png" alt="The toolshed import screen: servers Claude Code and Codex already have, with where each is registered, what it runs, and its values masked" title="Import the servers you already have, with their values masked" >}}

# How it works

`toolshed` is a single Go binary. The TUI is [Bubble Tea](https://github.com/charmbracelet/bubbletea), and MCP is handled by the [official Go SDK](https://github.com/modelcontextprotocol/go-sdk). There are four parts that are most interesting.

## One registry, two agents

Everything you add ends up in one small YAML file, `~/.toolshed/registry.yaml`:

```yaml
tools:
  - id: jira
    command: jira-mcp
    args: [--site, acme]
    inputs:
      - key: JIRA_TOKEN
        secret: true
```

That file is the single source of truth. Installing a tool translates an entry into whatever parameters each agent needs to call the tool properly. For example, for Claude Code that's `claude mcp add-json`, so Claude keeps owning its config format, and when it changes that format, `toolshed` doesn't break.

Codex works slightly different, and running `codex mcp add` ended up replacing the server's table with the defaults (ie every update quietly wipes customization like timeouts, disabled tools and per-tool approvals). It also can't set a few things Codex does support, like a headers helper. So `toolshed` now edits Codex's `config.toml` itself. It only touches the keys it manages and leaves every other byte as it was, comments included. `go-toml`'s parser hands you the byte offset of every key and value, which makes that a lot less scary than it sounds.

Because the registry is just a file, sharing a set of tools with a team means committing it somewhere and pointing `TOOLSHED_REGISTRY` at it. Everyone can then run `toolshed install` and enter their own tokens. If someone later changes what a tool in that file runs, `toolshed update` shows you the change and asks before it hands your token to the new command.

## Secrets go in the keychain

This was the part I cared about most. If a tool has a `secret` input, `toolshed` stores the value in the macOS Keychain (or the [Secret Service](https://specifications.freedesktop.org/secret-service/latest/) on Linux), and registers the server with the agent as a wrapper command instead of the real one:

```sh
toolshed exec jira --secret JIRA_TOKEN=jira -- jira-mcp --site acme
```

The agent's config only contains that line: no token anywhere. When the agent starts the server, `toolshed exec` reads the secrets from the keychain, adds them to the environment, and then *replaces itself* with the real server:

```go
bin, err := exec.LookPath(command[0])
if err != nil {
    return fmt.Errorf("%s: %w", args[0], err)
}
return syscall.Exec(bin, command, shed.ExecEnv(nil, refs))
```

`syscall.Exec` is the `exec` system call: the `toolshed` process becomes `jira-mcp`, with the same process ID and the same stdin and stdout. The agent talks MCP to the real server as if `toolshed` was never there, and there's no wrapper process sitting in the middle forwarding bytes. (It's also why `toolshed` only runs on macOS and Linux: Windows doesn't have an equivalent.)

`toolshed exec` doesn't read the registry either. Everything it needs is in its own arguments, so an installed tool keeps working even if you move or delete your registry file.

Remote servers get the same treatment, with a header instead of an environment variable. The `--header 'Authorization=Bearer ${ACME_TOKEN}'` from earlier registers a headers helper with both agents: a small `toolshed headers acme …` command they run when they connect, which reads the token from the keychain and prints the headers. Again, no token in any config file.

## Does it actually work?

The worst part of the old routine is step 5: finding out if a server is broken only after restarting the agent, and then digging through logs. So `toolshed add` starts the server straight away, does the MCP handshake, and lists the tools it offers (that's the "memory offers 9 tools" above). If that works, Claude Code and Codex will be able to talk to it too, and you have a better idea of what it offers. If it doesn't, you get the error right there in your terminal. Later on, `toolshed doctor` runs the same check on everything you've installed, and also tells you when a secret is missing from the keychain or a tool's command has disappeared from your `PATH`.

## Letting the agent do it

`toolshed` is also an MCP server itself. Run `toolshed install toolshed` and your agent gets `list_servers`, `inspect_server`, `add_server`, `install_server` and `uninstall_server`. Then you can just ask:

> Add the Playwright MCP server, check it starts, and install it for this repo.

The agent finds it and adds it. But since a server is just a command that `toolshed` runs on your machine, and I don't want an agent (or a prompt injection in some README it read) deciding on its own what that command is going to be without adult supervision. So anything the agent adds is *pending*: `toolshed` won't start it, not even to list its tools, until you've approved it. `toolshed approve playwright` shows you exactly what it will run, or you select it in the TUI and press `i`. After that, the agent can check that it starts and installs it.

The other thing it can't do is handle your secrets. I didn't want API tokens ending up in a chat transcript, so if a server needs one, `install_server` refuses, and the agent is told to send you to your terminal to run `toolshed install <id>` so you can type in the token privately. Even if the agent tries to pass a secret along anyway, the tool returns an error telling it never to put secrets in the chat. It also can't replace a tool you already have. That one I only caught while reviewing the code before publishing this: the agent could re-add an existing tool under the same name with a different command, and the new command would have been started with the old tool's token from the keychain. Now it gets an error instead.

# Building your own server

Some tools you want your agent to use don't have an MCP server at all. That's the case for a lot of internal tools in particular. Writing one is less work than it sounds, so the repo includes [`ping-mcp`](https://github.com/bartdegoede/toolshed/tree/main/examples/ping-mcp): a complete MCP server in about 110 lines of Go that sends a push notification to your phone through [ntfy](https://ntfy.sh). It's the one I use the most: "run the the thing and ping me when it's done", and then I go and make coffee.

Copy it, swap in your own tools, and `toolshed add mine -- my-server`.

# Testing without wrecking my own setup

A tool that edits your agents' config is exactly the kind of tool you do not want to test against your real config. The end-to-end tests run the real `toolshed` binary and the real `ping-mcp` server, but against fake `claude` and `codex` programs: small shell scripts that sit first on the `PATH` during testing and record what they were asked to do. Everything runs in a temporary `HOME` with the keychain turned off, so the tests can install, uninstall and break things as much as they like. There are 111 checks, and none of them ever touches my actual `~/.claude.json` (or `~/.codex/config.toml`).

There's a catch though: they only prove that `toolshed` agrees with itself. My fake `codex` happily accepted everything, which is how the settings wipe I mentioned above happened. So there's a second suite that runs `toolshed` against the real `claude` and `codex`, still in a throwaway `HOME`, and asks Codex itself (`codex mcp get --json`) whether it reads back what `toolshed` meant to write. CI runs it on Linux and macOS with pinned versions of both, so when either agent changes how it stores its config, I find out there instead of from a bug report.

# Shipping it

Releases are built by [GoReleaser](https://goreleaser.com): push a tag, and GitHub Actions builds binaries for macOS and Linux (Intel and ARM), creates the GitHub release, and updates a [Homebrew tap](https://github.com/bartdegoede/homebrew-tap). It did not work the first time, because I messed up passing the token to the tap: v0.1.0 built all four binaries and then failed at the very last step. So the first release was v0.1.1. Oh well.

It's at v0.2 by now, and it has a docs site at [toolshed.run](https://toolshed.run). The site is built from the `docs/` folder in the repo, so the docs can't drift from the code, and it looks like the TUI. Yes, you can move through it with `j` and `k`.

# Try it

```sh
brew install bartdegoede/tap/toolshed
# or, with Go 1.26 or newer:
go install github.com/bartdegoede/toolshed/cmd/toolshed@latest
```

Then run `toolshed`, and see [toolshed.run](https://toolshed.run) for the rest. You need Claude Code and/or Codex installed. The code is [on GitHub](https://github.com/bartdegoede/toolshed) under the MIT license; issues and pull requests are welcome, and so is your favorite MCP server for the built-in examples.
