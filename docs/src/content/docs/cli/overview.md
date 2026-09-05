---
title: CLI
description: npx hakka-cli init detects your framework and wires up Hakka with zero dependencies.
---

`npx hakka-cli init` reads your project's `package.json` and config files, detects the
framework, and either creates the required files for you or prints the exact snippet
to paste. No installs needed to run it.

```bash
npx hakka-cli init
```

The CLI has no runtime dependencies — it ships as a single ESM file built from
`packages/hakka-cli/src/cli.ts`. `mcp` and `cdp` are dynamically imported inside their own
command branches, so a plain `hakka init` never loads `@modelcontextprotocol/sdk`,
`zod`, or `ws`.

## Other commands

`init` is the one most people run, but the same binary also provides:

| Command                                                  | What it does                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hakka diagnose <file.hakka\|file.har>`                  | Load a saved session or HAR capture from disk and pretty-print a ranked diagnosis to the terminal — the same `analyzeRequests` engine that backs the MCP `diagnose` tool. |
| `hakka assert <file.hakka\|file.har>`                    | Same engine, built for CI gating: exits non-zero when configured thresholds (`--max-failures`, `--max-duration-ms`, `--fail-on-secrets`, `--budget-p95-ms`) are violated. |
| `hakka ci-baseline check <capture.hakka> <baseline.txt>` | Compare captured traffic with a committed API baseline and fail on blocking drift or exfiltration risk.                                                                   |
| `hakka mcp`                                              | Start the stdio MCP server exposing captured traffic to AI agents. See [MCP overview](/mcp/overview/).                                                                    |
| `hakka cdp`                                              | Attach to a Chrome DevTools Protocol debugging port and stream Network captures to a bridge hub — no Playwright/Puppeteer needed. See [CDP overview](/cdp/overview/).     |

Both CI checks accept `--json`. JSON mode emits exactly one versioned document and keeps the human command's exit codes: `0` pass, `1` policy failure, and `2` invalid input. Reports omit raw messages, file paths, bodies, headers, and URL paths while retaining structured rules, finding kinds, severity, scrubbed origins, and opaque references.

```bash
hakka assert capture.har --fail-on-secrets --json
hakka ci-baseline check capture.hakka baseline.txt --json
```

## Framework detection

Detection runs in this order, stopping at the first match:

| Framework     | Signal                                           |
| ------------- | ------------------------------------------------ |
| Expo          | `expo` in `dependencies` or `devDependencies`    |
| Next.js       | `next` dep, or `next.config.{js,mjs,ts}` present |
| React Native  | `react-native` in dependencies                   |
| Vite          | `vite` dep, or `vite.config.{js,mjs,ts}` present |
| Web (drop-in) | fallback — no other framework detected           |

Expo is checked before React Native because an Expo project has both `expo` and
`react-native` in its dep tree.

## Next.js

Requires Next.js 15.3 or later (instrumentation-client hooks).

`npx hakka-cli init` prints the install command and creates two files:

```
instrumentation.ts          ← server-side capture + embedded bridge
instrumentation-client.ts   ← overlay + client-side connect
```

If a `src/` directory exists the files are placed under `src/`; otherwise they go in
the project root.

File contents written:

```ts
// instrumentation.ts
// Hakka — server-side capture + embedded bridge (dev only).
export { register } from 'hakka-node/next'
```

```ts
// instrumentation-client.ts
// Hakka — overlay + connect on the client (Next 15.3+, dev only).
import 'hakka-node/next/client'
```

Install command printed by the CLI:

```bash
npm i -D hakka-node && npm i hakka-browser
```

After install, run `next dev` and open the overlay — server and client requests appear
in one UI. See [/web/overview/](/web/overview/) for overlay options.

## Vite

`npx hakka-cli init` prints the install command and the plugin snippet to add to
`vite.config`:

```bash
npm i hakka-browser
```

```ts
import hakka from 'hakka-browser/vite'
export default defineConfig({ plugins: [hakka()] })
```

The plugin auto-injects the overlay in dev builds only. No files are created on disk.

## Expo

`npx hakka-cli init` prints the install and usage snippet:

```bash
npm i hakka-react-native
```

```tsx
import { HakkaMonitor } from 'hakka-react-native/ui'
// ...
{
  __DEV__ && <HakkaMonitor />
}
```

The CLI also notes that the Expo config plugin wires native capture during `prebuild`.
See [/getting-started/install/](/getting-started/install/) for the full Expo setup
including `expo-dev-client` and the `plugins` entry.

## React Native

Same snippet as Expo, without the config-plugin note:

```bash
npm i hakka-react-native
```

```tsx
import { HakkaMonitor } from 'hakka-react-native/ui'
{
  __DEV__ && <HakkaMonitor />
}
```

No files are created on disk. Shake the device or long-press the bubble to open the inspector; a tap expands a quick summary in place.

## Web (drop-in)

When no framework is detected, the CLI prints both npm and CDN options:

```bash
npm i hakka-browser
```

```ts
import { start } from 'hakka-browser'
start()
```

Or via script tag with no build step:

```html
<script async src="https://unpkg.com/hakka-browser/dist/hakka-browser.global.js"></script>
<script>
  addEventListener('load', () => Hakka.start())
</script>
```

## Idempotency

For Next.js (the only framework where the CLI writes files), `init` checks each target
path before writing. If the file already exists it is left untouched and the CLI prints
a notice. Re-running `npx hakka-cli init` is always safe.

For all other frameworks the CLI only prints instructions — it never touches your files.
