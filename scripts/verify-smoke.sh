#!/bin/sh
# Smoke gate: runs the bridge-replay and MCP-handshake smoke scripts.
# These are end-to-end sanity checks (not part of the fast Tier-0 `verify`
# gate) — they exercise the real bridge/MCP wiring, not just unit tests.
#
#   just verify-smoke

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

fail=0

run_smoke() {
    script=$1
    if [ ! -f "$script" ]; then
        printf '\n==> %s: MISSING — script not found (expected to be written separately)\n' "$script" >&2
        fail=1
        return
    fi
    printf '\n==> node %s\n' "$script"
    if node "$script"; then
        printf '==> %s PASS\n' "$script"
    else
        printf '==> %s FAIL\n' "$script" >&2
        fail=1
    fi
}

run_smoke scripts/smoke-bridge-replay.mjs
run_smoke scripts/smoke-mcp-handshake.mjs
run_smoke scripts/smoke-control-roundtrip.mjs
run_smoke scripts/smoke-trace-correlation.mjs

if [ "$fail" -ne 0 ]; then
    printf '\nverify-smoke: FAILED (see above)\n' >&2
    exit 1
fi

printf '\nverify-smoke: PASS\n'
