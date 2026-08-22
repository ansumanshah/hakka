#!/usr/bin/env bash
# One-command Mac app release: notarized build -> GitHub release -> brew cask.
#
# Prereqs (see sign-and-notarize.sh's header for the one-time credential setup):
#   - Developer ID cert + `hakka` notarytool profile in the keychain
#   - `gh` authenticated as ansumanshah
#   - The tap checkout at ~/Code/homebrew-tap
#
# SAFETY: this repo's local `main` carries private history and must never be
# pushed. Releases are cut from the public-release branch only; the tag is
# created on the REMOTE head of that branch via the GitHub API (gh release
# create --target), so nothing here ever pushes local history.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO="ansumanshah/hakka"
TAP_DIR="${TAP_DIR:-$HOME/Code/homebrew-tap}"
# Local staging branch for a release (tracks the REMOTE's public `main`,
# which is a different lineage from this checkout's private local `main`).
RELEASE_BRANCH="${RELEASE_BRANCH:-public-release}"
REMOTE_PUBLIC_BRANCH="${REMOTE_PUBLIC_BRANCH:-main}"
source "$ROOT/version.env"
TAG="v${MARKETING_VERSION}"
ZIP="$ROOT/Hakka-${MARKETING_VERSION}.zip"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# -- Guards ------------------------------------------------------------------
current_branch=$(git -C "$ROOT" branch --show-current)
[[ "$current_branch" == "main" ]] && fail \
  "on 'main' (private history). Release from '$RELEASE_BRANCH': the working tree
  you build from must match what the public tag will point at."
git -C "$ROOT" diff --quiet || fail "working tree dirty — commit or stash first."
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && fail \
  "release $TAG already exists. Bump MARKETING_VERSION (and BUILD_NUMBER) in version.env."
[[ -d "$TAP_DIR/Casks" ]] || fail "tap checkout missing at $TAP_DIR"

remote_head=$(git ls-remote "https://github.com/${REPO}.git" "refs/heads/${REMOTE_PUBLIC_BRANCH}" | cut -f1)
[[ -n "$remote_head" ]] || fail "remote branch '$REMOTE_PUBLIC_BRANCH' not found on ${REPO}."
local_head=$(git -C "$ROOT" rev-parse HEAD)
[[ "$remote_head" == "$local_head" ]] || fail \
  "local HEAD ($local_head) != remote ${REMOTE_PUBLIC_BRANCH} ($remote_head).
  The tag must point at exactly what you built. Check out '$RELEASE_BRANCH'
  synced to the remote public branch first (git fetch origin ${REMOTE_PUBLIC_BRANCH} && git checkout -B ${RELEASE_BRANCH} FETCH_HEAD)."

# -- Build + notarize --------------------------------------------------------
"$ROOT/Scripts/sign-and-notarize.sh"
[[ -f "$ZIP" ]] || fail "expected $ZIP from sign-and-notarize.sh"
SHA256=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)

# -- GitHub release (tag created server-side on the public branch head) ------
gh release create "$TAG" "$ZIP" \
  --repo "$REPO" \
  --target "$remote_head" \
  --title "Hakka ${MARKETING_VERSION}" \
  --generate-notes

# -- Brew cask ---------------------------------------------------------------
sed -e "s/__VERSION__/${MARKETING_VERSION}/" -e "s/__SHA256__/${SHA256}/" \
  "$TAP_DIR/Casks/hakka.rb.template" > "$TAP_DIR/Casks/hakka.rb"
git -C "$TAP_DIR" add Casks/hakka.rb
git -C "$TAP_DIR" commit -m "hakka ${MARKETING_VERSION}"
git -C "$TAP_DIR" push

echo "Released ${TAG}:"
echo "  https://github.com/${REPO}/releases/tag/${TAG}"
echo "  brew install ansumanshah/tap/hakka"
