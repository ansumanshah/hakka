---
title: Trace correlation
description: Spec card — the x-hakka-trace header and correlationId that join a client request to the server/upstream hops it triggers.
---

## What it does

Trace correlation propagates a shared id (`x-hakka-trace` header, `correlationId` field) across
a request's client → server → upstream hops so one logical request shows as a single joined
timeline instead of disconnected records. A server context inherits and forwards its incoming
id; a client originates a new one for same-origin/allowlisted requests.

## Public API

```ts
import {
  HAKKA_TRACE_HEADER, // 'x-hakka-trace'
  configureTrace,
  newTraceId,
  shouldPropagateTrace,
  resolveOutgoingTrace,
  setTraceProvider,
  currentTraceId,
} from 'hakka-core'
import type { TraceConfig, TraceProvider } from 'hakka-core'

configureTrace({ enabled: true, propagateOrigins: ['https://api.example.com'] })
resolveOutgoingTrace(url) // string | undefined — the single entry point the fetch interceptor calls
```

`setTraceProvider` / `currentTraceId` are the server-side half: `hakka-node` registers an
`AsyncLocalStorage`-backed `TraceProvider` so server captures inherit the request-scoped id
without core ever importing Node.

## Config keys + defaults

| Key                | Default     | Description                                                                                          |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| `enabled`          | `false`     | Off by default — the id is never sent without opt-in (would otherwise leak cross-origin).            |
| `propagateOrigins` | `undefined` | Cross-origin destinations allowed to receive the header. Same-origin is always allowed when enabled. |

## Platform matrix

SPEC §5 row "Trace correlation" (footnote 9):

| Capability        | RN  | iOS | Android | Web |
| ----------------- | --- | --- | ------- | --- |
| Trace correlation | ●   | ●   | ●       | ●   |

Nuance from SPEC footnote 9: **Web** ships full client↔server join (the `hakka-node/next` full-stack
case). **RN/iOS/Android** originate and stamp `x-hakka-trace` + `correlationId` on outgoing
requests (iOS `RequestBuilder`, Android `HakkaInterceptor`, RN's `correlationId` display) —
native is trace-**joining** (not full-stack joining) when the backend runs `hakka-node`, which
reads the header (falling back to W3C `traceparent`) and streams the server hop under the same id.

SPEC §5 rows "Framework span capture" (footnote 11), "Trace-id adoption" (footnote 12), "Trace
badge row" (footnote 13), "Verbose span toggle" (footnote 14), and "Request-kind filter"
(footnote 16) — the Next.js Request Insights feature set, `hakka-node` + `hakka-browser` only:

| Capability             | RN  | iOS | Android | Web |
| ---------------------- | --- | --- | ------- | --- |
| Framework span capture | —   | —   | —       | ●   |
| Trace-id adoption      | —   | —   | —       | ●   |
| Trace badge row        | —   | —   | —       | ●   |
| Verbose span toggle    | —   | —   | —       | ●   |
| Request-kind filter    | —   | —   | —       | ●   |

None of the five have a native counterpart: there is no RN/iOS/Android OTel SDK integration to
surface framework spans from, so trace grouping, the badge row, the verbose toggle, and the
request-kind filter — all built on `FrameworkSpan` — are web-only. `hakkaSpanProcessor()`
(`packages/hakka-node/src/spanProcessor.ts`) reads spans from an already-registered OTel
`TracerProvider`; `adoptOtelTraceId()` (`packages/hakka-node/src/trace.ts`) lets a root span's own
OTel trace id become the `correlationId` when no `x-hakka-trace`/`traceparent` header was present,
so a header-less SSR/document-navigation load still joins into one trace group. `TraceBadgeRow`
(`packages/hakka-browser/src/ui/TraceBadgeRow.tsx`) renders the badge strip, the slowest-operation
callout, and the primary/verbose switch; `FilterBar.tsx`'s `requestKindFilter` narrows visible
trace groups by their root span's `requestKind` (`'document' | 'rsc' | 'route-handler' |
'server-action'`, classified in `spanProcessor.ts`'s `classifyRequestKind()`).

## Wire format

```
x-hakka-trace: <uuid-or-generated-id>
```

`newTraceId()` prefers `crypto.randomUUID()`, falling back to
`` `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` ``.
`NetworkRequest.correlationId` carries the same value on the captured record.

## Test anchors

- `packages/hakka-core/src/engine/trace.test.ts`
- `packages/hakka-node/src/trace.test.ts`
- `scripts/smoke-trace-correlation.mjs`

## Limits & non-goals

- Propagation is opt-in and origin-gated — there is no global "trace everything" switch that
  bypasses `propagateOrigins`.
- Trace correlation only links hops that carry the header; it does not reconstruct a causal
  chain retroactively from timing alone.
- Native (RN/iOS/Android) trace-**joining** to a backend requires that backend to run
  `hakka-node` — without it, the header is stamped but nothing on the server side consumes it.
