# Hakka + Claude Code

A ready-made `/hakka-debug` slash command that drives the full Hakka MCP loop: find a failing or
slow request, explain it, mock or throttle a fix in the running app, verify the fix actually
worked, then package a repro bundle with a regression test. Configs for Cursor, VS Code, and
Codex are included too, since the MCP server itself is not Claude Code specific.

## Install

1. **Add Hakka to your app**, so it has traffic to stream. Follow the
   [install guide](https://hakka.noodleapps.com/getting-started/install/) for your platform (web,
   Next.js, React Native, iOS, Android). Everything below assumes the default bridge port,
   `ws://localhost:8989`.

2. **Register `hakka mcp` with Claude Code** (once per project):

   ```bash
   claude mcp add hakka -- npx -y hakka-cli mcp
   ```

   `hakka mcp` hosts its own bridge hub, so no separate `hakka-bridge` process is needed: it hosts
   a hub on `:8989` if the port is free, or connects to one that is already running there (your
   app's embedded hub, or a `hakka-bridge` you started yourself). See the
   [MCP docs](https://hakka.noodleapps.com/mcp/overview) for the full setup and every tool.

3. **Copy `hakka-debug.md` into your project's `.claude/commands/`:**

   ```bash
   mkdir -p .claude/commands
   curl -o .claude/commands/hakka-debug.md \
     https://raw.githubusercontent.com/ansumanshah/hakka/main/examples/claude-code/commands/hakka-debug.md
   ```

## Try it now, no app of your own required

[`examples/next-fullstack`](../next-fullstack) is a real Next.js app, two directories over, that
already streams both server and client traffic to `ws://localhost:8989`. Point `hakka mcp` at it
and the whole loop is runnable in about a minute:

```bash
# terminal 1, from the repo root
just demo-claude-code
# (equivalent to: cd examples/next-fullstack && npm install && npm run dev)
```

```bash
# terminal 2, from your project (or this repo's root, either works)
claude mcp add hakka -- npx -y hakka-cli mcp
```

Then open [http://localhost:3000](http://localhost:3000), tap **"Fail on purpose"** under
Generate traffic (or the round inspector button, bottom-right, to watch it happen), and in Claude
Code:

```
/hakka-debug the fail button on the demo page always 500s
```

Claude calls `diagnose`, finds the `GET /api/demo/fail` failure, proposes a `create_mock`, applies
it after you confirm, and you can click the same button again to watch the response flip from a
real `500` to the mocked `200` live. This exact sequence, `diagnose` finding the failure and
`create_mock` intercepting the next click, was run and confirmed against a live `npm run dev`
while writing this example (see "What was verified" below).

Other cards worth pointing `/hakka-debug` at: **"Run slow request"** (`/api/demo/slow`, ~2.5s, a
`set_throttle`/timing case instead of a status-code one), **"Fetch products"** (client hop then a
server-side upstream call, good for `get_trace`), and **Burst** (fires eight requests at once,
good for `stats`).

## Use against your own app

Run your app so it makes at least one request, then in Claude Code:

```
/hakka-debug checkout is returning 500
```

Claude works the loop end to end: `diagnose` to find and explain, a proposed fix that waits for
your go-ahead, `verify_fix` (or `replay_request`) to prove the fix actually worked instead of just
asserting it, `generate_repro` to package the failure, then removes the mock/breakpoint/throttle
it installed so the dev app is not left running with a debugging-session mock as its real
behavior. It never changes traffic without confirmation.

## The full tool set

`hakka mcp` ships 21 tools. `/hakka-debug` exercises the core loop; the rest are there for the
agent (or you, in a plain prompt) to reach for as the situation calls for it.

**See** (read the buffer)

| Tool              | What it does                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `list_requests`   | Paginated, newest-first list of captured requests.                                                                        |
| `get_request`     | One request by id, full headers/body/timing.                                                                              |
| `search_requests` | Filter by method/status/runtime, or the `query` DSL below.                                                                |
| `stats`           | Totals, error rate, status/method breakdown, slowest.                                                                     |
| `clear`           | Empty the in-memory store (capture keeps running).                                                                        |
| `get_trace`       | Full request+span trace for one correlated operation, e.g. a client call and the server-side upstream fetch it triggered. |

**Diagnose**

| Tool           | What it does                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnose`     | One call: ranked failures with a likely cause, slow requests, secrets in bodies, oversized responses, uncacheable GETs, N+1 fetches, a one-line summary. Prefer this over paging raw requests. |
| `detect_leaks` | Is a credential or PII going somewhere it shouldn't (a token sent to a third-party host, PII in a query string, a secret in a cacheable response)? Every finding carries its evidence.         |

**Change** (dev builds only, fire-and-forget over the bridge)

| Tool                      | What it does                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_mock`             | Add a mock (canned response), block, or redirect rule matching a URL pattern.                                                                                                                                                                                                                                                               |
| `promote_capture_to_mock` | Freeze an already-captured response into a mock rule and install it, faster than hand-authoring `create_mock` when the goal is "pin last-known-good while I fix the backend."                                                                                                                                                               |
| `delete_mock`             | Remove one mock rule by id.                                                                                                                                                                                                                                                                                                                 |
| `clear_mocks`             | Remove every mock rule.                                                                                                                                                                                                                                                                                                                     |
| `set_breakpoint`          | Pause matching requests or responses for inspection/editing.                                                                                                                                                                                                                                                                                |
| `delete_breakpoint`       | Remove one breakpoint by id.                                                                                                                                                                                                                                                                                                                |
| `set_throttle`            | Simulate network conditions (`fast-3g` / `slow-3g` / `edge` / `offline` / `custom`).                                                                                                                                                                                                                                                        |
| `replay_request`          | Re-issue a captured request as a real call and wait for it to be recaptured. The "did my fix actually work" primitive. Refuses three cases: websocket captures, Next.js server/edge captures, and any request whose headers were redacted at capture time (replaying would send the literal string `[REDACTED]` and look like an auth bug). |
| `verify_fix`              | `create_mock` (optional) then `replay_request` then check the outcome (`status` / `bodyContains` / `maxDurationMs`) in one call.                                                                                                                                                                                                            |

**Reproduce** (read-only, returns content for the agent to write to disk)

| Tool              | What it does                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `generate_mocks`  | "Record, then mock": turn captured traffic into mock rules, one per (method, path).                                                  |
| `generate_test`   | Turn captured traffic into a runnable `hakka-core/test` file (vitest/bun/jest).                                                      |
| `generate_repro`  | One bundle: the requests, the mocks that replay them, and a generated regression test. Everything to hand a failure to someone else. |
| `export_evidence` | A size-budgeted bundle (requests, mocks, trace, diagnosis) for CI or a bug report.                                                   |

`list_requests`, `get_request`, `search_requests`, `export_evidence`, and `generate_repro` scrub
likely secrets before returning; pass `unredacted: true` to see a request exactly as captured. See
[Share Scrubbing](https://hakka.noodleapps.com/spec/share-scrubbing/) for exactly what that does
and does not catch.

### The `query` DSL

`search_requests`, `diagnose`, `detect_leaks`, `generate_mocks`, `generate_test`, and
`generate_repro` all accept the same `query` string:

- Scopes: `url:foo`, `header:foo`, `body:foo`. No prefix searches all three.
- `/regex/` for a case-insensitive regex, `*glob*` for wildcards, plain text for a substring.
- `-token` negates. Space-separated tokens are ANDed. Quote phrases with spaces: `"exact phrase"`.
- Ranges: `dur>100`, `dur<=500` (ms); `size>1kb`, `size<2mb`.

Example: `url:/checkout -body:password dur>1000` finds slow checkout calls with no password field.

## Cleanup matters

Every `Change` tool acts on your **running dev app**, not a copy of it. A mock or breakpoint
created mid-debugging session keeps masking the app's real behavior until something removes it,
which is easy to forget once the bug is actually fixed. `/hakka-debug`'s last step calls
`delete_mock` / `delete_breakpoint` (or `clear_mocks` for a clean sweep) once you have confirmed
the real fix. If you skip the slash command and drive the tools by hand, do the same before you
move on.

## Other MCP clients

`hakka mcp` is a standard stdio MCP server, nothing about it is Claude Code specific. The
[`configs/`](./configs) directory in this example has copy-paste server entries for four setups:

| Client                                    | File                                                       | Where it goes                                                                         |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Claude Code, Windsurf, any generic client | [`configs/mcp.json`](./configs/mcp.json)                   | `.mcp.json` at your project root                                                      |
| Cursor                                    | [`configs/cursor-mcp.json`](./configs/cursor-mcp.json)     | `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)                         |
| VS Code                                   | [`configs/vscode-mcp.json`](./configs/vscode-mcp.json)     | `.vscode/mcp.json`                                                                    |
| Codex CLI                                 | [`configs/codex-config.toml`](./configs/codex-config.toml) | `~/.codex/config.toml`, or run `codex mcp add hakka -- npx -y hakka-cli mcp` directly |

Every one of these launches the exact same `npx -y hakka-cli mcp` process; only the file shape and
the top-level key (`mcpServers` vs VS Code's `servers`, plus its required `"type": "stdio"`)
differ between clients.

There is no slash-command file outside Claude Code, but the same prompt works anywhere tools are
exposed to the model. Paste this, filling in the issue:

> The Hakka MCP server is connected. Using its tools, debug this against my app's live traffic:
> **\<what's wrong\>**. Call `diagnose` first to find the failing request and its likely cause,
> explain it in a sentence, propose the smallest fix (`create_mock` / `set_breakpoint` /
> `set_throttle`) and wait for my go-ahead before applying it, then `verify_fix` or
> `replay_request` to confirm it actually worked, then `generate_repro` once confirmed. Remove any
> mock or breakpoint you installed (`delete_mock` / `delete_breakpoint`) once the real fix ships.
> The change tools affect the dev build only.

## What was verified

Everything above was run against a live `hakka mcp` process connected to a real
`examples/next-fullstack` dev server, not asserted from reading the source:

- `claude mcp add hakka -- npx -y hakka-cli mcp` is a real, current `claude mcp add` invocation
  (checked against `claude mcp add --help`) and `hakka-cli`'s built CLI accepts exactly the flags
  documented above (checked against its own usage output).
- All 21 tools listed above were enumerated live from a running `hakka mcp --no-serve` process
  (`tools/list` over stdio), matching `packages/hakka-cli/src/mcp/tools/index.ts` and the docs
  site's count exactly.
- Clicking **"Fail on purpose"** in a browser produced a real captured request; `diagnose` scoped
  to `url:/api/demo/fail` found it with a correct one-line finding.
- `create_mock` on `/api/demo/fail` (`pattern`, `mode: "mock"`, `status: 200`, `body`) changed the
  next click's real response from `500` in 69ms to the mocked `200` in 3ms; `delete_mock` removed
  it and the next click was a real `500` again.
- `detect_leaks` ran cleanly against the captured session with no findings.
- `commands/hakka-debug.md` itself was run through `claude -p "/hakka-debug the fail button on
the demo page always 500s"` against this exact setup, not just read. It called `diagnose`,
  correctly explained the 500, proposed a `create_mock`, and stopped, unprompted, waiting for
  a "go" rather than applying anything in a single non-interactive turn. When continued, a
  second parallel agent had restarted the shared demo server mid-run (a hazard of this sandbox,
  not the example) and the capture it needed no longer existed; rather than claim the fix worked
  anyway, it reported `verify_fix` returned `not_found`, named the state its mock might be left
  in, and asked for one more click before packaging a repro. That is step 3's rule ("do not just
  tell me the fix should work, show me") holding under a real failure, not just the happy path.
