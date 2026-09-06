---
title: Examples
description: Runnable examples for browser, Node, Next.js, desktop, mobile, and traffic assertions.
---

Every integration surface has a runnable example in the repo. Each one has its own README with a
guided walkthrough rather than a bare code dump.

| Example                                                                                                         | Surface                 | Run it                                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------- |
| [`examples/next-fullstack`](https://github.com/ansumanshah/hakka/tree/main/examples/next-fullstack)             | Next.js server + client | `cd examples/next-fullstack && npm ci && npm run dev` |
| [`examples/claude-code`](https://github.com/ansumanshah/hakka/tree/main/examples/claude-code)                   | MCP / AI agents         | `claude mcp add hakka -- npx -y hakka-cli mcp`        |
| [`examples/browser-demo`](https://github.com/ansumanshah/hakka/tree/main/examples/browser-demo)                 | Plain web               | `just demo-browser`                                   |
| [`examples/react-native-example`](https://github.com/ansumanshah/hakka/tree/main/examples/react-native-example) | React Native            | `just dev-ios` / `just dev-android`                   |
| [`ios/Example`](https://github.com/ansumanshah/hakka/tree/main/ios/Example)                                     | iOS (Swift)             | `just build-ios-demo`                                 |
| [`android/example`](https://github.com/ansumanshah/hakka/tree/main/android/example)                             | Android (Kotlin)        | `cd android && ./gradlew :example:installDebug`       |
| [`examples/ci-gate`](https://github.com/ansumanshah/hakka/tree/main/examples/ci-gate)                           | Node CI gate            | `bun test examples/ci-gate/ciGate.test.ts`            |

Other focused examples:

| Example                                                                                                    | Purpose                                                | Run from the repository root after `bun run build`        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| [Desktop bridge](https://github.com/ansumanshah/hakka/tree/main/examples/desktop-bridge)                   | Local capture, redaction, trace, and API-client replay | `node examples/desktop-bridge/run.mjs` (open Hakka first) |
| [Framework servers](https://github.com/ansumanshah/hakka/tree/main/examples/framework-servers)             | HTTP, Express, Fastify, Hono, and Bun capture          | `just demo-node-servers`                                  |
| [Custom inspector panels](https://github.com/ansumanshah/hakka/tree/main/examples/build-your-own-devtools) | Custom elements and React panels                       | `just demo-devtools-panel`                                |
| [Vite](https://github.com/ansumanshah/hakka/tree/main/examples/vite-app)                                   | Plugin integration                                     | `cd examples/vite-app && npm install && npm run dev`      |

Build the SDK packages before running examples. Standalone consumer examples use
their own npm installation; the root Bun workspace installs the React Native,
Expo, and CI-gate examples. See the [complete example index](https://github.com/ansumanshah/hakka/tree/main/examples).

## Where to start

**Next.js full-stack** is the most complete. A client fetch, the route handler it hits, and that
handler's own upstream call land in one inspector, tagged `client` and `server`. It also covers
desktop-mode bridging and production cohort capture. Eleven traffic buttons and an eight-step
checklist that names the real affordance for each step.

**Claude Code** is the one to read if you care about the agent loop. It wires `hakka mcp` into an
MCP client and walks diagnose, mock, verify, and repro against a live app's real captured traffic.
It ships configs for Claude Code, Cursor, VS Code, and Codex.

**The plain web demo** is the fastest way to see the overlay. One command, no framework.

## What each one covers

The examples are kept honest against the capability ledger in
[SPEC.md](https://github.com/ansumanshah/hakka/blob/main/SPEC.md): every shipped capability that
belongs in an example should be reachable from one. If you find a documented feature with no
example that exercises it, that is a bug worth filing.

Both native demo apps and the RN example are built in CI, so a change that breaks them fails the
build rather than rotting quietly. The Next.js example and the Node CI gate are covered by the
`next-fullstack-example` job.
