---
title: Design Principles
description: The core design constraints that guide all Hakka SDK decisions.
---

Hakka is a diagnostics SDK that runs inside other people's apps. The design bar
is different from a standalone tool: it must be small, quiet, local, and
predictable.

## Core First

Backend/native SDK logic comes before UI.

The first-class product surface is capture correctness: what was requested,
what returned, how long it took, what was redacted, and how records can be read
without disturbing the host app. UI only becomes valuable when the record
contract and processor boundaries are trustworthy.

## Native Owns Capture

Android and iOS SDKs own:

- network capture
- redaction
- filters
- body limits
- ring buffers
- native exports
- noop behavior
- performance and size budgets

React Native owns:

- TypeScript API ergonomics
- TurboModule bridge
- JS fallback capture
- native inspector presentation through the TurboModule bridge
- JavaScript-only monitors

## Local First

Hakka must never upload captured data by default. Applications may attach sinks
for analytics, Sentry, Firebase, OpenTelemetry, or private backends, but the
base SDK remains local.

## Bounded Everything

- Fixed record count.
- Fixed body preview size.
- No unbounded persistence.
- No per-event disk writes by default.
- No unbounded sink queues.

When capacity is reached, Hakka drops the oldest low-value local data rather
than increasing memory use.

## Privacy By Default

Sensitive headers are redacted before records reach stores, UI, exports, or
desktop streaming. Body capture is bounded and configurable. Host and URL filters
run before expensive processing whenever possible.

## Hot Paths Stay Thin

Interceptors should capture the raw facts and get out. Redaction, normalization,
serialization, HAR export, desktop emission, and UI notifications belong on
processor queues or snapshot readers.

Budgets:

- interceptor return overhead should stay below 1 ms in normal cases
- lock hold time should stay below 100 microseconds for store mutation
- Android base APK delta must stay below 180 KB after minification

## Optional Means Optional

The core should not pull in UI frameworks, observability SDKs, storage engines,
or large parser libraries. Optional surfaces belong in separate imports,
artifacts, or adapters.

Do not add Nitro, Compose, Material, or other large UI dependencies to core
Hakka modules. Native UI stays in `hakka-ui` (Android) and `HakkaUI` (iOS), and
React Native opens those surfaces through the bridge. Keep capture and programmatic
APIs usable without loading an inspector.

## One Vocabulary

The project is Hakka. Public code, docs, records, tests, and examples should use
Hakka names. Do not reintroduce old project names for models, events, files,
or APIs.
