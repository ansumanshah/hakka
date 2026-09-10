---
title: Benchmarks
description: Hakka size and runtime measurements against uninstrumented baseline harnesses.
---

Benchmark data is collected from simulator/emulator runs unless noted. Physical-device
confirmation is pending for all platforms.

## Android APK Size

Variants built from the same `android/benchmark` harness against a common OkHttp baseline:

| Variant  | Build type | APK bytes | Delta over baseline |
| -------- | ---------- | --------: | ------------------: |
| baseline | debug      | 1,409,554 |                   — |
| hakka    | debug      | 1,811,912 |            +402,358 |
| baseline | release    |   165,939 |                   — |
| hakka    | release    |   315,239 |            +149,300 |

The minified Hakka release APK adds 149,300 bytes (145.8 KB) over this harness's baseline. The
`hakka` flavor links **`hakka-network` + `hakka-performance`**, and the app carries its own
ProGuard rules. (An earlier version of this table read +78,828 bytes — measured before
`hakka-network` grew mock rules, breakpoints, mock/bridge discovery, WebSocket capture, and OTel
export; that number was stale, not wrong at the time, and is corrected here.)

> **This harness and the CI size gate now agree, within noise.** The `HAKKA_ANDROID_SIZE_BUDGET_BYTES`
> gate (`scripts/android-size-gate.sh`) uses a separate `android/size-gate` harness with a
> deliberately empty ProGuard file, so it measures a consumer that gets **only** the rules Hakka's
> own artifacts ship. Until 2026-08-01 that harness's `baseline` flavor built an `OkHttpClient` but
> never called it, so R8 could shrink OkHttp's own network layer out of `baseline` while every
> Hakka flavor kept that layer reachable through `HakkaInterceptor` — inflating the gate's measured
> delta by OkHttp's own code, not Hakka's (201.9 KB, largely OkHttp reachability noise). The gate's
> `baseline` now performs the same `client.newCall(...).execute()` call as every Hakka flavor
> (`NetworkExerciser`, `android/size-gate/src/main/`), which dropped its measured **`hakka-network`
>
> - `hakka-performance`** delta to 152,448 bytes (148.9 KB) — close to this harness's 149,300-byte
>   figure above, despite the two apps still differing in scaffolding (this harness executes real
>   HTTP calls and writes JSON results to disk; the gate app only builds and links the client) and
>   ProGuard file (this harness's own rules vs. the gate's empty one, so only the AAR-bundled
>   consumer rules apply). The CI budget is 184,320 bytes (180 KB) — the 152,448-byte measurement
>   plus ~21% headroom; see `scripts/android-size-gate.sh` for the full derivation and how to
>   re-measure it.

## Android Runtime (emulator, 100 requests)

| Variant  | Average ms | Requests/sec | Delta vs baseline |
| -------- | ---------: | -----------: | ----------------: |
| baseline |      15.68 |        62.93 |              0.0% |
| hakka    |      15.25 |        64.39 |             -2.7% |

> **Regenerate before publishing.** The `hakka` variant above was measured with
> body capture **off** (`maxBodySize = 0`). The benchmark variant now enables a
> 256 KB cap, but a clean re-run needs a **low-latency endpoint**: over an emulator,
> `httpbin.org` round-trips (and its frequent `503`s) dwarf the microsecond-scale
> interceptor cost. Run against a local server (`http://10.0.2.2:PORT`) or a CI
> fixture and refresh this table.

Hakka does per-request work in memory with an `ArrayDeque` and `HashMap` ring
buffer, then defers redaction and serialization to a background executor.

## iOS App Size

Variants built for the iOS Simulator against a URLSession baseline:

| Variant  | Configuration | App bytes | Delta over baseline |
| -------- | ------------- | --------: | ------------------: |
| baseline | debug         |   549,551 |                   — |
| hakka    | debug         | 3,606,583 |          +3,057,032 |
| baseline | release       |   284,687 |                   — |
| hakka    | release       | 2,184,951 |          +1,900,264 |

## iOS Runtime (simulator, 3-run means, 100 requests each)

| Variant  | Mean average ms | Mean req/sec | Delta vs baseline |
| -------- | --------------: | -----------: | ----------------: |
| baseline |           14.07 |        72.72 |              0.0% |
| hakka    |           13.30 |        74.88 |             -5.5% |

Repeated-run raw averages:

| Variant  | Run 1 avg ms | Run 2 avg ms | Run 3 avg ms |
| -------- | -----------: | -----------: | -----------: |
| baseline |         17.5 |         11.7 |         13.0 |
| hakka    |         13.7 |         13.0 |         13.2 |

Hakka is 5.5% below the baseline mean on this simulator sample. The target is
within 5% of baseline; physical-device confirmation is still open.

## React Native Mode Runtime (deterministic harness, 100 requests)

| Mode          | Captured | Native records | JS records | Duplicate records | Average loop ms | P95 loop ms |
| ------------- | -------: | -------------: | ---------: | ----------------: | --------------: | ----------: |
| native        |      100 |            100 |          0 |                 0 |           1.253 |       1.327 |
| js            |      100 |              0 |        100 |                 0 |           1.221 |       1.436 |
| auto-native   |      100 |            100 |          0 |                 0 |           1.169 |       1.333 |
| auto-fallback |      100 |              0 |        100 |                 0 |           1.193 |       1.424 |

All four modes capture every request with 0 duplicate records.

## React Native Android Flashlight (10 iterations, emulator)

| Metric                   |     Value |
| ------------------------ | --------: |
| iterations               |        10 |
| successful iterations    |        10 |
| samples                  |       210 |
| FPS average              |     54.60 |
| FPS p50                  |     59.16 |
| FPS p95                  |     60.00 |
| FPS min                  |      0.91 |
| RAM average              | 383.46 MB |
| RAM p95                  | 491.41 MB |
| RAM max                  | 496.02 MB |
| UI thread CPU average    |    11.44% |
| JS thread CPU average    |    13.20% |
| RenderThread CPU average |     4.59% |

## Running Benchmarks

All benchmark entry points are `just` recipes (run `just --list` for the full set):

```bash
# Core engine micro-benchmarks (table + RESULTS.md; -check gates on budgets)
just bench-core
just bench-core-check

# hakka-browser capture overhead (+ budget gate)
just bench-web
just bench-web-check

# hakka-node capture overhead: fetch() + node:http (+ budget gate)
just bench-node
just bench-node-check

# Steady-state heap footprint of a filled store
just bench-heap

# iOS runtime benchmarks (Swift, run on an otherwise idle machine)
just bench-ios
just bench-ios-summary

# React Native capture-mode harness
just bench-rn

# React Native Android Flashlight run
just bench-android

# Verify saved benchmark artifacts are complete
just bench-verify
```

Physical-device collection requires an attached Android device or a signed iOS
device; run `just devices` to check device readiness first. Benchmark runs write
their raw artifacts to a local `artifacts/benchmarks/` directory (not committed),
and `just bench-verify` checks a completed collection for missing pieces.
