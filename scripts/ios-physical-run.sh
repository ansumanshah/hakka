#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK_DIR=${HAKKA_IOS_BENCHMARK_WORK_DIR:-"$ROOT_DIR/artifacts/benchmarks/ios/workspace"}
REPORT_DIR=${HAKKA_IOS_PHYSICAL_REPORT_DIR:-"$ROOT_DIR/artifacts/benchmarks/physical/ios"}
VARIANT=${HAKKA_IOS_BENCHMARK_VARIANT:-hakka}
CONFIGURATION=${HAKKA_IOS_BENCHMARK_CONFIGURATION:-Debug}
COUNT=${HAKKA_IOS_BENCHMARK_COUNT:-100}
URL=${HAKKA_IOS_BENCHMARK_URL:-https://example.com}
DEVICE=${HAKKA_IOS_PHYSICAL_DEVICE:-}
TIMEOUT=${HAKKA_IOS_BENCHMARK_TIMEOUT:-120}
DRY_RUN=${HAKKA_DRY_RUN:-0}

case "$VARIANT" in
    baseline)
        SCHEME=BenchmarkBaseline
        BUNDLE_ID=com.noodleapps.hakka.benchmark.BenchmarkBaseline
        ;;
    hakka)
        SCHEME=BenchmarkHakka
        BUNDLE_ID=com.noodleapps.hakka.benchmark.BenchmarkHakka
        ;;
    wormholy)
        SCHEME=BenchmarkWormholy
        BUNDLE_ID=com.noodleapps.hakka.benchmark.BenchmarkWormholy
        ;;
    pulse)
        SCHEME=BenchmarkPulse
        BUNDLE_ID=com.noodleapps.hakka.benchmark.BenchmarkPulse
        ;;
    *)
        echo "Unsupported HAKKA_IOS_BENCHMARK_VARIANT=$VARIANT"
        echo "Use one of: baseline, hakka, wormholy, pulse"
        exit 1
        ;;
esac

APP="$WORK_DIR/DerivedData/Build/Products/$CONFIGURATION-iphoneos/$SCHEME.app"
OUT_FILE="$REPORT_DIR/$VARIANT-runtime.json"
HISTORY_FILE="$REPORT_DIR/runtime-history.json"
SUMMARY_FILE="$REPORT_DIR/runtime-summary.json"
TMP_DIR="$REPORT_DIR/tmp/$VARIANT"

if [ "$DRY_RUN" = "1" ]; then
    cat <<EOF
Physical iOS benchmark run
Variant: $VARIANT
App: $APP
Bundle ID: $BUNDLE_ID
Device: ${DEVICE:-auto-detect}
URL: $URL
Count: $COUNT

Required physical build:
  HAKKA_IOS_BENCHMARK_DESTINATION='generic/platform=iOS' \\
  HAKKA_IOS_BENCHMARK_RELEASE=0 \\
  HAKKA_IOS_CODE_SIGNING_ALLOWED=YES \\
  HAKKA_IOS_DEVELOPMENT_TEAM=<team-id> \\
  HAKKA_IOS_ALLOW_PROVISIONING_UPDATES=1 \\
  bun run benchmark:ios:competitors

Commands:
  xcrun devicectl device install app --device <device> "$APP"
  xcrun devicectl device process launch --device <device> --terminate-existing "$BUNDLE_ID" --run true --count "$COUNT" --url "$URL"
  xcrun devicectl device copy from --device <device> --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" --source Documents/hakka-ios-benchmark-result.json --destination "$TMP_DIR"
  node scripts/benchmark-artifact-metadata.mjs "$OUT_FILE" platform=ios targetKind=physical deviceId=<device> runner=ios-physical-run
  node scripts/ios-runtime-summary.mjs append "$OUT_FILE" "$HISTORY_FILE" "$SUMMARY_FILE"
EOF
    exit 0
fi

if ! command -v xcrun >/dev/null 2>&1; then
    echo "Missing xcrun on PATH. Install Xcode command line tools and try again."
    exit 1
fi

if [ -z "$DEVICE" ]; then
    DEVICE=$(node -e 'import("./scripts/device-readiness.mjs").then(({getDeviceReadiness})=>{const r=getDeviceReadiness(); if (!r.ios.ready) process.exit(1); console.log(r.ios.readyDevices[0].id)})' 2>/dev/null || true)
fi

if [ -z "$DEVICE" ]; then
    echo "No physical iOS device is ready."
    echo "Connect/unlock a device or set HAKKA_IOS_PHYSICAL_DEVICE."
    exit 1
fi

if [ ! -d "$APP" ]; then
    echo "Missing physical iOS benchmark app: $APP"
    echo "Build a signed device app first. Example:"
    echo "  HAKKA_IOS_BENCHMARK_DESTINATION='generic/platform=iOS' HAKKA_IOS_BENCHMARK_RELEASE=0 HAKKA_IOS_CODE_SIGNING_ALLOWED=YES HAKKA_IOS_DEVELOPMENT_TEAM=<team-id> HAKKA_IOS_ALLOW_PROVISIONING_UPDATES=1 bun run benchmark:ios:competitors"
    exit 1
fi

mkdir -p "$REPORT_DIR" "$TMP_DIR"

xcrun devicectl device install app --device "$DEVICE" "$APP" >/dev/null
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID" \
    --run true --count "$COUNT" --url "$URL" >/dev/null

started_at=$(date +%s)
RESULT_FILE="$TMP_DIR/hakka-ios-benchmark-result.json"
rm -f "$RESULT_FILE"
while :; do
    rm -rf "$TMP_DIR"
    mkdir -p "$TMP_DIR"
    if xcrun devicectl device copy from \
        --device "$DEVICE" \
        --domain-type appDataContainer \
        --domain-identifier "$BUNDLE_ID" \
        --source Documents/hakka-ios-benchmark-result.json \
        --destination "$TMP_DIR" >/dev/null 2>&1 && [ -f "$RESULT_FILE" ]; then
        break
    fi

    now=$(date +%s)
    if [ $((now - started_at)) -ge "$TIMEOUT" ]; then
        echo "Timed out waiting for physical iOS benchmark result after ${TIMEOUT}s."
        exit 1
    fi
    sleep 1
done

cp "$RESULT_FILE" "$OUT_FILE"
node "$ROOT_DIR/scripts/benchmark-artifact-metadata.mjs" \
    "$OUT_FILE" \
    platform=ios \
    targetKind=physical \
    deviceId="$DEVICE" \
    runner=ios-physical-run
node "$ROOT_DIR/scripts/ios-runtime-summary.mjs" append "$OUT_FILE" "$HISTORY_FILE" "$SUMMARY_FILE"
echo "Physical iOS runtime benchmark result: $OUT_FILE"
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(`${r.variant}: count=${r.summary.count} success=${r.summary.successCount} failure=${r.summary.failureCount} avgMs=${r.summary.averageDurationMs} rps=${r.summary.requestsPerSecond}`)' "$OUT_FILE"
echo "Physical iOS runtime benchmark summary: $SUMMARY_FILE"
