# Hakka Android SDK — Contributor Guide

Native Kotlin SDK for network and performance capture. Powers the React Native Android bridge and ships standalone to Maven Central.

## Modules

| Module                   | Purpose                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `hakka-common`           | Shared records, config, store contracts, and sink interfaces                                           |
| `hakka-network`          | `HakkaInterceptor`, `HakkaEventListener`, OkHttp capture pipeline, `CaptureProcessor`, storage, export |
| `hakka-network-noop`     | API-compatible no-op — swap in for release builds                                                      |
| `hakka-performance`      | Optional frame, memory, CPU, and network collectors (`HakkaPerformance`)                               |
| `hakka-performance-noop` | API-compatible no-op performance artifact                                                              |
| `hakka-ui`               | Optional native Android inspector surface                                                              |
| `example`                | Standalone demo app                                                                                    |
| `size-gate`              | Minified APK delta measurement — enforces the 180 KB base budget                                       |

## Build

From the `android/` directory:

```bash
# Build individual modules
./gradlew :hakka-network:build
./gradlew :hakka-network-noop:build
./gradlew :hakka-common:build
./gradlew :hakka-ui:build

# Run tests
./gradlew :hakka-network:test
./gradlew :hakka-common:test

# Build the example app
./gradlew :example:assembleDebug
```

From the repo root:

```bash
bun run build:android
bun run test:android
just studio-core   # open in Android Studio
```

## Performance monitoring (FPS, memory, CPU)

`hakka-performance` ships standalone (see below), but the dead-simple path is through
`hakka-ui`'s one-liner — no manual `HakkaPerformance` wiring required:

```kotlin
val client = OkHttpClient.Builder()
    .installHakka(context, perfMonitoring = true)
    .build()
```

Or start it independently of network capture:

```kotlin
Hakka.startPerf(context)   // FPS, slow/frozen frames, heap memory, CPU
```

Either call starts a process-wide `HakkaPerformance` instance with frame, memory, and
CPU collectors enabled (network-usage sampling is opt-in — pass
`enableNetworkUsageMetrics = true` to `startPerf`). The inspector's **Stats** tab
(`StatsTabController`, one of the five persistent bottom-nav tabs) reads live from
that same instance and renders FPS, jank/frozen frame counts, heap usage, and
process CPU — no extra wiring needed. Stop it with `Hakka.stopPerf(context)`.

## Toolchain

AGP 9.2.1 and Gradle 9.5.1 are intentionally deferred — do not bump them without a tracked decision. OkHttp is a host-provided dependency; `hakka-network` does not bundle it.

## Key Files

**`hakka-network/`**

- `HakkaInterceptor` — OkHttp `Interceptor` entry point. Captures raw facts cheaply on the OkHttp thread, then enqueues work to `CaptureProcessor`. Do not add blocking or allocation-heavy work here.
- `HakkaEventListener` — OkHttp `EventListener` for timing events (DNS, connect, TLS, request, response). Used by the timing waterfall.
- `CaptureProcessor` — off-hot-path worker. Runs header/query/body-field redaction, record mapping, store mutation, and listener notification. Call `flushCaptureProcessing()` in tests for deterministic drain; call `shutdownCaptureProcessing()` when an interceptor is no longer in use.

**`hakka-performance/`**

- `HakkaPerformance` — registers frame, memory, and CPU collectors. Each collector is optional and toggled via `HakkaConfig`. Lightweight by design — measure APK delta before adding any new collector.

**`hakka-common/`**

- Defines `HakkaRecord`, `HakkaConfig`, store contracts, and sink interfaces shared across network, performance, and UI modules. Changing these types has cross-module impact.

## Size Policy

Base artifacts (`hakka-network` + `hakka-performance`) must stay under 180 KB combined APK delta. `hakka-ui` is optional and exempt from the base budget.

```bash
bun run size:android
```

Builds the `:size-gate` app in minified release flavors against an OkHttp-only baseline. The
`baseline` flavor exercises the same `client.newCall(...).execute()` OkHttp path as every Hakka
flavor (see `NetworkExerciser` in `size-gate/src/main/`) — without that, R8 could shrink OkHttp's
own network layer out of `baseline` while every Hakka flavor kept it reachable through
`HakkaInterceptor`, inflating the measured delta with OkHttp's own code, not Hakka's. Prints a
per-module breakdown, writes a report to `android/size-gate/build/reports/size-gate/summary.txt`,
and fails CI if the network or combined base SDK delta exceeds the budget (see
`scripts/android-size-gate.sh` for the budget's derivation and how to re-measure it).

Current measured APK deltas (2026-08-01):

| Module                              |     APK delta | Download delta |
| ----------------------------------- | ------------: | -------------: |
| `hakka-network-noop`                |  87,000 bytes |   86,794 bytes |
| `hakka-network`                     | 134,832 bytes |  134,418 bytes |
| `hakka-performance-noop`            |      96 bytes |      132 bytes |
| `hakka-performance`                 |   1,732 bytes |    1,847 bytes |
| `hakka-network + hakka-performance` | 152,448 bytes |  151,946 bytes |
| `hakka-ui` incremental over network | 330,699 bytes |  283,620 bytes |
| `hakka-network + hakka-ui`          | 465,531 bytes |  418,038 bytes |

## Contributing

Architecture notes, design principles, and SDK design decisions live in the docs contributing section:

https://hakka.noodleapps.com/contributing/architecture
