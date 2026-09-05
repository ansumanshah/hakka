# Contributing

Hakka is a local-first network inspector built on one shared engine
([`hakka-core`](./packages/hakka-core)) with targets for React Native, the web,
Next.js, Android (Kotlin), and iOS (Swift). Treat the native SDKs as product
code — not implementation details of the RN wrapper.

Design principles, architecture, and SDK design decisions: [hakka.noodleapps.com/contributing](https://hakka.noodleapps.com/contributing)

## Requirements

- Bun version from `package.json` (`packageManager`)
- Node.js 22+ and `just`
- Python 3 and Playwright Chromium (for browser E2E)
- JDK 17+
- Xcode 16+
- Android Studio (for Android work)

## Setup

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

## Validation

Run these from the repo root. They cover all 7 TypeScript packages.

```bash
bun run typecheck          # TypeScript (or: tsgo)
bun run build              # build all packages (tsdown; builder-bob for RN)
bun run test               # all package test suites
bun run lint               # oxlint
bun run fmt:check          # oxfmt check
bun run cleanup:check      # Knip dead-code audit

bun run build:android      # Gradle build for Android SDK modules
bun run test:android       # Android unit tests

bun run build:ios          # Swift Package build
bun run test:ios           # Swift tests

just preflight             # full cross-platform build/test gate
bun run pack:npm:dry-run   # npm package contents preview (all 7 packages)
```

## Verify Gates

The fastest way to check "is this change safe to hand off" — run these from
the repo root (`justfile`):

```bash
just verify                # Headless gate; builds shared packages first, then runs:
                            # typecheck, lint, fmt-check, sync-ios-check,
                            # sync-tokens-check, UI/spec/dependency checks, rn-jest,
                            # web-jsside (every remaining JS package),
                            # android-unit, ios-swift, desktop-swift. iOS benchmarks are
                            # excluded — their thresholds flake under the
                            # gate's CPU contention; run `just bench-ios` solo.
                            # Target <5 min warm. Prints a PASS/FAIL table
                            # per leg, with unique retained logs for every run.
just verify-smoke          # end-to-end smoke gate (bridge, MCP, control, trace)
just verify-all            # verify + verify-smoke + build-all (full release gate)

bun run phase:verify:ci    # CI-safe release confidence path (delegates to `just verify`)
bun run phase:verify       # local phase handoff confidence path (verify + verify-smoke)
bun run phase:verify:full  # release-gate path (delegates to `just verify-all`)
```

## Worktrees and end-to-end checks

Use a separate checkout for independent changes. Install dependencies inside each
worktree: sharing `node_modules` also shares workspace symlinks, which can silently
load another checkout's sources or build outputs.

```bash
git worktree add .worktrees/my-change -b codex/my-change
cd .worktrees/my-change
bun install --frozen-lockfile
bun run build
just verify-smoke
just e2e-install
CI=1 just test-e2e
```

`CI=1` prevents Playwright from reusing a server on port 4173 from another
checkout. Run browser E2E serially across worktrees; stop an old server before
starting. Inspect `packages/hakka-browser/test-results/` after failures and use
`bunx playwright show-trace <trace.zip>` from that package to inspect a trace.
`just demo-browser` serves the same fixture bundle for interactive debugging.
For Next.js changes, also run `just test-e2e-next`; it installs its standalone
example with npm because Turbopack cannot use Bun's per-file workspace links.

Wire-contract changes require the relevant shared `fixtures/` records and their
TypeScript, Swift, and Kotlin consumers. `just verify` covers their unit suites;
`just verify-smoke` verifies live MCP, bridge control, and trace correlation.
Serialize native builds/tests across agents sharing Gradle caches or simulators.
Run performance suites alone, after correctness checks, to avoid CPU contention.

Keep private plans, evidence, and handoffs in ignored `.agent/`, shared by Claude
and Codex. Keep tool-specific settings/hooks in `.claude/` or `.codex/`; put
reusable instructions in tracked `AGENTS.md` and contributor documentation.
Before removing a worktree, inspect `git status`, commit or preserve its changes,
and confirm its commits are merged with `git branch --merged main`.

## Dev Harnesses

Local developer workflows live in the `justfile` — run `just` to list every recipe.

```bash
just dev-ios              # RN example app on iOS Simulator
just dev-android          # RN example app on Android
just xcode-core           # open the standalone iOS Swift package in Xcode
just studio-core          # open the standalone Android modules in Android Studio
just docs                 # docs dev server at localhost:4321
```

Release harness: `packages/hakka-react-native/examples/react-native-example`

## Code Guidelines

- Keep native capture off hot network paths. Capture minimal facts first, then redact/map/export from a processor queue.
- Core packages stay dependency-light. `hakka-core` carries a single runtime dep (`fflate`, for gzip/deflate body decoding). Android core may use OkHttp (interception surface). iOS core stays Foundation-first.
- Preserve the Hakka record contract across TypeScript, Kotlin, and Swift.
- UI dependencies belong behind the RN UI subpath or native UI artifacts. Core SDK modules are UI-less.
- `ios/Sources` is canonical; `packages/hakka-react-native/ios/Core` is generated via `just sync-ios`. Never hand-edit the generated copy.
- Add tests when changing public contracts, redaction, filtering, capture timing, body limits, or bridge behavior.
- Every directory under `packages/` is named for the package it publishes. Keep
  it that way — the release workflow, `pack:npm:dry-run`, and the tarball smoke
  gate all treat the directory listing as the package list.
- **Do not add `"sideEffects": false` to `hakka-react-native`.** Its omission is
  deliberate, not an oversight. `src/index.ts` does a bare `import './bootstrap'`
  whose only job is `Hakka.registerNativeAdapter()` + `mockEngine.registerNativeBridge()`,
  and several UI modules `require()` optional peers (`async-storage`, `mmkv`) inside
  a module-scope `try`/`catch`. A bundler told the package is side-effect-free may
  legally drop all of that, and capture silently stops. The other six packages
  declare it because they genuinely are pure (`hakka-browser` lists its CSS and
  `register.ts` as the exceptions).

## Versioning & Toolchain Decisions

- **All packages move in lockstep** at one version (npm ×7, Maven ×6, SPM tag),
  enforced by `scripts/version-audit.mjs` (which also covers the
  `HAKKA_CORE_VERSION` / `HAKKA_BRIDGE_VERSION` source constants). Changesets
  bumps the npm side only, as a **fixed group** (`.changeset/config.json`), so
  one changeset moves all seven together and rewrites their internal pins —
  `bun changeset` to describe, `bun run version-packages` to apply. It is
  deliberately configured with `"changelog": false`: Hakka keeps one hand-written
  root `CHANGELOG.md` rather than seven generated ones. Native versions are not
  managed by changesets at all — bump `android/**/build.gradle.kts` and
  `ios/Hakka.podspec` by hand, then let `version-audit` catch any drift.
- **TypeScript tracks npm `latest`** (currently 6.x) per the studio's
  latest-stable policy. `strict` is on in every package tsconfig.

## Commit Format

```
feat(android): add capture processor queue
fix(ios): redact response headers before export
docs: update architecture notes
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Scopes: `core`, `rn`, `web`, `next`, `vite`, `cli`, `mcp`, `bridge`, `android`, `ios`, `docs`, `ci`, `release`

## Pull Requests

- Run the smallest validation that covers your change.
- Run `just verify` before handing off — Tier-0 headless gate, all legs in parallel.
- Run `just preflight` for cross-platform or release-sensitive changes.
- Run `bun run cleanup:check` when removing code, changing exports, or prepping a release.
- Update docs when public behavior, architecture, or setup changes.
- Call out any skipped platform validation in the PR description.

## Publishing

Maintainers only. Contributors do not publish.

- npm (7 packages): `hakka-core`, `hakka-browser`, `hakka-bridge`, `hakka-node`, `hakka-react-native`, `hakka-rozenite`, `hakka` (CLI) — published in dependency order (core first).
- Android artifacts → Maven Central (`com.noodleapps.hakka:hakka-*`)
- iOS products → Swift Package Manager tags

Release prep follows the [release checklist](https://hakka.noodleapps.com/release/checklist), which also covers the open-source boundary scan.

Run `just verify-all` (or `bun run phase:verify:full`) before any release — it runs the Tier-0 gate, the smoke gate, and a full cross-platform build (`build-all`). Physical-device benchmark verification (`scripts/benchmark-verify.mjs --strict-physical`) is a separate, manual step — run it directly when claiming the performance phase complete; it is not currently wired into `just verify-all`.
