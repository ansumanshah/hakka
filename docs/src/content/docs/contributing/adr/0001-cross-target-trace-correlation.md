---
title: 'ADR 0001 — Cross-target trace correlation'
description: How Hakka correlates a single causal trace across client, server, and upstream hops without a proxy.
---

Status: Implemented · Date: 2026-07-04

## Context

Hakka already correlates traces in one vertical: every client (web, RN, iOS,
Android) injects `x-hakka-trace`, and `hakka-next` reads it on the server
(AsyncLocalStorage + http.Server patch), links the incoming request to its
upstream calls, and streams both sides over the bridge. A Next.js app shows
client → server → upstream as one causal chain today.

The 2.0 bet: make that work when the backend **isn't Next.js**. A React Native
app calling a Fastify/Express/Hono/raw-Node service should produce the same
single causally-linked trace in the inspector and in `hakka-mcp`. No proxy tool
can follow here — they see packets, not causality — which is why this is the
moat feature.

## Options considered

**A. `hakka-node` — a framework-agnostic server SDK.**
Extract the non-Next parts of `hakka-next/src/serverCapture.ts` + `trace.ts`
(fetch patch, node `http`/`https`/undici capture, AsyncLocalStorage context,
`x-hakka-trace` read/propagate) into a new `hakka-node` package with a single
`register()` entry point. Streams canonical `{type:'request'}` frames to the
same bridge hub. `hakka-next` becomes a thin wrapper over it plus the
Next-specific runtime wiring.

**B. OTel-native interop only.**
No new package: document/accept W3C `traceparent` as an alternate correlation
header, map it into `correlationId`, and tell backend users to view server
spans in their existing OTel stack. Hakka stays client-only; correlation
happens in Grafana/Jaeger, not the inspector.

**C. A + W3C interop (chosen).**
Build `hakka-node` (option A) but make the trace contract dual-read: prefer
`x-hakka-trace`, fall back to incoming W3C `traceparent` (and emit both on
outgoing hops). Hakka's OTel exporter already exists, so a `hakka-node` session
can also be shipped into a real OTel pipeline unchanged.

## Decision

Option **C**. Rationale:

- The dev-loop value ("my phone's checkout call and the API's DB-service hop in
  one inspector view, zero infra") only exists with an in-process server SDK —
  option B outsources the moat to Grafana.
- Reusing the tested `hakka-next` capture internals keeps this an extraction,
  not new capture surface. The record contract, bridge protocol, and MCP need
  **zero changes** — server frames already carry `runtime:'server'` and
  `correlationId`, and the web overlay already renders runtime tags + trace
  grouping (`groupBy: 'trace'`).
- W3C fallback means Hakka traces survive mixed estates (services already
  instrumented with OTel middleware) instead of fighting them.

## Consequences / scope for 2.0

- New package `hakka-node` (10th npm package): `register({ bridgeUrl })`,
  http/https/undici/fetch capture, ALS trace context, dual-header read/write,
  no-op unless `NODE_ENV=development` or explicitly forced (same dev-only
  posture as every other target).
- `hakka-next` refactors onto it (behavior-preserving; serverCapture tests move
  mostly intact).
- The inspector's trace group header should show the hop chain
  (client → server → upstream) once multi-hop traces appear; today's flat
  trace grouping is acceptable v1.
- Non-goals for 2.0: sampling, production tracing, span timing semantics beyond
  what the record contract already captures — Hakka is a dev-loop tool, not an
  APM.

## Verification plan

Extend `scripts/smoke-control-roundtrip.mjs`'s pattern: a fixture RN-style
client frame with trace id T + a `hakka-node`-captured server frame with the
same T through a real bridge → assert `hakka-mcp` `search_requests` groups both
under T, and the web store's `groupBy:'trace'` yields one group of two hops.
