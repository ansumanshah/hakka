# Hakka + Claude Code

A ready-made `/hakka-debug` slash command that drives the Hakka MCP loop: find a failing or slow
request, explain it, mock a fix in the running app, and package a repro bundle with a regression
test.

## Install

1. Wire up the MCP server (once per project):

   ```bash
   claude mcp add hakka -- npx -y hakka-cli mcp
   ```

   `hakka mcp` hosts its own bridge hub, so no separate `hakka-bridge` process is needed. Point
   your app's bridge at `ws://localhost:8989` (the default). See the
   [MCP docs](https://hakka.noodleapps.com/mcp/overview) for the full setup.

2. Copy `hakka-debug.md` into your project's `.claude/commands/`:

   ```bash
   mkdir -p .claude/commands
   curl -o .claude/commands/hakka-debug.md \
     https://raw.githubusercontent.com/ansumanshah/hakka/main/examples/claude-code/commands/hakka-debug.md
   ```

## Use

Run your app so it makes a request, then in Claude Code:

```
/hakka-debug checkout is returning 500
```

Claude will call `diagnose`, explain the failure, propose a fix, and (after you confirm) apply a
mock and write out a `.hakka-repro` bundle. It never changes traffic without your go-ahead.

## Other MCP clients (Cursor, etc.)

There is no slash-command file, but the same prompt works. Paste this, filling in the issue:

> The Hakka MCP server is connected. Using its tools, debug this against my app's live traffic:
> **\<what's wrong\>**. Call `diagnose` first to find the failing request and its likely cause,
> explain it in a sentence, propose the smallest fix (`create_mock` / `set_throttle`) and wait for
> my go-ahead before applying it, then `generate_repro` once the fix is confirmed. The change tools
> affect the dev build only.
