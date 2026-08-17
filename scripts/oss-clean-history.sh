#!/usr/bin/env bash
# oss-clean-history.sh — prepare a clean-history public-release branch.
#
# WHAT THIS DOES (and only this):
#   1. Prints a pre-flight checklist and requires a typed confirmation.
#      It does NOT run tests/build/lint itself — you must have already run
#      them (see the checklist it prints below).
#   2. Mirrors the CURRENT full private history to:
#        - a local `private-archive` branch (no history dropped), and
#        - a `git bundle` file outside the repo (belt + suspenders backup).
#   3. Creates a brand-new orphan branch `public-release` with ZERO history
#      and one commit ("feat: initial public release") containing exactly
#      the tracked working tree (git add -A, so .gitignore rules apply).
#   4. Re-runs a lightweight leak scan against the staged files right before
#      committing, and aborts if it finds anything.
#   5. Prints the exact commands the OWNER runs by hand afterwards
#      (create remote repo, add remote, push, tag). It NEVER pushes and
#      NEVER touches any remote itself.
#
# This script is meant to be READ before it is run. It is interactive and
# will not proceed past the checklist without a typed "yes".
#
# Usage:
#   scripts/oss-clean-history.sh            # interactive, does the real thing
#   scripts/oss-clean-history.sh --dry-run  # prints every step, changes nothing
#
# Env overrides:
#   ARCHIVE_DIR=/path/to/backups   # where the private-history bundle goes
#                                  # (default: sibling dir next to this repo)
#   PUBLIC_BRANCH=public-release   # name of the orphan branch created
#   ARCHIVE_BRANCH=private-archive # name of the local full-history safety branch

set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

PUBLIC_BRANCH="${PUBLIC_BRANCH:-public-release}"
ARCHIVE_BRANCH="${ARCHIVE_BRANCH:-private-archive}"
ARCHIVE_DIR="${ARCHIVE_DIR:-$(CDPATH= cd -- "$ROOT_DIR/.." && pwd)/hakka-private-archive}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE_PATH="$ARCHIVE_DIR/hakka-full-history-$STAMP.bundle"
COMMIT_MSG="feat: initial public release"

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

echo "================================================================"
echo " Hakka OSS clean-history prep — $([ "$DRY_RUN" -eq 1 ] && echo DRY RUN || echo LIVE)"
echo "================================================================"
echo

# ── Step 0: pre-flight checklist (printed only — nothing here is executed) ──
cat <<'EOF'
Before continuing, confirm ALL of the following are true. This script does
NOT run any of these for you.

  [ ] `just verify-all` passed locally (typecheck, lint, fmt-check, build-all,
      the 10 `just verify` legs — rn-jest, core-test, web-jsside, android-unit,
      ios-swift plus the static checks — and verify-smoke)
  [ ] `bun run pack:npm:dry-run` reviewed — all 7 npm tarballs contain only
      the intended files (no stray dotfiles, no test fixtures, no source maps
      you didn't mean to ship)
  [ ] Secret/leak audit reviewed and clean — no absolute user paths, API
      tokens, or stray personal emails in tracked files
  [ ] Decision made: publish under github.com/ansumanshah/hakka (current
      state of every package.json/podspec/build.gradle.kts URL already
      assumes this) — OR move to an org first and bulk-rewrite every
      ansumanshah/hakka URL across the repo BEFORE running this script, not
      after
  [ ] LICENSE present at repo root and in all 7 published packages
  [ ] You understand CI secrets (NPM_TOKEN, ORG_GRADLE_PROJECT_mavenCentral*,
      ORG_GRADLE_PROJECT_signingInMemoryKey*) are NOT required to run this
      script — only to run the release-npm/release-android workflows later,
      on the new remote.

This script itself only touches local git refs (branches/bundle). It never
contacts a remote and never pushes.
EOF
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] would prompt for typed confirmation here; skipping prompt."
else
  printf 'Type "yes" to confirm every item above is true and continue: '
  read -r CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted. Nothing was changed."
    exit 1
  fi
fi
echo

# ── Step 1: working tree must be clean ──────────────────────────────────────
ORIGINAL_BRANCH=$(git symbolic-ref --short -q HEAD || echo "HEAD")
echo "Current branch: $ORIGINAL_BRANCH"

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is not clean. Commit, stash, or discard changes first:" >&2
  git status --short >&2
  exit 1
fi
echo "Working tree is clean."

if [ "$ORIGINAL_BRANCH" != "main" ]; then
  echo "WARNING: you are not on 'main' (currently: $ORIGINAL_BRANCH)."
  if [ "$DRY_RUN" -eq 0 ]; then
    printf 'Continue anyway? [y/N] '
    read -r ANSWER
    case "$ANSWER" in
      y|Y) ;;
      *) echo "Aborted."; exit 1 ;;
    esac
  fi
fi

# Sanity check: nothing untracked-and-not-ignored should exist (this is what
# would silently ride along on `git add -A` below). If anything shows up,
# stop and make the owner look at it explicitly.
UNTRACKED_UNIGNORED=$(git status --porcelain --untracked-files=all | awk '$1 == "??" {print $2}')
if [ -n "$UNTRACKED_UNIGNORED" ]; then
  echo "ERROR: untracked files exist that .gitignore does NOT cover:" >&2
  echo "$UNTRACKED_UNIGNORED" >&2
  echo "Review each one — add to .gitignore, delete, or git add intentionally" >&2
  echo "before re-running this script (git add -A would otherwise ship them)." >&2
  exit 1
fi
echo "No stray untracked/unignored files found."
echo

# ── Step 2: mirror full private history BEFORE any orphan surgery ──────────
echo "── Archiving full private history ──"
run mkdir -p "$ARCHIVE_DIR"
run git bundle create "$BUNDLE_PATH" --all
if [ "$DRY_RUN" -eq 0 ]; then
  git bundle verify "$BUNDLE_PATH" >/dev/null
fi
echo "Bundle: $BUNDLE_PATH (contains every branch and tag, full reflog history reachable from them)"

run git branch -f "$ARCHIVE_BRANCH" "$ORIGINAL_BRANCH"
echo "Local safety branch '$ARCHIVE_BRANCH' points at $ORIGINAL_BRANCH (full history, never pushed by this script)."
echo

# ── Step 3: build the orphan public-release branch ──────────────────────────
echo "── Creating orphan branch '$PUBLIC_BRANCH' ──"
if git show-ref --verify --quiet "refs/heads/$PUBLIC_BRANCH"; then
  echo "ERROR: branch '$PUBLIC_BRANCH' already exists locally. Delete it first" >&2
  echo "  (git branch -D $PUBLIC_BRANCH) if you intend to regenerate it, or" >&2
  echo "  rename it if you want to keep the old one." >&2
  exit 1
fi

run git checkout --orphan "$PUBLIC_BRANCH"
run git reset

echo "Staging tracked content (git add -A — .gitignore rules still apply)..."
run git add -A

if [ "$DRY_RUN" -eq 0 ]; then
  STAGED_FILES=$(git diff --cached --name-only)
  STAGED_COUNT=$(printf '%s\n' "$STAGED_FILES" | grep -c . || true)
  echo "Staged $STAGED_COUNT files."

  # ── Last-mile leak scan on exactly what's about to be committed ───────────
  # Uses `xargs -0 rg` (no -I, no nested shell): BSD/macOS xargs's -I mode
  # silently truncates the command line once several -e patterns combine,
  # which would report a false "clean" scan with stderr discarded. Plain
  # xargs -0 batching is portable across GNU and BSD.
  echo "Running last-mile leak scan on staged files..."
  LEAK_HIT=0

  # Exclude this script's own path — it contains the pattern strings below
  # as regex literals, which would otherwise always trip its own scan.
  SELF_PATH="scripts/oss-clean-history.sh"

  secret_hits=$(git diff --cached --name-only -z -- . ":!$SELF_PATH" | xargs -0 rg -n --hidden \
    -e '/Users/[a-zA-Z]' \
    -e 'AKIA[0-9A-Z]{16}' \
    -e 'gh[opsu]_[A-Za-z0-9]{20,}' \
    -e 'github_pat_[A-Za-z0-9_]{20,}' \
    -e 'sk-ant-[A-Za-z0-9-]{10,}' \
    -e 'xox[baprs]-[A-Za-z0-9-]{10,}' \
    -e 'AIza[0-9A-Za-z_-]{20,}' \
    -e 'BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY' \
    -e 'BEGIN PRIVATE KEY' \
    2>/dev/null || true)
  if [ -n "$secret_hits" ]; then
    LEAK_HIT=1
    echo "ERROR: absolute user path or token/key-shaped string found in staged files:" >&2
    printf '%s\n' "$secret_hits" >&2
  fi

  email_hits=$(git diff --cached --name-only -z -- . ":!$SELF_PATH" | xargs -0 rg -n --hidden -o \
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' 2>/dev/null \
    | grep -viE 'ansumanshah@gmail\.com|a@b\.com|example\.com|schema\.org|w3\.org|@toOtelSpan' || true)
  if [ -n "$email_hits" ]; then
    LEAK_HIT=1
    echo "ERROR: email address(es) other than ansumanshah@gmail.com found in staged files:" >&2
    printf '%s\n' "$email_hits" >&2
  fi

  if [ "$LEAK_HIT" -eq 1 ]; then
    echo "ERROR: last-mile leak scan found something. Aborting before commit." >&2
    echo "The orphan branch '$PUBLIC_BRANCH' still exists with content staged —" >&2
    echo "fix the offending file(s), then either 'git add -A' again and re-run" >&2
    echo "just the commit, or delete the branch and start over:" >&2
    echo "  git checkout $ORIGINAL_BRANCH && git branch -D $PUBLIC_BRANCH" >&2
    exit 1
  fi
  echo "Last-mile leak scan: clean."
fi

run git commit -m "$COMMIT_MSG"
echo
echo "Created '$PUBLIC_BRANCH' with a single commit: $COMMIT_MSG"
echo

# ── Step 4: hand off to the owner — this script stops here ─────────────────
cat <<EOF
================================================================
Local prep done. This script has NOT touched any remote and will not.
Everything below is run BY HAND, by the repo owner, when ready.
================================================================

1. Create the empty GitHub repo (pick ONE):

   a) Under your own account (matches every URL already in the codebase):
        gh repo create ansumanshah/hakka --public --description "Local-first network inspector SDK for React Native, Android, iOS, Node, Next.js, and web" --homepage "https://hakka.noodleapps.com"

   b) Under a new org (only if you decided to move off ansumanshah/hakka —
      requires the ~29-file URL rewrite from the checklist FIRST):
        gh repo create <org>/hakka --public ...

2. Point this repo at it and push the clean branch as the new 'main':

     git remote add origin git@github.com:ansumanshah/hakka.git
     git push -u origin ${PUBLIC_BRANCH}:main

   (If GitHub doesn't auto-set 'main' as default branch, set it in
   Settings → Branches.)

3. Tag the first release (match the version already in every package.json /
   podspec, currently 0.1.0):

     git tag v0.1.0 ${PUBLIC_BRANCH}
     git push origin v0.1.0

4. Configure Actions secrets on the new repo before triggering
   release-npm.yml / release-android.yml:
     NPM_TOKEN
     ORG_GRADLE_PROJECT_mavenCentralUsername
     ORG_GRADLE_PROJECT_mavenCentralPassword
     ORG_GRADLE_PROJECT_signingInMemoryKey
     ORG_GRADLE_PROJECT_signingInMemoryKeyId
     ORG_GRADLE_PROJECT_signingInMemoryKeyPassword

5. To get back to your normal working branch locally:

     git checkout ${ORIGINAL_BRANCH}

Local refs created by this run (none pushed, none deleted):
  - branch '${PUBLIC_BRANCH}'   — the clean single-commit history to push as main
  - branch '${ARCHIVE_BRANCH}' — full private history, kept locally as a safety net
  - bundle '${BUNDLE_PATH}' — full private history mirror, outside the repo
EOF
