#!/bin/bash
# Quick rebuild + relaunch script for Hakka iOS demo app.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

PROJECT="${PROJECT:-HakkaDemoApp.xcodeproj}"
SCHEME="${SCHEME:-HakkaDemoApp}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$REPO_ROOT/.build/ios-demo}"

select_simulator() {
    if [[ -n "${SIM_ID:-}" ]]; then
        echo "$SIM_ID"
        return
    fi

    local booted
    booted=$(
        xcrun simctl list devices available |
            sed -nE '/iPhone/ s/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' |
            head -1
    )
    if [[ -n "$booted" ]]; then
        echo "$booted"
        return
    fi

    xcrun simctl list devices available |
        sed -nE '/iPhone/ s/.*\(([0-9A-F-]{36})\) \((Booted|Shutdown)\).*/\1/p' |
        head -1
}

SIM_ID=$(select_simulator)
if [[ -z "$SIM_ID" ]]; then
    echo "No available iPhone simulator found." >&2
    exit 1
fi

DESTINATION="platform=iOS Simulator,id=$SIM_ID"
APP="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphonesimulator/${SCHEME}.app"

echo "==> Building $SCHEME for simulator $SIM_ID..."
xcodebuild build \
    -project "$SCRIPT_DIR/$PROJECT" \
    -scheme "$SCHEME" \
    -destination "$DESTINATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -configuration "$CONFIGURATION" \
    CODE_SIGNING_ALLOWED=NO \
    -quiet

if [[ ! -d "$APP" ]]; then
    echo "Built app was not found at $APP" >&2
    exit 1
fi

BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")

echo "==> Booting simulator..."
xcrun simctl boot "$SIM_ID" 2>/dev/null || true
xcrun simctl bootstatus "$SIM_ID" -b >/dev/null

echo "==> Installing $BUNDLE_ID..."
xcrun simctl terminate "$SIM_ID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$SIM_ID" "$APP"

echo "==> Launching..."
xcrun simctl launch "$SIM_ID" "$BUNDLE_ID"

echo "==> Done! App is running."
