# Hakka iOS SDK — Contributor Guide

Native Swift implementation of the Hakka network inspector. This package is the iOS/macOS core and the backend for the React Native iOS bridge.

## Package Structure

```
ios/
└── Sources/
    ├── Common/          # HakkaCommon
    ├── Network/         # HakkaNetwork
    ├── NetworkNoop/     # HakkaNetworkNoop
    ├── Performance/     # HakkaPerformance
    ├── PerformanceNoop/ # HakkaPerformanceNoop
    └── UI/              # HakkaUI
```

### Targets

| Target                 | Purpose                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `HakkaCommon`          | Records, config, storage, redaction, and sinks — Foundation-first, no UI imports |
| `HakkaNetwork`         | URLProtocol capture, serial `CaptureProcessor`, and export helpers               |
| `HakkaNetworkNoop`     | Release-safe no-op that mirrors `HakkaNetwork`'s public API exactly              |
| `HakkaPerformance`     | Optional frame, memory (`MACH_TASK_BASIC_INFO`), and CPU collectors              |
| `HakkaPerformanceNoop` | No-op mirror of `HakkaPerformance` for release builds                            |
| `HakkaUI`              | Optional SwiftUI inspector surface — depends on `HakkaCommon` only               |

## Key Files

- `Sources/Network/URLProtocol.swift` — capture entry point; callbacks must enqueue and return immediately
- `Sources/Performance/HakkaPerformance.swift` — uses `MACH_TASK_BASIC_INFO` for memory sampling
- `Sources/Common/` — all shared record types, store protocol, and redaction logic

## Noop Parity Contract

`HakkaNetworkNoop` and `HakkaPerformanceNoop` must expose an **identical public API** to their active counterparts. Any public symbol added to `HakkaNetwork` or `HakkaPerformance` must be added to the corresponding noop target in the same PR. The noop targets exist so release builds can swap products without source changes.

## Architecture

URLProtocol callbacks capture raw facts and enqueue to a serial `CaptureProcessor`. Normalization, redaction, store mutation, and subscriber notification all happen off callback paths. SwiftUI belongs in `HakkaUI` — the base network target must remain Foundation-first and importable without UIKit/SwiftUI.

## Build

Open in Xcode:

```bash
bun run xcode:core
# or
xed ios/
```

From the repository root:

```bash
bun run build:ios
bun run test:ios
```

From this directory:

```bash
swift build
swift test
```

Physical-device benchmark builds require Apple signing. Set `HAKKA_IOS_DEVELOPMENT_TEAM=<team-id>` for generated benchmark targets; set `HAKKA_IOS_ALLOW_PROVISIONING_UPDATES=1` only when Xcode should create or update profiles.

## Testing

Run tests via Xcode (Product → Test) or XcodeBuildMCP's `test_sim` tool. All new capture logic requires unit tests in the `Tests/` directory alongside the target.

## Docs

Public integration docs live in `docs/` (Astro/Starlight). The iOS SDK reference page is `docs/src/content/docs/ios/sdk.md`. Update it when public APIs change.
