---
title: Throttle
description: Spec card — simulate slow or offline network conditions with named latency profiles applied before real requests are sent.
---

## What it does

`ThrottleEngine` adds latency (and, once enabled, would drip bandwidth) to every outgoing
request before it hits the network, or throws before sending to simulate offline. It runs after
the mock-engine check, so `mock`/`block` rules bypass throttle entirely.

## Public API

```ts
import { ThrottleEngine } from 'hakka-core'
import type { ThrottleProfile, ThrottleConfig } from 'hakka-core'

ThrottleEngine.setProfile(profile) // 'none' | 'fast-3g' | 'slow-3g' | 'offline' | 'edge' | 'custom'
ThrottleEngine.setCustom(latencyMs, downloadKbps?)
ThrottleEngine.current // ThrottleConfig snapshot
ThrottleEngine.isActive // boolean — profile !== 'none'
ThrottleEngine.isOffline // boolean — profile === 'offline'
ThrottleEngine.onChange(listener) // () => void

// Called by the fetch interceptor, not typical app code:
await ThrottleEngine.applyDelay() // throws for 'offline'
ThrottleEngine.throttleResponse(response, downloadKbps) // wraps response.body in a dripping ReadableStream
```

## Config keys + defaults

Not part of `HakkaConfig` — set imperatively via `ThrottleEngine.setProfile()`/`setCustom()`.

Presets (`latencyMs`, `downloadKbps`) from `packages/hakka-core/src/engine/ThrottleEngine.ts`:

| Profile   | Latency    | `downloadKbps` |
| --------- | ---------- | -------------- |
| `none`    | 0 ms       | —              |
| `fast-3g` | 150 ms     | 1500           |
| `slow-3g` | 400 ms     | 400            |
| `edge`    | 250 ms     | 240            |
| `offline` | — (throws) | 0              |

## Platform matrix

SPEC §5 row "Mocking / throttle" (footnotes 5, 6) — throttle shares its parity row with mocking:

| Capability         | RN  | iOS | Android | Web |
| ------------------ | --- | --- | ------- | --- |
| Mocking / throttle | ●   | ●   | ●       | ●   |

iOS and Android both ship the same named profiles (fast-3g / slow-3g / edge / offline) with
latency **and** bandwidth drip applied to real requests (iOS via `URLProtocol`, Android via an
OkHttp `ForwardingSource`). Core-TS also implements bandwidth dripping for both `fetch`
(`ThrottleEngine.throttleResponse` wraps the response stream) and XHR (a completion-delay
formula in `capture/xhr.ts`) — see Limits below for how this squares with SPEC's roadmap note.

## Wire format

Driven remotely as a `throttle.set` `ControlCommand` (`{ profile, latencyMs?, downloadKbps? }`)
— see [Control channel](/spec/control-channel/).

## Test anchors

- `packages/hakka-core/src/engine/ThrottleEngine.test.ts`
- `packages/hakka-core/src/engine/control.test.ts` (`throttle.set` roundtrip)

## Limits & non-goals

- `offline` throws `TypeError('Network request failed — offline mode (Hakka ThrottleEngine)')`
  before any request is sent — this is what the app's own error handling sees.
- No per-endpoint throttle — a profile is global to the engine, unlike mock/breakpoint rules
  which are per-pattern.
- WebSocket traffic is not throttled at all — only `fetch`/XHR.
- **Doc-drift note**: SPEC.md §6 (1.1 roadmap) and `ThrottleEngine.ts`'s own top comment both
  describe byte-rate enforcement as "not yet implemented" / "unused right now — we only
  simulate latency." That is stale relative to the current core-TS source: `throttleResponse`
  (fetch) and the XHR completion-delay path both drip bandwidth for real and are covered by
  `ThrottleEngine.test.ts`'s drip assertions. Treat the code + tests, not the roadmap comment,
  as current behavior; SPEC.md itself is this card's source of truth for the platform matrix
  above, which is unaffected either way.
