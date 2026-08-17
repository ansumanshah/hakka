#!/bin/sh
# Phase verification gate. Superseded by `just verify` / `just verify-smoke` /
# `just verify-all` (see justfile) — kept as a stable entry point since
# CONTRIBUTING.md, AGENTS.md, CHANGELOG.md, and the docs site reference
# `bun run phase:verify[:ci|:full]`. This file just delegates.
#
#   scripts/phase-verify.sh [ci|local|full]
#     ci    -> just verify              (fast headless gate, no device/smoke steps)
#     local -> just verify + verify-smoke
#     full  -> just verify-all          (verify + verify-smoke + build-all)

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MODE=${1:-local}

run_step() {
    name=$1
    shift
    printf '\n==> %s\n' "$name"
    start=$(date +%s)
    if "$@"; then
        end=$(date +%s)
        printf '==> %s completed in %ss\n' "$name" "$((end - start))"
    else
        status=$?
        end=$(date +%s)
        printf '==> %s failed in %ss\n' "$name" "$((end - start))"
        return "$status"
    fi
}

case "$MODE" in
    ci|local|full) ;;
    *)
        echo "Usage: scripts/phase-verify.sh [ci|local|full]"
        exit 1
        ;;
esac

cd "$ROOT_DIR"

case "$MODE" in
    ci)
        run_step "Tier-0 verify gate" just verify
        ;;
    local)
        run_step "Tier-0 verify gate" just verify
        run_step "smoke gate" just verify-smoke
        ;;
    full)
        run_step "full verify (verify + smoke + build-all)" just verify-all
        ;;
esac

printf '\nPhase verification (%s) complete.\n' "$MODE"
