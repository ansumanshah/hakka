#!/usr/bin/env bash
# Release build: universal binary, Developer ID signing, notarization, staple, zip.
#
# One-time setup (owner, both steps need your Apple ID):
#   1. Developer ID Application certificate:
#      Xcode > Settings > Accounts > (team) > Manage Certificates... > + >
#      "Developer ID Application". Verify with:
#        security find-identity -v -p codesigning | grep "Developer ID"
#   2. Notarization credentials (app-specific password from appleid.apple.com):
#        xcrun notarytool store-credentials hakka \
#          --apple-id <apple-id> --team-id BR3WT6376A --password <app-specific-password>
#
# Then: Scripts/sign-and-notarize.sh
# Re-releases: bump BUILD_NUMBER in version.env first (Apple rejects duplicate uploads).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP_NAME=${APP_NAME:-Hakka}
APP_BUNDLE="$ROOT/${APP_NAME}.app"
NOTARY_PROFILE=${NOTARY_PROFILE:-hakka}
source "$ROOT/version.env"
ZIP_NAME="$ROOT/${APP_NAME}-${MARKETING_VERSION}.zip"

# Resolve the Developer ID identity from the keychain unless pinned via env.
if [[ -z "${APP_IDENTITY:-}" ]]; then
  APP_IDENTITY=$(security find-identity -v -p codesigning \
    | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
fi
if [[ -z "${APP_IDENTITY}" ]]; then
  echo "No 'Developer ID Application' identity in the keychain — see the setup" >&2
  echo "comment at the top of this script (Apple Development certs cannot" >&2
  echo "notarize; Gatekeeper only trusts Developer ID for direct distribution)." >&2
  exit 1
fi

if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "notarytool profile '$NOTARY_PROFILE' missing or invalid — run the" >&2
  echo "store-credentials command in the setup comment at the top of this script." >&2
  exit 1
fi

echo "==> Building universal release + packaging"
# package_app.sh builds per-arch, lipos, assembles the bundle, and signs every
# nested binary/framework inside-out with the same identity.
SIGNING_MODE=identity APP_IDENTITY="$APP_IDENTITY" ARCHES="arm64 x86_64" \
  "$ROOT/Scripts/package_app.sh" release

echo "==> Signing app bundle (hardened runtime)"
APP_ENTITLEMENTS="$ROOT/.build/entitlements/${APP_NAME}.entitlements"
codesign --force --timestamp --options runtime --sign "$APP_IDENTITY" \
  --entitlements "$APP_ENTITLEMENTS" \
  "$APP_BUNDLE"

echo "==> Notarizing (waits for Apple)"
NOTARIZE_ZIP=$(mktemp -t "${APP_NAME}Notarize").zip
trap 'rm -f "$NOTARIZE_ZIP"' EXIT
/usr/bin/ditto --norsrc -c -k --keepParent "$APP_BUNDLE" "$NOTARIZE_ZIP"
xcrun notarytool submit "$NOTARIZE_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> Stapling + verifying"
xcrun stapler staple "$APP_BUNDLE"
xattr -cr "$APP_BUNDLE"
find "$APP_BUNDLE" -name '._*' -delete
spctl -a -t exec -vv "$APP_BUNDLE"
xcrun stapler validate "$APP_BUNDLE"

/usr/bin/ditto --norsrc -c -k --keepParent "$APP_BUNDLE" "$ZIP_NAME"
echo "Done: $ZIP_NAME"
