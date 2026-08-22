# Hakka — developer tasks
# Run `just` to list all recipes

set shell := ["sh", "-c"]
set dotenv-load := false

# List available recipes
default:
    @just --list

# ── Clean ─────────────────────────────────────────────────────────────────────

# Remove generated build outputs (lib, docs/dist, Android .gradle)
clean:
    rm -rf packages/hakka-react-native/lib docs/dist
    cd android && ./gradlew clean || true

# Remove everything: artifacts, caches, node_modules — then reinstall
clean-all: clean
    rm -rf .build artifacts .playwright-mcp node_modules
    bun install

# ── Install ───────────────────────────────────────────────────────────────────

# Install all workspace dependencies
install:
    bun install

# ── Build ─────────────────────────────────────────────────────────────────────

# Build the hakka-react-native package
build:
    bun run --cwd packages/hakka-react-native build

# Build all Android SDK modules
build-android:
    cd android && ./gradlew :hakka-common:build :hakka-network:build :hakka-network-noop:build :hakka-performance:build :hakka-performance-noop:build :hakka-ui:build

# Build iOS Swift SDK
build-ios:
    cd ios && swift build

# Build the demo app the way CI does. `swift build` is NOT a substitute: the
# demo compiles ios/Sources into its own target, where a transitive re-export
# from another module does not apply and access-level rules bite differently.
# Two such breaks reached CI green-locally before this recipe existed.
build-ios-demo:
    cd ios/Example && xcodebuild -project HakkaDemoApp.xcodeproj -scheme HakkaDemoApp \
        -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build

# Build the macOS desktop app (apps/hakka) and its libraries.
build-desktop:
    cd apps/hakka && swift build

# Build all platforms
build-all: build build-android build-ios build-ios-demo build-desktop

# ── Test ──────────────────────────────────────────────────────────────────────

# Run the RN package test suite (278 tests)
test:
    bun run --cwd packages/hakka-react-native test

# Run Android unit tests
test-android:
    cd android && ./gradlew :hakka-common:test :hakka-network:test :hakka-network-noop:test :hakka-performance:test :hakka-performance-noop:test :hakka-ui:test

# Run iOS unit tests
#
# --no-parallel: BreakpointEngine's tests exercise a blocking pause/resume API,
# so they park real threads by design. Run in parallel with the rest of the
# suite on a low-core machine, those parked threads exhaust libdispatch's pool
# and the concurrency tests elsewhere (LogStore, HakkaConsole) see zero of their
# 200 dispatched blocks run. Serialized the whole suite is 1.2s, so this costs
# nothing.
test-ios:
    cd ios && swift test --no-parallel

# iOS unit tests without the perf benchmarks — the parallel `just verify` gate
# uses this: benchmark thresholds are CPU-load-sensitive and flake under the
# gate's contention (917µs vs a 500µs limit that passes solo).
test-ios-nobench:
    cd ios && swift test --no-parallel --skip HakkaBenchmarkTests

# Run the macOS desktop app's test suite (apps/hakka)
test-desktop:
    cd apps/hakka && swift test

# Run ONLY the iOS perf benchmarks, on an otherwise idle machine
bench-ios:
    cd ios && swift test --filter HakkaBenchmarkTests

# Build the core engine library (emits dist that other JS packages import)
build-core:
    bun run --cwd packages/hakka-core build

# Build the dev/desktop bridge library (emits dist that hakka-node imports)
build-bridge:
    bun run --cwd packages/hakka-bridge build

# Build the Node CLI/CI library (emits dist that packages/hakka's ciBaseline
# tests import via the "hakka-node/ci" subpath)
build-node: build-core build-bridge
    bun run --cwd packages/hakka-node build

# Run all web/JS-side package tests (core + web + bridge + integrations). Builds the
# dist deps first so cross-package imports (hakka-core, hakka-bridge, hakka-node)
# resolve. The standalone custom elements and the React wrappers now build as part
# of packages/hakka-browser (`./elements/*` and `./react` subpaths), so they need
# no step here.
test-web: build-core build-bridge build-node
    bun run --cwd packages/hakka-core test
    bun run --cwd packages/hakka-bridge test
    bun run --cwd packages/hakka-browser test
    bun run --cwd packages/hakka test
    bun run --cwd packages/hakka-node test
    bun run --cwd packages/hakka-rozenite test

# test-web minus the build-core/build-bridge dep recipes — used by verify.sh,
# which pre-builds those once, sequentially, before its parallel legs
# (rebuilding inside the parallel phase wipes dist mid-typecheck).
test-web-prebuilt:
    bun run --cwd packages/hakka-core test
    bun run --cwd packages/hakka-bridge test
    bun run --cwd packages/hakka-browser test
    bun run --cwd packages/hakka test
    bun run --cwd packages/hakka-node test
    bun run --cwd packages/hakka-rozenite test

# Consumer-side tarball install smoke gate: builds + npm-packs every publishable
# package, installs the tarballs into a throwaway project outside the repo
# (no workspace inheritance), and runs a real hello-world against each one
# under both bun and node.
smoke-tarballs:
    bun scripts/smoke-tarball-install.mjs

# Verify spec cards' platform matrices match SPEC.md §5 (CI gate)
spec-drift-check:
    node scripts/spec-drift-check.mjs

# Verify every symbol a spec card says you can import is actually exported
# from the package it names (CI gate). Catches what spec-drift-check can't:
# a card documenting an API that doesn't exist, or the wrong entry point.
spec-api-check:
    node scripts/spec-api-check.mjs

# Fail on hardcoded geometry in the RN inspector's styles — every height, gutter,
# radius and type size must come from a design token or a shared primitive.
ui-token-check:
    node scripts/ui-token-check.mjs

# Per-module core micro-benchmarks (table + RESULTS.md)
bench-core:
    bun run --cwd packages/hakka-core bench

# Gate: fail if any core module op exceeds its regression-ceiling budget
bench-core-check:
    bun run --cwd packages/hakka-core bench:check

# hakka-node capture-overhead benchmark: fetch() + node:http paths, with
# startCapture() installed vs not (table + RESULTS.md).
bench-node:
    bun run --cwd packages/hakka-node bench

# Gate: fail if hakka-node's added p99 latency (fetch or http path) exceeds budget
bench-node-check:
    bun run --cwd packages/hakka-node bench:check

# hakka-browser capture-overhead benchmark vs competitors, small + near-cap body
# (table + RESULTS.md). Builds web first so hakka-core's dist is present.
bench-web: build-core build-bridge
    bun run --cwd packages/hakka-browser build
    bun --cwd packages/hakka-browser bench/run.mjs

# Gate: fail if hakka-browser's Worker-model per-request cost exceeds budget
bench-web-check: build-core build-bridge
    bun run --cwd packages/hakka-browser build
    bun --cwd packages/hakka-browser bench/run.mjs --check

# Steady-state heap footprint of a filled hakka-core store (mode: 'store',
# maxRequests: 500). Builds core first so the dist import resolves.
bench-heap: build-core
    bun scripts/bench-heap.mjs

# Gzip bundle-size report + regression gate for hakka-browser (builds web first).
bundle-report: build-core build-bridge
    bun run --cwd packages/hakka-browser build
    node scripts/web-size-gate.mjs

# Mobile-viewport Playwright E2E for the web overlay (run `just e2e-install` once first).
test-e2e: build-core build-bridge
    bun run --cwd packages/hakka-browser test:e2e

# Install the Playwright browser (Chromium) for `just test-e2e`.
e2e-install:
    bun run --cwd packages/hakka-browser test:e2e:install

# Run all tests across all platforms (rn + web + android + ios)
test-all: test test-web test-android test-ios

# ── Code quality ──────────────────────────────────────────────────────────────

# TypeScript type check
typecheck:
    bun run --cwd packages/hakka-react-native typecheck

# Lint (oxlint)
lint:
    oxlint .

# Format source files (oxfmt)
fmt:
    oxfmt --write .

# Check formatting without writing
fmt-check:
    oxfmt --check .

# Unused dependency / export / file audit (knip)
audit:
    bunx knip --include files,exports,types,dependencies,devDependencies --no-progress --treat-config-hints-as-errors

# Regenerate the RN package's iOS sources from the canonical ios/Sources package
sync-ios:
    node scripts/sync-rn-ios.mjs

# Verify the RN package's iOS sources are in sync with ios/Sources (CI gate)
sync-ios-check:
    node scripts/sync-rn-ios.mjs --check

# Regenerate per-platform design-token mirrors from design-tokens.json
sync-tokens:
    node scripts/sync-design-tokens.mjs

# Verify the design-token mirrors are in sync across RN/iOS/Android (CI gate)
sync-tokens-check:
    node scripts/sync-design-tokens.mjs --check

# Rebuild hakka-browser and refresh the live docs hero/demo embed bundle
sync-embed:
    bun run --cwd packages/hakka-browser build
    perl -pe 's{//# sourceMappingURL=\S*$}{}' packages/hakka-browser/dist/hakka-browser.global.js > docs/public/embed/hakka-browser.global.js

# Rebuild the standalone custom elements and refresh the docs components strip bundle
sync-embed-components:
    bun run --cwd packages/hakka-browser build
    find docs/public/embed-components -maxdepth 1 -name "*.js" -delete
    for f in packages/hakka-browser/dist/elements/*.js; do \
        perl -pe 's{//# sourceMappingURL=\S*$}{}' "$f" > "docs/public/embed-components/$(basename "$f")"; \
    done

# ── Docs ──────────────────────────────────────────────────────────────────────

# Start docs dev server at localhost:4321
docs:
    bun run --cwd docs dev

# Build docs for production
docs-build:
    bun run --cwd docs build

# Preview production docs build
docs-preview:
    bun run --cwd docs preview

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start iOS Simulator preview via serve-sim at localhost:3200
sim *args:
    scripts/serve_sim.sh {{args}}

# Run the RN example app on iOS Simulator
dev-ios:
    bun run --cwd packages/hakka-react-native/examples/react-native-example ios

# Run the RN example app on Android
dev-android:
    bun run --cwd packages/hakka-react-native/examples/react-native-example android

# Open RN example in Xcode
xcode:
    xed packages/hakka-react-native/examples/react-native-example/ios/

# Open RN example in Android Studio
studio:
    open -a 'Android Studio' packages/hakka-react-native/examples/react-native-example/android/

# Open core iOS Swift package in Xcode
xcode-core:
    xed ios/

# Open core Android modules in Android Studio
studio-core:
    open -a 'Android Studio' android/

# ── Release ───────────────────────────────────────────────────────────────────

# Full pre-release gate: typecheck + build + test, all platforms
preflight: typecheck build test build-android build-ios

# Fast preflight: skips full Gradle/Swift build, uses class-level compilation
preflight-fast: typecheck build test
    cd android && ./gradlew --build-cache --parallel \
        :hakka-common:classes :hakka-network:classes \
        :hakka-network-noop:classes :hakka-performance:classes \
        :hakka-performance-noop:classes :hakka-ui:assembleDebug
    cd ios && swift build

# Check Android AAR sizes against budget
size-android:
    scripts/android-size-gate.sh

# Audit version numbers across all modules
version-audit:
    node scripts/version-audit.mjs

# Create a new changeset entry (interactive prompt) for the 7 npm packages
changeset:
    bun run changeset

# Dry-run npm pack to verify package contents before publish
pack-dry-run:
    cd packages/hakka-react-native && npm pack --dry-run

# Legacy phase verification gate (mode: local | ci | full) — delegates to
# verify/verify-smoke/verify-all below. Kept for docs/CI that still call
# `bun run phase:verify`; prefer `just verify` directly for new usage.
phase-verify mode="local":
    scripts/phase-verify.sh {{mode}}

# ── Verify ────────────────────────────────────────────────────────────────────

# Tier-0 headless gate: typecheck, lint, fmt, sync checks, and every test suite
# (RN/core/web/bridge/mcp/test/vite/cli/android/ios) run in parallel. Target
# <5 min warm. Prints a PASS/FAIL table; fails if any leg fails.
verify:
    scripts/verify.sh

# End-to-end smoke gate: bridge-replay + MCP-handshake scripts (not part of
# the fast Tier-0 gate — exercises real bridge/MCP wiring).
verify-smoke:
    scripts/verify-smoke.sh

# Full release gate: verify + verify-smoke + build-all
verify-all: verify verify-smoke build-all

# ── Benchmark ─────────────────────────────────────────────────────────────────

# RN capture-mode performance benchmark
bench-rn:
    bun scripts/rn-mode-benchmark.mjs

# Android Flashlight benchmark
bench-android:
    scripts/flashlight-rn-android.sh

# Refresh iOS runtime benchmark summary
bench-ios-summary:
    node scripts/ios-runtime-summary.mjs summarize \
        artifacts/benchmarks/ios/runtime-history.json \
        artifacts/benchmarks/ios/runtime-summary.json

# Verify benchmark artifacts are complete
bench-verify:
    node scripts/benchmark-verify.mjs

# Self-test the benchmark verifier against golden fixtures
bench-verify-test:
    node scripts/benchmark-verify-fixture-test.mjs

# Check device readiness for benchmarks
devices:
    node scripts/device-readiness.mjs
