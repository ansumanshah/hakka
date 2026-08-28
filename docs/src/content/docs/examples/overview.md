---
title: Examples
description: Seven runnable examples, one per Hakka integration surface, each with a guided walkthrough.
---

Every integration surface has a runnable example in the repo. Each one has its own README with a
guided walkthrough rather than a bare code dump.

| Example                                                                                                                                                                 | Surface                 | Run it                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| [`examples/next-fullstack`](https://github.com/ansumanshah/hakka/tree/main/examples/next-fullstack)                                                                     | Next.js server + client | `just demo-claude-code`                                        |
| [`examples/claude-code`](https://github.com/ansumanshah/hakka/tree/main/examples/claude-code)                                                                           | MCP / AI agents         | `claude mcp add hakka -- npx -y hakka-cli mcp`                 |
| [`packages/hakka-browser/demo`](https://github.com/ansumanshah/hakka/tree/main/packages/hakka-browser/demo)                                                             | Plain web               | `just demo-browser`                                            |
| [`packages/hakka-react-native/examples/react-native-example`](https://github.com/ansumanshah/hakka/tree/main/packages/hakka-react-native/examples/react-native-example) | React Native            | `just dev-ios` / `just dev-android`                            |
| [`ios/Example`](https://github.com/ansumanshah/hakka/tree/main/ios/Example)                                                                                             | iOS (Swift)             | `just build-ios-demo`                                          |
| [`android/example`](https://github.com/ansumanshah/hakka/tree/main/android/example)                                                                                     | Android (Kotlin)        | `cd android && ./gradlew :example:installDebug`                |
| [`packages/hakka-node/examples/ci-gate`](https://github.com/ansumanshah/hakka/tree/main/packages/hakka-node/examples/ci-gate)                                           | Node CI gate            | `bun test packages/hakka-node/examples/ci-gate/ciGate.test.ts` |

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
