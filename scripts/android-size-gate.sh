#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ANDROID_DIR="$ROOT_DIR/android"

# Budgets are based on minified release APK deltas measured 2026-09-05.
#
#   base SDK: 27.7 KB (28,404 bytes), budget 40 KB
#   Compose UI over base SDK: 1,418,965 bytes, budget 1.5 MiB (2026-09-06).
#   Replaces the classic Views UI; includes Compose runtime, foundation, Material 3,
#   and Activity integration in a host that otherwise does not use Compose.
#   The optional UI budget allows about 10% headroom; base SDK budget is unchanged.
#
# RN-only reflection entry points are retained by the RN package consumer rules;
# native-only hosts can shrink unused bridge methods without losing native UI.
# These deltas measure native SDK artifacts, not a React Native host APK.
#
# The `android/size-gate` app's `baseline` flavor now performs the same
# `client.newCall(...).execute()` OkHttp call as every Hakka flavor
# (`NetworkExerciser.exercise`, wired into each `size-gate/src/<flavor>/.../SizeGate.kt`).
# Before that change `baseline` never called the client it built, so R8 shrank
# OkHttp's real network layer out of it while every Hakka variant kept that
# layer reachable through HakkaInterceptor's own use of it — inflating the
# measured Hakka delta by ~70 KB of OkHttp's own code, not Hakka's. With every
# flavor exercising the same OkHttp surface, the delta isolates Hakka's added
# classes.
#
# Re-measure: `just` or `./scripts/android-size-gate.sh` from repo root, or
# `cd android && ./gradlew :size-gate:assembleBaselineRelease :size-gate:assembleNetworkRelease
# :size-gate:assembleBaseSdkRelease` and diff the three release APK sizes directly.
# If a real feature addition pushes the base SDK delta past budget, re-baseline
# this comment (not just the number) with the new measurement and rationale —
# don't silently widen the budget to whatever makes the build green.
BUDGET_BYTES=${HAKKA_ANDROID_SIZE_BUDGET_BYTES:-40960}
UI_BUDGET_BYTES=${HAKKA_ANDROID_UI_SIZE_BUDGET_BYTES:-1572864}

find_apkanalyzer() {
    if command -v apkanalyzer >/dev/null 2>&1; then
        command -v apkanalyzer
        return
    fi

    for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
        if [ -n "$sdk" ] && [ -d "$sdk/cmdline-tools" ]; then
            found=$(find "$sdk/cmdline-tools" -path "*/bin/apkanalyzer" -type f | sort | tail -n 1)
            if [ -n "$found" ]; then
                printf '%s\n' "$found"
                return
            fi
        fi
    done
}

file_size_bytes() {
    if stat -f %z "$1" >/dev/null 2>&1; then
        stat -f %z "$1"
    else
        stat -c %s "$1"
    fi
}

human_bytes() {
    awk -v bytes="$1" 'BEGIN {
        split("B KB MB GB", units, " ");
        value = bytes + 0;
        unit = 1;
        while (value >= 1024 && unit < 4) {
            value /= 1024;
            unit++;
        }
        printf "%.1f %s", value, units[unit];
    }'
}

find_variant_apk() {
    variant=$1
    dir="$ANDROID_DIR/size-gate/build/outputs/apk/$variant/release"
    apk=$(find "$dir" -name "*.apk" -type f | sort | tail -n 1)
    if [ -z "$apk" ]; then
        printf 'Missing APK for variant %s under %s\n' "$variant" "$dir" >&2
        exit 1
    fi
    printf '%s\n' "$apk"
}

download_size() {
    apk=$1
    if [ -n "${APK_ANALYZER:-}" ]; then
        "$APK_ANALYZER" apk download-size "$apk" 2>/dev/null || printf ''
    else
        printf ''
    fi
}

print_variant_row() {
    variant=$1
    apk=$2
    bytes=$3
    download=$4
    if [ -n "$download" ]; then
        printf '%-16s %10s %12s %s\n' "$variant" "$(human_bytes "$bytes")" "$(human_bytes "$download")" "$apk"
    else
        printf '%-16s %10s %12s %s\n' "$variant" "$(human_bytes "$bytes")" "n/a" "$apk"
    fi
}

download_delta() {
    high=$1
    low=$2
    if [ -n "$high" ] && [ -n "$low" ]; then
        printf '%s\n' $((high - low))
    else
        printf ''
    fi
}

print_module_row() {
    module=$1
    apk_delta=$2
    download_delta_value=$3
    note=$4
    if [ -n "$download_delta_value" ]; then
        printf '%-18s %12s %16s %s\n' "$module" "$(human_bytes "$apk_delta")" "$(human_bytes "$download_delta_value")" "$note"
    else
        printf '%-18s %12s %16s %s\n' "$module" "$(human_bytes "$apk_delta")" "n/a" "$note"
    fi
}

cd "$ANDROID_DIR"
./gradlew \
    :size-gate:assembleBaselineRelease \
    :size-gate:assembleNoopRelease \
    :size-gate:assembleNetworkRelease \
    :size-gate:assemblePerformanceNoopRelease \
    :size-gate:assemblePerformanceRelease \
    :size-gate:assembleBaseSdkRelease \
    :size-gate:assembleFullRelease

APK_ANALYZER=$(find_apkanalyzer || true)
if [ -z "$APK_ANALYZER" ]; then
    printf 'Warning: apkanalyzer not found; reporting file size only.\n' >&2
fi

baseline_apk=$(find_variant_apk baseline)
noop_apk=$(find_variant_apk noop)
network_apk=$(find_variant_apk network)
performance_noop_apk=$(find_variant_apk performanceNoop)
performance_apk=$(find_variant_apk performance)
base_sdk_apk=$(find_variant_apk baseSdk)
full_apk=$(find_variant_apk full)

baseline_bytes=$(file_size_bytes "$baseline_apk")
noop_bytes=$(file_size_bytes "$noop_apk")
network_bytes=$(file_size_bytes "$network_apk")
performance_noop_bytes=$(file_size_bytes "$performance_noop_apk")
performance_bytes=$(file_size_bytes "$performance_apk")
base_sdk_bytes=$(file_size_bytes "$base_sdk_apk")
full_bytes=$(file_size_bytes "$full_apk")
noop_delta=$((noop_bytes - baseline_bytes))
network_delta=$((network_bytes - baseline_bytes))
performance_noop_delta=$((performance_noop_bytes - baseline_bytes))
performance_delta=$((performance_bytes - baseline_bytes))
performance_over_network_delta=$((base_sdk_bytes - network_bytes))
base_sdk_delta=$((base_sdk_bytes - baseline_bytes))
full_delta=$((full_bytes - baseline_bytes))
ui_delta=$((full_bytes - base_sdk_bytes))

baseline_download=$(download_size "$baseline_apk")
noop_download=$(download_size "$noop_apk")
network_download=$(download_size "$network_apk")
performance_noop_download=$(download_size "$performance_noop_apk")
performance_download=$(download_size "$performance_apk")
base_sdk_download=$(download_size "$base_sdk_apk")
full_download=$(download_size "$full_apk")

noop_download_delta=$(download_delta "$noop_download" "$baseline_download")
network_download_delta=$(download_delta "$network_download" "$baseline_download")
performance_noop_download_delta=$(download_delta "$performance_noop_download" "$baseline_download")
performance_download_delta=$(download_delta "$performance_download" "$baseline_download")
performance_over_network_download_delta=$(download_delta "$base_sdk_download" "$network_download")
base_sdk_download_delta=$(download_delta "$base_sdk_download" "$baseline_download")
full_download_delta=$(download_delta "$full_download" "$baseline_download")
ui_download_delta=$(download_delta "$full_download" "$base_sdk_download")

printf '\nAndroid APK size gate\n'
printf 'Baseline: host app with OkHttp linked, no Hakka artifacts.\n'
printf 'Budget: base SDK delta <= %s (%s bytes)\n\n' "$(human_bytes "$BUDGET_BYTES")" "$BUDGET_BYTES"
printf 'UI budget: UI delta over base SDK <= %s (%s bytes)\n\n' "$(human_bytes "$UI_BUDGET_BYTES")" "$UI_BUDGET_BYTES"
printf '%-16s %10s %12s %s\n' "Variant" "APK size" "Download" "APK"
print_variant_row baseline "$baseline_apk" "$baseline_bytes" "$baseline_download"
print_variant_row noop "$noop_apk" "$noop_bytes" "$noop_download"
print_variant_row network "$network_apk" "$network_bytes" "$network_download"
print_variant_row performance-noop "$performance_noop_apk" "$performance_noop_bytes" "$performance_noop_download"
print_variant_row performance "$performance_apk" "$performance_bytes" "$performance_download"
print_variant_row base-sdk "$base_sdk_apk" "$base_sdk_bytes" "$base_sdk_download"
print_variant_row full "$full_apk" "$full_bytes" "$full_download"

printf '\nHakka-only module breakdown vs OkHttp baseline:\n'
printf '%-18s %12s %16s %s\n' "Module" "APK delta" "Download delta" "Notes"
print_module_row "hakka-network-noop" "$noop_delta" "$noop_download_delta" "release opt-out artifact"
print_module_row "hakka-network" "$network_delta" "$network_download_delta" "base SDK budget target"
print_module_row "hakka-perf-noop" "$performance_noop_delta" "$performance_noop_download_delta" "performance opt-out artifact"
print_module_row "hakka-performance" "$performance_delta" "$performance_download_delta" "performance artifact alone"
print_module_row "perf over network" "$performance_over_network_delta" "$performance_over_network_download_delta" "incremental over hakka-network"
print_module_row "network + perf" "$base_sdk_delta" "$base_sdk_download_delta" "base SDK budget target"
print_module_row "hakka-ui" "$ui_delta" "$ui_download_delta" "incremental over base SDK"
print_module_row "base SDK + UI" "$full_delta" "$full_download_delta" "total optional native inspector"

report_dir="$ANDROID_DIR/size-gate/build/reports/size-gate"
mkdir -p "$report_dir"
cat > "$report_dir/summary.txt" <<EOF
Android APK size gate
budget_bytes=$BUDGET_BYTES
baseline_bytes=$baseline_bytes
noop_bytes=$noop_bytes
network_bytes=$network_bytes
performance_noop_bytes=$performance_noop_bytes
performance_bytes=$performance_bytes
base_sdk_bytes=$base_sdk_bytes
full_bytes=$full_bytes
noop_delta_bytes=$noop_delta
network_delta_bytes=$network_delta
performance_noop_delta_bytes=$performance_noop_delta
performance_delta_bytes=$performance_delta
performance_over_network_delta_bytes=$performance_over_network_delta
base_sdk_delta_bytes=$base_sdk_delta
ui_delta_bytes=$ui_delta
full_delta_bytes=$full_delta
baseline_download_bytes=$baseline_download
noop_download_bytes=$noop_download
network_download_bytes=$network_download
performance_noop_download_bytes=$performance_noop_download
performance_download_bytes=$performance_download
base_sdk_download_bytes=$base_sdk_download
full_download_bytes=$full_download
noop_download_delta_bytes=$noop_download_delta
network_download_delta_bytes=$network_download_delta
performance_noop_download_delta_bytes=$performance_noop_download_delta
performance_download_delta_bytes=$performance_download_delta
performance_over_network_download_delta_bytes=$performance_over_network_download_delta
base_sdk_download_delta_bytes=$base_sdk_download_delta
ui_download_delta_bytes=$ui_download_delta
full_download_delta_bytes=$full_download_delta
baseline_apk=$baseline_apk
noop_apk=$noop_apk
network_apk=$network_apk
performance_noop_apk=$performance_noop_apk
performance_apk=$performance_apk
base_sdk_apk=$base_sdk_apk
full_apk=$full_apk
EOF

if [ "$network_delta" -gt "$BUDGET_BYTES" ]; then
    printf '\nFAIL: network delta exceeds budget. See %s/summary.txt\n' "$report_dir" >&2
    exit 1
fi

if [ "$base_sdk_delta" -gt "$BUDGET_BYTES" ]; then
    printf '\nFAIL: base SDK delta exceeds budget. See %s/summary.txt\n' "$report_dir" >&2
    exit 1
fi

ui_gate_delta=$ui_delta

if [ "$ui_gate_delta" -gt "$UI_BUDGET_BYTES" ]; then
    printf '\nFAIL: UI delta exceeds budget. See %s/summary.txt\n' "$report_dir" >&2
    exit 1
fi

printf '\nPASS: base SDK and UI deltas are within budget. Report: %s/summary.txt\n' "$report_dir"
