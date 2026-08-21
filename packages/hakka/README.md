# hakka (CLI)

Five commands: `init` wires the [Hakka](https://github.com/ansumanshah/hakka) network inspector into your app, `diagnose` prints a ranked diagnosis of a saved capture, `assert` gates CI on it, `mcp` exposes live captured traffic to AI agents over the Model Context Protocol, and `cdp` streams Chrome DevTools Protocol captures to a bridge hub. `mcp`/`cdp` are also importable directly as `hakka/mcp` and `hakka/cdp` for embedding.

## `hakka init`

Detects your framework and does the setup.

```bash
npx hakka init
```

- **Next.js** — creates `instrumentation.ts` + `instrumentation-client.ts` (server + client capture, embedded bridge) and prints the install command.
- **Vite** — prints the `hakka-browser/vite` plugin snippet for `vite.config`.
- **Expo / React Native** — prints the `hakka-react-native` monitor snippet.
- **Anything else** — the `hakka-browser` drop-in (`start()` or a CDN `<script>`).

Safe + idempotent: it only **creates** files that don't exist and never edits or clobbers yours. Pass `--no-install` (or `--dry-run`) to skip running the install command and just print it.

## `hakka diagnose`

Loads a saved `.hakka` session or `.har` capture from disk and pretty-prints a ranked diagnosis — the same `analyzeRequests` engine that backs the MCP `diagnose` tool: failures with a likely cause, slow requests, plaintext secrets in request bodies, oversized responses, uncacheable GETs, N+1/repeated fetches, plus the slowest requests and a one-line summary.

```bash
hakka diagnose capture.hakka
hakka diagnose capture.har --slow-ms 500
```

Exits non-zero (`1`) when any request failed.

## `hakka assert`

Loads a saved `.hakka` session or `.har` capture and exits non-zero when configured thresholds are violated. Built for CI gating — e.g. "fail the build if this recorded session has a failing request or a leaked secret".

```bash
hakka assert capture.hakka --max-failures 0 --fail-on-secrets
hakka assert capture.har --max-duration-ms 2000 --budget-p95-ms 800
```

| Flag                    | Effect                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| `--max-failures <n>`    | Fail if more than `n` requests failed (error or status >= 400). Default `0`. |
| `--max-duration-ms <n>` | Fail if any request took longer than `n` ms.                                 |
| `--fail-on-secrets`     | Fail if any plaintext secret was found in a request body.                    |
| `--budget-p95-ms <n>`   | Fail if the p95 request duration exceeds `n` ms.                             |
| `--slow-ms <n>`         | Threshold (ms) for the underlying "slow request" finding.                    |

Exit codes: `0` pass, `1` fail (a threshold was violated), `2` bad input (missing file, unreadable, unparseable).

## `hakka mcp`

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing your app's **live captured network traffic** to AI coding agents (Claude Code, Cursor, etc.). It connects to a running [Hakka bridge hub](https://github.com/ansumanshah/hakka/tree/main/packages/hakka-bridge) — every request the hub relays (from `hakka-browser`, `hakka-node`'s Next.js capture, or a React Native app) flows into an in-process store an agent can query, then act on: mock an endpoint, throttle the connection, set a breakpoint.

```bash
npx hakka mcp                        # host a hub on :8989 if free, else connect to it
npx hakka mcp --url ws://host:8989   # explicit bridge URL
npx hakka mcp --port 9000            # shorthand for ws://localhost:9000
npx hakka mcp --no-serve             # never host a hub; only connect as a client
```

Wire it into an MCP client config (Claude Code `.claude/settings.json`, Claude Desktop `claude_desktop_config.json`, Cursor, ...):

```json
{
  "mcpServers": {
    "hakka": {
      "command": "npx",
      "args": ["-y", "hakka", "mcp"]
    }
  }
}
```

| Env var                  | Default               | Description                                           |
| ------------------------ | --------------------- | ----------------------------------------------------- |
| `HAKKA_BRIDGE_URL`       | `ws://localhost:8989` | Bridge hub WebSocket URL to subscribe to              |
| `HAKKA_MCP_MAX_REQUESTS` | `500`                 | In-memory store capacity (ring buffer)                |
| `HAKKA_MCP_SERVE=0`      | unset                 | Disable in-process hub hosting (same as `--no-serve`) |

Read tools: `list_requests`, `get_request`, `search_requests` (see the query DSL below), `stats`, `diagnose`, `clear`, `generate_test`, `generate_repro`. Write tools (relayed to your app over the bridge, dev builds only): `create_mock`, `promote_capture_to_mock`, `delete_mock`, `clear_mocks`, `set_breakpoint`, `delete_breakpoint`, `set_throttle`, `generate_mocks`. All logging goes to **stderr** — stdout is the JSON-RPC channel.

`search_requests`'s `query` param: `url:`/`header:`/`body:` scopes, `/regex/`, `*glob*`, `-negation`, `dur>100`/`size>1kb` ranges, space-separated tokens ANDed.

Also importable directly: `import { main, RequestStore, registerTools } from 'hakka/mcp'`.

## `hakka cdp`

Attaches to a live Chrome/Chromium instance over its DevTools Protocol debugging port and streams `Network` captures to a bridge hub — no Playwright or Puppeteer required.

```bash
npx hakka cdp                                   # attach to :9222, first page target
npx hakka cdp --port 9223 --target checkout     # pick a target by URL/title substring
npx hakka cdp --url ws://127.0.0.1:9222/devtools/page/ABC123
npx hakka cdp --bridge-url ws://host:8989       # stream to a non-default bridge
```

Requires Chrome running with `--remote-debugging-port=<port>` (default `9222`). Runs until Ctrl+C.

| Flag                  | Effect                                                        |
| --------------------- | ------------------------------------------------------------- |
| `--url <ws-url>`      | Explicit CDP debugger WebSocket URL — skips target discovery. |
| `--port <n>`          | Chrome's `--remote-debugging-port`. Default `9222`.           |
| `--target <substr>`   | Case-insensitive match against a target's URL/title.          |
| `--bridge-url <url>`  | Bridge hub to stream to. Default `ws://localhost:8989`.       |
| `--no-body`           | Skip fetching decoded response bodies.                        |
| `--max-body-size <n>` | Cap on captured (non-base64) response body size, bytes.       |

For embedding in a Playwright/Puppeteer script instead, use the library directly: `import { createCdpCapture, bridge } from 'hakka/cdp'` — `createCdpCapture` accepts any transport shaped like `{ send(method, params), on(event, cb) }`, so a `CDPSession` from either library plugs in without an adapter.

## License

MIT
