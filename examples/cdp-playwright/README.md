# Hakka CDP + Playwright example

**Capture a page's real network traffic through Chrome DevTools Protocol and assert on it inside an E2E test.**

`hakka-cli/cdp` maps CDP `Network` domain events to Hakka's canonical `NetworkRequest` records.
It has no dependency on Playwright or Puppeteer: `createCdpCapture` accepts anything shaped like
`{ send(method, params), on(event, cb) }`, and Playwright's own `CDPSession` already satisfies
that shape. This example drives a real page with Playwright, wires its `CDPSession` straight into
`createCdpCapture`, and asserts on what comes back. That's the pattern for checking an app's
actual network behavior in CI instead of stubbing responses.

The repo also has a zero-code path for the same capture, `hakka cdp`, covered at the bottom.

## What this exercises

- `createCdpCapture` (`hakka-cli/cdp`) fed a real Playwright `CDPSession` with no adapter layer
- The CDP to `NetworkRequest` mapping for a full page load: document, two successful `fetch()`
  calls, and one that 404s
- The three-emission model (pending, then status known, then final) collapsed into one record
  per request by deduping on `id`
- Response body capture (`captureBody: true` by default) on a real response

## Run it

Chromium needs to be installed once. `@playwright/test` is already a dependency of
`hakka-browser`, so the binary may already be on this machine:

```bash
npm install
npx playwright install chromium   # skip if already installed
npm test
```

Or from the repo root, which also builds `hakka-cli`'s dist dependencies first:

```bash
just example-cdp-playwright
```

Expect:

```
Running 1 test using 1 worker

  ✓  1 tests/network-capture.spec.ts:18:1 › captures the page network traffic and asserts on it

  1 passed
```

### Why `npm`, not `bun`

None of the `hakka-*` packages are published yet, so `package.json` points `hakka-cli` at a
`file:` dependency and overrides its transitive `hakka-core`/`hakka-bridge`/`hakka-node` deps to
the same local directories (see the `//overrides` note in `package.json`). This directory lives
outside the root npm workspace on purpose, so it resolves `hakka-cli/cdp` exactly the way an
outside consumer would, rather than through hoisted monorepo `node_modules`. `npm` lays a `file:`
dependency out as a real directory; `bun` symlinks per file instead, which the package's `exports`
map doesn't resolve the same way.

## What the test does

`tests/network-capture.spec.ts`:

1. Starts a fixture HTTP server (`fixtures/demo-server.ts`) that serves a page firing three
   `fetch()` calls on load: two succeed, one 404s.
2. Opens a Playwright page and a `CDPSession` on it (`page.context().newCDPSession(page)`).
3. Passes that session straight to `createCdpCapture({ transport: session, onRequest })`, keyed
   by `req.id` in a `Map` since a request emits multiple times as it moves from pending to final.
4. Navigates to the fixture page and waits for all three API calls to reach their final state.
5. Asserts on the captured records: status codes, method, and that the response body of
   `/api/users` actually contains the JSON it served.

Playwright's `CDPSession` type and Hakka's `CdpTransport` interface aren't structurally identical
in TypeScript's eyes (Playwright's `send` is overloaded per CDP method name), so the test casts
through `unknown`. At runtime they're the same object doing the same job: CDP itself defines
`send`/`on`, and Hakka just describes that shape independently instead of depending on
Playwright's types.

## The CLI alternative: `hakka cdp`

For a running Chrome/Chromium instance you don't want to write capture code for, `hakka cdp`
attaches over the DevTools Protocol debugging port and streams the same `NetworkRequest` records
to a `hakka-bridge` hub, where the browser overlay (or any other bridge peer) renders them:

```bash
# Launch Chrome with a debugging port, then:
npx hakka-cli cdp --port 9222

# Usage: hakka cdp [--url ws://.../devtools/page/<id>] [--port <n>] [--target <substr>]
#                   [--bridge-url ws://host:port] [--no-body] [--max-body-size <n>]
```

| Flag              | Default               | What it does                                                                             |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `--url`           | none                  | Explicit `ws://.../devtools/page/<id>`. Skips target discovery entirely.                 |
| `--port`          | `9222`                | Chrome's `--remote-debugging-port` to discover a target on.                              |
| `--target`        | first `page` target   | Case-insensitive substring match against a discovered target's URL or title.             |
| `--bridge-url`    | `ws://localhost:8989` | The `hakka-bridge` hub to stream captured records to.                                    |
| `--no-body`       | bodies captured       | Skip the `Network.getResponseBody` round-trip; status/headers/timing are still captured. |
| `--max-body-size` | `102400` (100 KB)     | Cap applied to non-base64 (text) response bodies.                                        |

`hakka cdp` runs until `Ctrl+C` or the debuggee's socket closes, cleaning up on either. It's
verified end to end in this repo: launch Chrome headless with `--remote-debugging-port`, start a
`hakka-bridge` hub, run `npx hakka-cli cdp --port <port> --bridge-url ws://localhost:8989`, and a
second peer connected to the hub receives the same `NetworkRequest` frames this example's test
asserts on directly.

## When to use each

**`createCdpCapture` in your own script or test** (this example): you want the records in
process, to assert on them, log them, or write them to a file. No bridge hub, no separate CLI
process; `capture.start()`/`capture.stop()` scope the capture window exactly to the test.

**`hakka cdp`**: you already have a Chrome instance running (a manual debugging session, an
Electron app, a browser launched by something other than your own script) and want its traffic to
show up in the Hakka overlay or another bridge peer, with zero code.

Both paths go through the same `createCdpCapture`/`createCdpMapper`. `hakka cdp` is this
example's capture wired to `bridge().send` instead of a test assertion. See
[`docs/src/content/docs/cdp/overview.md`](../../docs/src/content/docs/cdp/overview.md) for
the full option and emission-model reference (redirects, redaction, the binary-body handling, and
`createCdpCaptureSource` for wiring CDP into a `CaptureSource`-based host).
