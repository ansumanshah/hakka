---
title: Retention
description: Spec card — the bounded ring buffer, age-based eviction, byte-budget eviction, and pause/resume buffering that keep capture memory-safe.
---

## What it does

Captured requests live in a fixed-capacity `RingBuffer` (O(1) add/update/lookup by id and by
URL) that evicts the oldest entry once full. `RetentionPolicy` additionally sweeps entries older
than `maxAge` on every ingest, and the buffer independently evicts oldest-first once retained
body bytes cross `maxBufferBytes` — three independent caps (count, age, bytes), all oldest-first.
`Hakka.pause()`/`resume()` gate the buffer without dropping requests.

## Public API

```ts
import { RingBuffer, RetentionPolicy } from 'hakka-core'

const buffer = new RingBuffer(capacity, maxBufferBytes?)
buffer.add(request)
buffer.update(request) // in-place; true if found
buffer.get(id)
buffer.getAll() // newest-first
buffer.getByUrl(url) // newest-first, O(k) in matches for that URL
buffer.removeOlderThan(maxAgeMs)
buffer.setMaxBufferBytes(n) // re-applies eviction immediately if lower than current total
buffer.bufferBytes // current retained-body byte total
buffer.subscribe(listener)

const policy = new RetentionPolicy(maxAgeMs, { minSweepIntervalMs?, now? })
policy.apply(buffer) // called on every ingest by HakkaFacade.ts
```

```ts
Hakka.pause() // buffer incoming requests without dropping them
Hakka.resume() // flush the buffer and resume dispatch
```

## Config keys + defaults

Verified against `DEFAULT_CONFIG` (`packages/hakka-core/src/model/types.ts`):

| Key              | Default                     | Description                                                                                                                                                       |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxRequests`    | `500`                       | Ring-buffer capacity (count cap).                                                                                                                                 |
| `maxAge`         | `86400` (24 h, seconds)     | Age cap — entries older than this are swept on ingest.                                                                                                            |
| `maxBufferBytes` | `16 * 1024 * 1024` (16 MiB) | Byte cap on retained request+response bodies across the whole buffer.                                                                                             |
| `persist`        | `false`                     | Opt-in persistence across restarts via a `StorageAdapter` (see [Storage](/spec/storage/) for the panel; core persistence is a separate `StorageAdapter` concept). |

`RetentionPolicyOptions.minSweepIntervalMs` (default `0`, i.e. every `apply()` sweeps) lets a
high-throughput caller trade a bounded amount of retention slop for fewer sweeps.

## Platform matrix

SPEC §5 row "Pause/resume" (footnote 2) — the closest matrix row, since retention's
buffer/eviction behavior and pause/resume both live in the same ring-buffer gate:

| Capability   | RN  | iOS | Android | Web |
| ------------ | --- | --- | ------- | --- |
| Pause/resume | ●   | ●   | ●       | ●   |

RN native-mode `pause`/`resume` forwards through the `HakkaMonitor` TurboModule
(`HakkaInterceptor.pause()` on iOS, `LogStore.pause()` via `HakkaInterceptor` on Android) — so
`Hakka.pause()` stops the native engine recording, not just the JS ring buffer. Count/age/byte
caps themselves are not a distinct SPEC §5 row; iOS and Android ship their own
`RetentionPolicy.swift`/`.kt` ports of the same age-cap concept.

## Wire format

None — an in-process buffer, not a wire concept.

## Test anchors

- `packages/hakka-core/src/storage/RetentionPolicy.test.ts`
- `packages/hakka-core/src/storage/RingBuffer.test.ts`
- `ios/Tests/HakkaTests/RetentionPolicyTests.swift`
- `android/hakka-network/src/test/kotlin/com/noodleapps/hakka/RetentionPolicyTest.kt`

## Limits & non-goals

- Byte-budget eviction never evicts the record just inserted/updated, even if that single
  record alone exceeds `maxBufferBytes` — the overage is bounded to one record and re-enforced
  on the next add/update.
- `footprintOf` (the byte accounting) is a character-length approximation of body size, not an
  exact UTF-8 byte count — a soft ceiling, not a hard memory guarantee.
- Retention TTL presets from SPEC §3 (1h/1d/1w/forever) are a UI-level convenience over the same
  `maxAge` config value — there's no separate "TTL preset" API in core.
