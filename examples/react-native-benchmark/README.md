# React Native inspector benchmark

This fixture measures actual React Native `fetch` and XHR traffic through native
inspectors. It has its own dependency lock and generated native apps, so its
reference variants do not change the production SDK toolchain or shipped packages.

Versions verified on September 6, 2026:

| Component                | Version                                   | Source                                                                             |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| React Native / Hermes    | 0.87.1 / bundled Hermes                   | [React Native release](https://github.com/react/react-native/releases/tag/v0.87.1) |
| React                    | 19.2.3                                    | React Native host dependency                                                       |
| Hakka                    | Current local checkout, 0.0.1 pre-release | Record the tested commit and local diff with results                               |
| Chucker                  | 4.3.1                                     | [Chucker release](https://github.com/ChuckerTeam/chucker/releases/tag/4.3.1)       |
| Pulse, including PulseUI | 5.2.3                                     | [Pulse release](https://github.com/kean/Pulse/releases/tag/5.2.3)                  |
| Wormholy                 | 2.4.0                                     | [Wormholy tag](https://github.com/pmusolino/Wormholy/tree/2.4.0)                   |

The Android benchmark host uses a Kotlin compiler compatible with Chucker 4.3.1;
all Android variants use that same toolchain. All iOS variants use dynamic
framework linkage, which Wormholy requires. Pulse's fixture-local podspecs compile
its official tagged sources, including the native UI.

## Workload and validity

Each run makes 100 serial requests, alternating fetch and XHR. Response sizes
rotate through 0 B, 256 B, and 16 KiB from a local HTTP server. The server sends ASCII `x` with `text/plain; charset=utf-8`. Every response must
have status 200 and the exact expected body length. Request duration ends after
the response body is read; a separately scheduled zero-delay timer measures JS
callback delay. Native-store settling and result export happen outside that timer.

An inspector run also needs capture correctness: exactly 100 retained requests,
with representative body contents intact. Hakka checks exact captured text;
Chucker checks declared and decoded body lengths in its persisted HAR. Pulse uses its public store API. Wormholy does
not expose a public store-count API, so its JSON count is `null`; native UI or
export evidence is required before treating its run as capture-verified.

Use Release builds with embedded JavaScript and Hermes. Keep the native inspector
closed during timing, omit optional continuous performance monitors, and reset
application data between runs so persisted captures do not accumulate. Run at
least five rounds with rotated variant order, the same target and server, and no
concurrent builds or other benchmark workloads. Retain the raw samples and report
both per-run median/p95 and variation across runs.

Simulator and emulator results describe those environments. They do not establish
physical-device frame rate, battery use, or a cross-platform speed ranking.

## Install the isolated host

Run from this directory. Choose a location with room for native build outputs:

```sh
export HAKKA_RN_BENCHMARK_HOST=/tmp/hakka-rn-benchmark/host
node scripts/install-host.mjs
node scripts/verify-server.mjs
node scripts/local-server.mjs
```

The installer uses the committed npm lock and creates a fresh RN 0.87.1 native
host. It refuses to replace an existing host. Set `HAKKA_RN_BENCHMARK_NPM_CACHE` to
place its npm cache on another volume if needed. Generated applications share
this host's installed dependencies.

## Android

Prepare each variant separately: `baseline`, `hakka`, or `chucker`.

```sh
export HAKKA_RN_BENCHMARK_VARIANT=baseline
export HAKKA_RN_BENCHMARK_OUTPUT=/tmp/hakka-rn-benchmark/android-baseline
BENCHMARK_PLATFORM=android node scripts/prepare-app.mjs
cd "$HAKKA_RN_BENCHMARK_OUTPUT/android"
./gradlew :app:assembleBaselineRelease -PreactNativeArchitectures=arm64-v8a
```

Use `assembleChuckerRelease` for Chucker. Hakka defaults to an on-demand Play
feature for the full native UI. Build `:app:bundleHakkaRelease`, then use
bundletool with the same target device specification to build and install APKs.
Install only `base` for capture timing and initial-download measurements. For a
separate native UI check, install `base,hakkaInspector` before launching the app.
An app APK alone does not contain the inspector feature.

Install the matching APK, reset its app data, and explicitly launch
`com.noodleapps.hakka.rn/.MainActivity`. The workload starts automatically and
writes `hakka-rn-benchmark-result.json` in the application's external files
directory. The emulator reaches the server at `http://10.0.2.2:4177`.

For a separate UI check, launch with `--ez hakkaBenchmarkShowUI true`. Hakka shows
its native bubble after results are written; long-press it to open the full
inspector. A preinstalled feature check does not verify an immediate download
through Google Play. Validate that delivery path separately using Internal App
Sharing. Keep UI checks out of timing runs.

For size comparisons, use minified release bundles for the same host, ABI, and
resources. Report the baseline delta, initial download, optional feature download,
and all-installed total separately. A whole AAB file size is not the initial
Google Play download size.

## iOS

Prepare each variant separately: `baseline`, `hakka`, `pulse`, or `wormholy`.

```sh
export HAKKA_RN_BENCHMARK_VARIANT=pulse
export HAKKA_RN_BENCHMARK_OUTPUT=/tmp/hakka-rn-benchmark/ios-pulse
BENCHMARK_PLATFORM=ios node scripts/prepare-app.mjs
cd "$HAKKA_RN_BENCHMARK_OUTPUT/ios"
pod install
```

Build `HakkaRNExample.xcworkspace`, scheme `HakkaRNExample`, in Release for the
same simulator or device. Its bundle ID is
`com.noodleapps.hakka.rn.benchmark.<variant>`. Launch with
`--hakka-benchmark-autorun`. The app writes `hakka-rn-benchmark-result.json` to its
Documents directory and reaches the simulator's host at `http://127.0.0.1:4177`.

For a separate UI correctness check, add `--hakka-benchmark-show-ui`; the native
UI appears after results are written. For Hakka, long-press the bubble to open the
full inspector. Keep this flag out of timing runs.
Record the Xcode version, OS, model, build settings, dependency versions, Hakka
source revision, and result files alongside every comparison.

## Repeatable simulator runs

Build each iOS variant into a separate DerivedData directory named
`final-ios-baseline`, `final-ios-hakka`, `final-ios-pulse`, and
`final-ios-wormholy`. Then, with the server running and builds stopped:

```sh
node scripts/run-ios-simulator.mjs \
  --device "$SIMULATOR_UDID" \
  --apps /tmp/hakka-rn-benchmark/DerivedData \
  --output /tmp/hakka-rn-benchmark/results/ios \
  --rounds 5
```

The runner reinstalls each app between runs, rotates order, and refuses to
overwrite existing results. Capture counts alone are insufficient evidence of
body fidelity. Keep separate native export/body checks alongside the timing JSON.

A September 7, 2026 check of Pulse 5.2.3's automatic proxy on RN 0.87.1 and the
iOS 26.5 simulator retained 100 requests but duplicated bytes in non-empty
response bodies. The fixture uses its public `NetworkLogger.enableProxy()` API
without modifying Pulse sources. Treat those timings as a diagnostic result,
not a full-fidelity comparison, until that configuration passes body checks.
This observation does not establish behavior on other iOS versions or devices.
