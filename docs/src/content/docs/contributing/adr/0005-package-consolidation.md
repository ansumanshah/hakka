---
title: 'ADR 0005 — Package consolidation and naming'
description: Why Hakka ships seven npm packages instead of thirteen, why they stay unscoped, and why that partially supersedes ADR 0003.
---

Status: Implemented · Date: 2026-08-01 · Partially supersedes [ADR 0003](/contributing/adr/0003-embeddable-components/)

> **Progress (2026-08-16):** executed — `packages/` now holds exactly the
> seven publishable packages named below (plus `hakka-bench`, an unpublished
> internal bench workspace), and the CI publish workflow covers all of them.

## Context

Hakka had grown to thirteen publishable npm packages: `hakka-core`,
`hakka-web`, `hakka-bridge`, `hakka-components`, `react-native-hakka`,
`hakka-next`, `hakka-node`, `hakka-mcp`, `hakka-cdp`, `hakka-react`,
`hakka-rozenite`, `hakka-test`, and `hakka` (CLI).

Each one grew for a defensible local reason, but the total is a poor deal for
everyone. Thirteen packages means thirteen version numbers to keep in lockstep
across a release, thirteen READMEs to keep honest, thirteen entries in the
publish order, and thirteen names a newcomer has to hold in their head to
understand what Hakka _is_. Several of them are not meaningful units of
software — `hakka-components` has no `src/` directory at all.

Nothing is published yet. Consolidating now costs a refactor; consolidating
after launch would break every consumer's imports.

## Decision

**Seven published packages.**

```
hakka                  CLI — npx hakka init / mcp / cdp
hakka-core             + /test
hakka-browser          + /elements/*  + /react
hakka-node             + /next  + /next/server  + /next/client
hakka-bridge
hakka-react-native
hakka-rozenite
```

The dividing line is **runtime**, not topic. Four packages exist because they
can never share a dependency set: `hakka-core` (zero runtime dependencies,
universal), `hakka-browser` (Solid, DOM), `hakka-react-native` (heavy RN
peers), and `hakka-node` (`ws`, Node built-ins). `hakka-bridge` is the
transport hub both `hakka-node` and the CLI connect to. `hakka` owns the
`bin`. Everything that was merged away failed to justify a separate publish
against that line.

Specifically:

- **`hakka-components` and `hakka-react` → `hakka-browser`.** Both are the
  same Solid source and the same DOM runtime. See the supersession note below.
- **`hakka-mcp` and `hakka-cdp` → `hakka`.** Both are operator tools invoked
  from a terminal, and the CLI already owns a `bin`. `npx hakka mcp` also reads
  better in an MCP client config than a second package name.
- **`hakka-test` → `hakka-core/test`.** It depended on nothing but the core
  engine. As a separate entry point it stays out of production bundles.
  **Rejected — folding `hakka-rozenite` into `hakka-react-native`.** It already
  declares `hakka-react-native` as a peer, so the merge looked free. It is not:
  its panel half is browser React (`react-dom/client`) built by a _separate_
  toolchain (`rozenite build`, plus a `rozenite.config.ts` that must sit at the
  package root for plugin discovery). Merging drags a second build system into
  the heaviest, most fragile package to save one publish — the same objection
  that keeps `hakka-node/next` out of the browser package. It stays standalone,
  which is why the floor is seven and not six.
- **`hakka-next` → `hakka-node/next`.** Its only hard dependency was
  `hakka-node`; `hakka-web` was already `optional: true` in
  `peerDependenciesMeta`. Folding it into the Node package therefore adds no
  hard dependency for existing `hakka-node` consumers.

**Rejected — `hakka-next` into the browser package.** Superficially appealing,
since Next is "web". But `hakka-next` is full-stack: its `/server` half
instruments `fetch` and Node `http`/`https` inside the Next server runtime.
Housing it in `hakka-browser` would make the browser package depend on
`hakka-node`, so every plain browser consumer would install `ws` and the Node
transport for code they never execute. The direction of the dependency decides
the home, not the framework's name.

**Rejected — folding `hakka-bridge` into either neighbour.** `hakka-node`
depends on it and the CLI needs it for `hakka mcp`. Merging it into the CLI
would make a library depend on a CLI; merging it into `hakka-node` would make
the CLI pull Node capture code just to run a hub.

### Naming — unscoped, with two renames

The set stays unscoped. Two names change:

- `react-native-hakka` → **`hakka-react-native`**
- `hakka-web` → **`hakka-browser`**

**Rejected — a `@hakka/*` scope.** This was the original decision here and was
reversed. A scope would have grouped the packages on one npm org page and
reserved the whole namespace in one act, with Sentry as the precedent
(`@sentry/browser`, `@sentry/node`, and a migration _away_ from
`react-native-sentry`, now frozen at 0.43.2). Two things killed it:

1. **The namespace was not available.** `hakka` is taken as a GitHub org, and
   the scope could not be secured. Falling back to `@usehakka` or a personal
   `@ansumanshah` scope bought the grouping at the cost of a worse name.
2. **The `/` in a scoped name is structurally load-bearing.** `hakka-core` →
   `hakka-core` introduces a slash into a token that appears inside regular
   expression literals — `packages/hakka-core/src/capture/stackTrace.ts` filters stack
   frames with a regex listing module names, and the rewrite terminated the
   literal early ("Unexpected flag c in regular expression literal"), breaking
   the core build and cascading into every downstream suite. Roughly 90 files
   under `packages/*/src` name packages outside an import statement, in
   comments, runtime string matches, and regexes. Unscoped renames are plain
   token swaps with none of that hazard.

The actual defect in the old naming was narrow: `react-native-hakka` was the
single name that broke the `hakka-*` pattern, carrying the React Native
ecosystem's own prefix convention. Renaming that one package fixes it. The
scope would have been a seven-package migration to solve a one-package problem.

`browser` over `web` for the reason Sentry chose it: the package is specifically
the browser overlay, and "web" is ambiguous against the docs site and the web
platform generally.

**Cost accepted:** unscoped names are individually squattable after launch.
That is a real but modest risk for a pre-1.0 tool, and it is reversible — Sentry
itself shipped unscoped before migrating to a scope later.

## Supersession of ADR 0003

ADR 0003 rejected merging `hakka-components` into `hakka-web`. That rejection
was specifically of **re-exporting `hakka-web`'s dist**, on the grounds that
doing so would drag the Inspector shell, the worker client, and the theming
bootstrap into every one of the six elements and destroy per-element
tree-shaking. **That reasoning is correct and still holds.**

This ADR takes a third option that 0003 did not consider: **one package, the
same separate per-element builds.** `hakka-components`'s Vite config already
built in lib mode from `packages/hakka-browser/src/ui/elements/*.tsx` with independent
entries; that build is unchanged. Only the `package.json` that publishes the
output changes. Each element remains its own independently built,
independently tree-shakeable chunk, and the per-component gzip budgets in
`scripts/web-size-gate.mjs` continue to gate them.

ADR 0003's other decisions — the six-component split, the per-element
registration model, and the shared-source-no-fork relationship with the
Inspector — are unaffected and remain in force.

## Consequences

- Six fewer packages to version, document, and publish. The release order
  shrinks from thirteen entries to seven.
- Consumers of the merged packages change an import specifier, not an install.
  Since nothing shipped, no real consumer is affected.
- `hakka` (CLI) gains `@modelcontextprotocol/sdk`, `zod`, and `ws` as
  dependencies. This is a deliberate trade: a slightly heavier CLI install in
  exchange for two fewer published packages. The subcommand handlers import
  these lazily so `hakka init` does not pay the module-load cost.
- Deep-import paths get one segment longer (`hakka-browser/elements/json-tree`
  rather than `hakka-components/json-tree`). Acceptable for the grouping it buys.
- Package _directories_ keep their existing names (`packages/hakka-browser` publishes
  `hakka-browser`, `packages/hakka-react-native` publishes `hakka-react-native`).
  Directory and package names were already decoupled here, and renaming
  directories would churn every path in the justfile, CI, and tsconfigs for no
  consumer-visible gain.
