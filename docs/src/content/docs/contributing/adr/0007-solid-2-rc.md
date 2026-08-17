---
title: 'ADR 0007 — Ship on Solid 2.0 at the RC'
description: Why hakka-browser launches on solid-js 2.0.0-rc.0 with a carried @solidjs/web patch instead of staying on 1.9.x, and what must stay true until 2.0 stable.
---

Status: Implemented · Date: 2026-08-16 · Amends [ADR 0003](/contributing/adr/0003-embeddable-components/)

## Context

`hakka-browser`'s overlay and the six embeddable elements (ADR 0003) were
built on `solid-js@1.9.14`, with `solid-element` providing the custom-element
layer and `vite-plugin-solid` the compiler. Solid 2.0 then reached an
API-frozen release candidate with a repackaged runtime: fine-grained
reactivity in `@solidjs/signals`, the DOM runtime in `@solidjs/web`, custom
elements in `@solidjs/element` (superseding `solid-element`), and the
compiler in `@solidjs/vite-plugin` (superseding `vite-plugin-solid`).

The earlier working plan was the conservative one: launch on 1.9.14, migrate
to 2.0 as the first post-launch project. Two facts flipped it:

1. **The migration is behavior-visible, not a dep bump.** The element layer's
   mount semantics differ (`@solidjs/element`'s `withSolid()` clears
   `renderRoot.textContent` during initial mount, which changes how shadow
   styles must be attached), reactivity moves to deep `reconcile`-style
   change tracking with reference-equality semantics, and error recovery /
   settle timing change. Doing that under a public API, after external
   embedders exist, is strictly worse than doing it before the first user.
2. **The RC is API-frozen.** The remaining risk class is implementation
   regressions — catchable by the existing suite, size gates, and bench
   budgets — not API churn that would invalidate the work.

## Options considered

**A. Launch on 1.9.14, migrate post-launch.**
Zero pre-launch risk, but guarantees a breaking runtime swap as the first
thing external embedders experience, plus a documentation set that describes
a runtime already scheduled for replacement.

**B. Migrate to 2.0.0-rc.0 now and launch on it.**
Pre-launch risk, bounded by gates; post-launch the only planned change is the
rc → stable version bump.

**C. Support 1.x and 2.0 side by side.**
Rejected outright: dual compilation targets and a compat layer for a package
whose brand is small size and low overhead.

## Decision

Option **B**. `hakka-browser` (overlay, worker store client, and all six
elements) runs on `solid-js@2.0.0-rc.0` + `@solidjs/web` +
`@solidjs/signals` + `@solidjs/element`, compiled by `@solidjs/vite-plugin`.
`solid-element` and `vite-plugin-solid` are removed entirely.

Three 2.0 semantics are load-bearing enough that the migration codified them
as house patterns (each enforced by tests):

- **Fresh-identity copies for engine objects mutated in place.** 2.0's
  change tracking is reference-based; an object the capture engine mutates
  in place (a rule's `hitCount`, a breakpoint's state) never re-renders.
  Panels copy engine objects on refresh instead of holding live references.
- **Keyed remount for error recovery.** Crash/error boundaries remount their
  subtree via keyed rendering rather than assuming re-execution.
- **`onSettled` for post-settle resync.** Timers and pollers that must
  observe the DOM after a render settle register there, with cleanup.

### The carried patch

One RC regression is carried as a package patch
(`patches/@solidjs%2Fweb@2.0.0-rc.0.patch`): 2.0 dropped 1.x's
stringify-before-insert for numbers, so inserting the number `0` can create
no text node at all on DOM implementations whose `textContent` setter tests
raw truthiness (happy-dom, which the test suite runs on). The patch restores
1.x's stringify-first behavior; a minimal repro and a source-level fix are
staged for upstream. The patch is **load-bearing for the test suite** — do
not drop it, and do not float the dependency version (it must stay pinned to
`2.0.0-rc.0` so the patch applies), until 2.0 stable or a merged upstream
fix replaces it.

## Consequences / scope

- **Dependency swap** (all pinned to the RC): `solid-js`, `@solidjs/web`,
  `@solidjs/signals`, `@solidjs/element`, dev-side `@solidjs/vite-plugin`
  and `@solidjs/testing-library`. Removed: `solid-element`,
  `vite-plugin-solid`.
- **Shadow styles attach via `adoptedStyleSheets` only.** A `<style>` child
  appended to `renderRoot` is wiped by `withSolid()`'s mount-time clear;
  constructed stylesheets are not DOM children and survive. Documented in
  [Embeddable components](/embedding/components/); the fallback for
  environments without Constructable Stylesheets remains.
- **The elements' shared runtime chunk grew** (~69 → ~83 KB gzip) because
  the runtime now spans multiple packages and Rollup carves it into
  separately named auto-chunks; `scripts/web-size-gate.mjs` re-budgeted with
  per-line arithmetic and `vite.config.ts` pins the split runtime chunks
  into the `shared-` prefix by chunk name (see
  [Build pipeline](/contributing/build-pipeline/)).
- **ADR 0003 amended, not superseded**: the six-element architecture,
  props/events contract, and lazy-registration guarantees are unchanged;
  only the underlying element machinery moved from `solid-element` to
  `@solidjs/element`.
- **Exit criteria**: when Solid 2.0 stable ships, bump the pins, drop the
  carried patch, and re-run the full gate battery. Until then the RC pin is
  deliberate, not drift.

## Verification plan

All of these ran green on the migration and run in CI or pre-push hooks:

- Full workspace test suite (including the element and overlay suites on
  happy-dom, which exercise the carried patch's code path).
- `scripts/web-size-gate.mjs` — every overlay and per-element budget.
- Capture and render bench budgets (`packages/hakka-bench`,
  [Benchmarks](/reference/benchmarks/)) — capture overhead is
  Solid-independent and stayed flat; cold-open render time improved during
  the same window via the incremental filter cache, so the honest claim is
  "no regression attributable to the runtime swap," verified against the
  bench budgets rather than a before/after pair.
- An adversarial review pass by a separate agent instance before merge.
