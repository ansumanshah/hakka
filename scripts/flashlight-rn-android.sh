#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

DEFAULT_APP_ID="com.noodleapps.hakka.rn"
APP_ID=${HAKKA_FLASHLIGHT_APP_ID:-${HAKKA_FLASHLIGHT_PACKAGE_ID:-$DEFAULT_APP_ID}}
APP_ACTIVITY=${HAKKA_FLASHLIGHT_APP_ACTIVITY:-"$APP_ID/.MainActivity"}
TEST_COMMAND=${HAKKA_FLASHLIGHT_TEST_COMMAND:-}
ITERATION_COUNT=${HAKKA_FLASHLIGHT_ITERATION_COUNT:-10}
DURATION_MS=${HAKKA_FLASHLIGHT_DURATION_MS:-10000}
RESULTS_FILE=${HAKKA_FLASHLIGHT_RESULTS_FILE:-"$ROOT_DIR/artifacts/flashlight-rn-android.json"}
RESULTS_TITLE=${HAKKA_FLASHLIGHT_RESULTS_TITLE:-"Hakka RN Android Benchmark"}
LOG_LEVEL=${HAKKA_FLASHLIGHT_LOG_LEVEL:-info}
DEVICE_SERIAL=${HAKKA_FLASHLIGHT_DEVICE_SERIAL:-${ANDROID_SERIAL:-}}
SKIP_RESTART=${HAKKA_FLASHLIGHT_SKIP_RESTART:-0}
DRY_RUN=${HAKKA_DRY_RUN:-0}
FLASHLIGHT_BIN=${HAKKA_FLASHLIGHT_BIN:-flashlight}
GET_TAP_X=${HAKKA_FLASHLIGHT_GET_TAP_X:-72}
GET_TAP_Y=${HAKKA_FLASHLIGHT_GET_TAP_Y:-356}
BUBBLE_TAP_X=${HAKKA_FLASHLIGHT_BUBBLE_TAP_X:-320}
BUBBLE_TAP_Y=${HAKKA_FLASHLIGHT_BUBBLE_TAP_Y:-420}
SCROLL_X=${HAKKA_FLASHLIGHT_SCROLL_X:-240}
SCROLL_START_Y=${HAKKA_FLASHLIGHT_SCROLL_START_Y:-740}
SCROLL_END_Y=${HAKKA_FLASHLIGHT_SCROLL_END_Y:-360}

default_flow_command() {
    serial=${1:-}
    adb_prefix="adb"
    if [ -n "$serial" ]; then
        adb_prefix="adb -s $serial"
    fi

    printf '%s shell "%s"' "$adb_prefix" "am force-stop $APP_ID; am start -W -n $APP_ACTIVITY; sleep 2; input tap $GET_TAP_X $GET_TAP_Y; sleep 2; input tap $BUBBLE_TAP_X $BUBBLE_TAP_Y; sleep 1; input swipe $SCROLL_X $SCROLL_START_Y $SCROLL_X $SCROLL_END_Y 600; sleep 1"
}

print_help() {
    cat <<EOF
Usage:
  HAKKA_FLASHLIGHT_APP_ID=<bundle-id> \
  HAKKA_FLASHLIGHT_TEST_COMMAND="adb -s <serial> shell <command>" \
  bun run benchmark:rn:android:flashlight

Defaults:
  APP/PACKAGE ID: ${APP_ID}
  ACTIVITY: ${APP_ACTIVITY}
  TEST COMMAND: ${TEST_COMMAND:-$(default_flow_command "<serial>")}
  FLASHLIGHT_BIN: ${FLASHLIGHT_BIN}
  ITERATION_COUNT: ${ITERATION_COUNT}
  DURATION_MS: ${DURATION_MS}
  RESULTS_FILE: ${RESULTS_FILE}
  RESULTS_TITLE: ${RESULTS_TITLE}
  LOG_LEVEL: ${LOG_LEVEL}
  DEVICE_SERIAL: ${DEVICE_SERIAL:-auto-detect}
  SKIP_RESTART: ${SKIP_RESTART}

This lane is ultra-fast:
  - no full build
  - no Metro bootstrap
  - stable default flow: launch app, tap GET, open Monitor, scroll sheet/list

The default command launches the app, so restart is not skipped. Set
HAKKA_FLASHLIGHT_SKIP_RESTART=1 only for custom test commands that do not
start the app themselves.

Flashlight availability:
  If missing, install with:
    curl https://get.flashlight.dev | bash
    export PATH="\$HOME/.flashlight/bin:\$PATH"
EOF
}

flashlight_runner_notfound_help() {
    echo "Could not find the Flashlight CLI: $FLASHLIGHT_BIN"
    echo "Run:"
    echo "  curl https://get.flashlight.dev | bash"
    echo "  export PATH=\"\\\$HOME/.flashlight/bin:\\\$PATH\""
    echo "Or set HAKKA_FLASHLIGHT_BIN=/absolute/path/to/flashlight."
    echo "Then rerun: bun run benchmark:rn:android:flashlight"
}

if [ "$DRY_RUN" = "1" ]; then
    if [ -z "$TEST_COMMAND" ]; then
        TEST_COMMAND=$(default_flow_command "")
    fi

    set -- "$FLASHLIGHT_BIN" test \
        --bundleId "$APP_ID" \
        --testCommand "$TEST_COMMAND" \
        --iterationCount "$ITERATION_COUNT" \
        --duration "$DURATION_MS" \
        --resultsFilePath "$RESULTS_FILE" \
        --resultsTitle "$RESULTS_TITLE" \
        --logLevel "$LOG_LEVEL"

    if [ "$SKIP_RESTART" = "1" ] || [ "$SKIP_RESTART" = "true" ]; then
        set -- "$@" --skipRestart
    fi

    print_help
    printf 'No-op command:\n  %s\n\n' "$*"
    exit 0
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "Missing adb on PATH. Install Android platform-tools and try again."
    exit 1
fi

if ! command -v "$FLASHLIGHT_BIN" >/dev/null 2>&1; then
    flashlight_runner_notfound_help
    exit 1
fi

if [ -n "$DEVICE_SERIAL" ]; then
    DETECTED_SERIAL=$DEVICE_SERIAL
    if ! adb -s "$DETECTED_SERIAL" get-state >/dev/null 2>&1; then
        echo "ADB device $DETECTED_SERIAL is not reachable."
        echo "Set HAKKA_FLASHLIGHT_DEVICE_SERIAL (or ANDROID_SERIAL) to a connected adb device serial."
        exit 1
    fi
else
    DETECTED_SERIAL=$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
fi

if [ -z "$DETECTED_SERIAL" ]; then
    echo "No Android device found."
    echo "Attach a device or start an emulator, then rerun."
    echo "No Metro startup is attempted by this script."
    exit 1
fi

if [ -z "$TEST_COMMAND" ]; then
    TEST_COMMAND=$(default_flow_command "$DETECTED_SERIAL")
fi

if ! adb -s "$DETECTED_SERIAL" shell pm list packages "$APP_ID" | tr -d '\r' | awk -F: -v package="$APP_ID" '$2 == package { found = 1 } END { exit found ? 0 : 1 }'; then
    echo "App '$APP_ID' is not installed on device '$DETECTED_SERIAL'."
    echo "This lane is ultra-fast and does not build or install apps."
    echo "Install it once, then rerun this lane."
    exit 1
fi

mkdir -p "$(dirname "$RESULTS_FILE")"

set -- "$FLASHLIGHT_BIN" test \
    --bundleId "$APP_ID" \
    --testCommand "$TEST_COMMAND" \
    --iterationCount "$ITERATION_COUNT" \
    --duration "$DURATION_MS" \
    --resultsFilePath "$RESULTS_FILE" \
    --resultsTitle "$RESULTS_TITLE" \
    --logLevel "$LOG_LEVEL"

if [ "$SKIP_RESTART" = "1" ] || [ "$SKIP_RESTART" = "true" ]; then
    set -- "$@" --skipRestart
fi

if ! "$@"; then
    echo "Flashlight command failed."
    echo "If the CLI is missing, install with:"
    echo "  curl https://get.flashlight.dev | bash"
    echo "  export PATH=\"\\\$HOME/.flashlight/bin:\\\$PATH\""
    echo "No Metro startup is attempted by this script."
    exit 1
fi

echo "Benchmark completed."
echo "Results: $RESULTS_FILE"
