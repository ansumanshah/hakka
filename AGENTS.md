# Hakka Agent Guide

Hakka is a local-first network inspector that captures traffic in-process across
React Native, the web, Next.js, Android, and iOS. Use the Hakka name everywhere
in public code, docs, tests, and APIs.

Pre-1.0, not yet published. The first release publishes 7 npm packages plus
Android Maven artifacts and an iOS Swift Package. The macOS app lives in `apps/hakka/`.

## Packages

```
packages/
  hakka-core/           hakka-core — platform-neutral capture engine (one dep: fflate)
                         + /test subpath — assert-on-captured-traffic test helpers
  hakka-react-native/   hakka-react-native — RN SDK + native bridge + UI + example app
  hakka-browser/        hakka-browser — browser overlay (Solid, Shadow DOM, Web Worker store)
                         + /elements/* subpaths — standalone inspector pieces as custom elements
                         + /react subpath — thin React wrappers over the elements
  hakka-node/           hakka-node — server-side capture for Node backends (Express/Fastify/Hono/raw http)
                         + /next, /next/server, /next/client subpaths — full-stack Next.js capture
  hakka-bridge/         hakka-bridge — desktop WebSocket hub for cross-runtime capture
  hakka-rozenite/       hakka-rozenite — EXPERIMENTAL React Native DevTools panel via Rozenite
  hakka-cli/            hakka-cli — `npx hakka-cli init` framework-aware setup
                         + /mcp subpath, `hakka mcp` — MCP server exposing live traffic to AI agents
                         + /cdp subpath, `hakka cdp` — Chrome DevTools Protocol capture (Playwright/Puppeteer/raw CDP)
android/                Kotlin SDK modules (Gradle) — see Android Notes
ios/                    Swift Package — canonical iOS sources (xed ios/)
docs/                   Astro/Starlight — single source of truth for public docs
examples/next-fullstack/  Next.js full-stack capture demo
fixtures/               Shared Hakka record fixtures (pinned wire contract)
scripts/                Build, sync-gate, benchmark, and CI helper scripts
design-tokens.json      Single source of truth for colors (synced per platform)
.claude-plugin/skills/  Integration guides (integrate-android/ios/react-native/expo,
                        capture-modes-and-privacy, network-mocking)
artifacts/              Build outputs and benchmark results — never commit
```

`hakka-core` is the shared engine; `hakka-react-native`, `hakka-browser`, and
`hakka-node` consume it through injectable adapters. The record contract
(`RECORD_SCHEMA_VERSION`) is the cross-platform wire format.

## Current Priority

Core engine, bridge, web overlay, Next.js capture, breakpoints, mocking, the MCP
server, and native iOS/Android capture are all functionally complete and tested.

Current focus is **open-source launch readiness**:

1. SDK correctness and capture-mode parity across platforms.
2. Docs-site accuracy — `docs/` is the single source of truth for public docs.
3. Pre-publish: package shape, exports, coordinated versioning, CI publish for all
   7 npm packages + Android Maven + iOS SPM tag.

Broad UI redesign work remains deferred until the release is out.

## Commands

CI-essential scripts live in root `package.json`; day-to-day developer workflows
live in the `justfile` (run `just` to list all recipes).

```bash
bun install --frozen-lockfile

# JS/TS (root package.json — these are what CI runs)
bun run typecheck            # all 7 packages
bun run build                # all 7 packages
bun run test                 # all 7 packages
bun run lint                 # oxlint
bun run fmt:check            # oxfmt
bun run cleanup:check        # knip dead-code audit
bun run pack:npm:dry-run     # npm package contents preview (all 7)

# Native
bun run build:android        # Gradle build for the Android SDK modules
bun run test:android
bun run build:ios            # swift build
bun run test:ios             # swift test

# Docs
bun run docs:dev
bun run docs:build

# Release gates
bun run phase:verify:ci      # CI-safe release confidence path
bun run phase:verify         # local phase handoff confidence path
bun run phase:verify:full    # full build/test gate; physical benchmarks are separate
```

Local convenience (justfile):

```bash
just                  # list every recipe
just preflight-fast   # typecheck + build + test + fast native compile
just preflight        # full build/test across all platforms
just dev-ios          # run the RN example app on iOS Simulator
just dev-android      # run the RN example app on Android
just xcode-core       # open the iOS Swift package in Xcode
just studio-core      # open the Android modules in Android Studio
just xcode / just studio   # open the RN example native projects
just sync-ios         # regenerate the RN package's iOS sources from ios/Sources
just sync-tokens      # regenerate per-platform design-token mirrors
just version-audit    # audit version numbers across modules
```

Prefer the fast variants during local implementation; the full build/test paths
are the release/CI confidence path.

## Android Notes

- Modules: `hakka-common`, `hakka-network`, `hakka-network-noop`,
  `hakka-performance`, `hakka-performance-noop`, `hakka-ui`
- Group: `com.noodleapps.hakka`, version `0.1.0`
- AGP `8.13.2`, Kotlin `2.2.21`, Gradle `8.13`. The AGP 9.x / Gradle 9.x upgrade
  is intentionally deferred — do not bump without a deliberate decision.
- Run Gradle from `android/` or use the root `bun run build:android` script.

## iOS Notes

- Swift Package products: `HakkaCommon`, `HakkaNetwork`, `HakkaNetworkNoop`,
  `HakkaPerformance`, `HakkaPerformanceNoop`, `HakkaUI`
- `ios/Sources` is canonical. `packages/hakka-react-native/ios/Core` is
  **generated** from it via `just sync-ios` — never hand-edit the generated copy.
- Build/test: `bun run build:ios` / `bun run test:ios`. Open Xcode: `just xcode-core`.

## Capture Modes

- `'native'` — TurboModule; `'js'` — fetch/XHR/WS intercept; `'auto'` — prefer
  native, fallback js; `'store'` — pure aggregator (hosts the engine off-thread,
  e.g. in a Web Worker); `'disabled'`.

## Architecture Rules

- Android and iOS SDKs own capture, redaction, storage, export, and noop behavior.
- React Native, web, and Next.js wrap `hakka-core` and add JS/runtime capture
  where native APIs cannot observe traffic.
- The canonical model is the Hakka record contract.
- Core modules are UI-less and dependency-light.
- Hakka is local-first: no default cloud upload.
- Sensitive headers are redacted before records reach stores, UI, exports, or
  desktop streaming.
- Interceptors capture raw facts and return quickly. Processors perform filtering,
  redaction, mapping, storage, and notification.
- Code comments must describe Hakka behavior directly. Do not reference, compare
  against, or credit other libraries, tools, or apps in source-code comments. Keep
  competitor/reference citations in research docs only.

## Code Conventions

- Files: `PascalCase.ts`/`.tsx` holds one class or component, named for it.
  `camelCase.ts` is a function module. Folders are domain nouns (`capture/`,
  `query/`) — never `helpers/`, `misc/`, `lib/`.
- Methods are verb-first, no abbreviations. Boolean getters read `is`/`has`/
  `should`. Name a function for its effect (`redactHeaders`, not `processHeaders`).
- One exported concept per file. If describing a file needs "and", split it.
- ~300 lines is a review trigger — split by concern, not by line count.
- Public API is a curated `index.ts` per package, with subpath exports for the
  advanced surface.
- Tests are genuine behavioral tests and benchmarks only: no tautologies, no
  mock-testing-mocks, no cross-package duplicates of core coverage, no existence
  checks. Benches are untouchable.
- TS style: `interface` for shapes, `type` for unions; string-literal unions over
  `enum`; `catch (e: unknown)` with `instanceof` narrowing.

## Docs

`docs/` (Astro/Starlight) is the single source of truth for public documentation —
install, capture modes, the core engine, web/Next.js/Vite/CLI/bridge/MCP/testing
packages, breakpoints and mocking features, native SDKs, concepts, contributing,
and release.

```bash
bun run docs:dev      # local dev server
bun run docs:build    # production build
bun run docs:preview  # preview production build
```

## Pre-commit Hooks

`lefthook` runs on every commit: format check (`oxfmt`), lint (`oxlint`),
typecheck. Fix failures before committing — never skip hooks.

## Open Source Boundary

Public: `README.md`, `CONTRIBUTING.md`, `.github/`, `docs/`, all package `README`s.

Never commit: `.agent/`, `.claude/`, `.codex/`, `.ramen/`, `.stitch/`, `.references/`,
`artifacts/`, `CLAUDE.md`.

Internal local-agent state (plans, memory, handoffs, research notes) belongs in
`.agent/` and must not be committed. Both Codex and Claude use this shared
folder; keep tool settings, hooks, and skills in their tool-specific folders.
Reusable project instructions belong here in tracked `AGENTS.md`; contributor
commands belong in `CONTRIBUTING.md`. See its worktree and verification workflow.

## Research Workflow

Use local Hakka repo truth first, then official docs, reference repos, and live
web/community research when current ecosystem context is needed.

Every plan update should include: what changed, what stayed, what we learned,
what is still open, evidence used. Prefer `Verified`, `Decision`, `Open check`,
and `Deferred` labels. If a claim is not verified, mark it as an open check.
