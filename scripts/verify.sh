#!/bin/sh
# Tier-0 headless verify gate. Runs every leg in parallel (backgrounded jobs +
# `wait`), then prints a PASS/FAIL summary table. Exits non-zero if any leg
# failed. Target: <5 min warm (warm gradle daemon, warm bun/node caches).
#
#   just verify

set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hakka-verify.XXXXXX")
trap 'rm -rf "$LOG_DIR"' EXIT

names=""
start=$(date +%s)

# run_leg <name> <command...> — backgrounds the command, logs stdout+stderr,
# and remembers <name> so we can collect exit codes after `wait`.
run_leg() {
    name=$1
    shift
    slug=$(printf '%s' "$name" | tr -c 'a-zA-Z0-9' '_')
    log="$LOG_DIR/$slug.log"
    pidfile="$LOG_DIR/$slug.pid"
    (
        if "$@" >"$log" 2>&1; then
            echo 0 >"$LOG_DIR/$slug.status"
        else
            echo $? >"$LOG_DIR/$slug.status"
        fi
    ) &
    echo $! >"$pidfile"
    names="$names $slug"
}

# ── Pre-build shared dist (sequential, BEFORE any leg starts) ───────────────
# core+bridge dist is read by the typecheck leg and by every JS test leg.
# Building it inside the parallel phase (test-web's build-core/build-bridge
# dep recipes) wipes dist mid-typecheck, producing nondeterministic
# TS2307/TS7006 failures. Build once here; the web leg then runs the
# no-build variant (test-web-prebuilt).
if ! just build-core build-bridge >"$LOG_DIR/prebuild.log" 2>&1; then
    echo "FAIL: pre-build of hakka-core/hakka-bridge dist" >&2
    cat "$LOG_DIR/prebuild.log" >&2
    exit 1
fi

# ── Legs (all backgrounded, run concurrently) ───────────────────────────────

run_leg "typecheck" bun run typecheck
run_leg "lint" bun run lint
run_leg "fmt-check" bun run fmt:check
run_leg "sync-ios-check" just sync-ios-check
run_leg "sync-tokens-check" just sync-tokens-check
run_leg "ui-token-check" just ui-token-check
run_leg "rn-jest" just test
run_leg "core-test" bun run --cwd packages/hakka-core test
run_leg "web-jsside" just test-web-prebuilt
run_leg "android-unit" just test-android
# Benchmarks are excluded here (CPU contention makes their thresholds flaky
# under the parallel gate) — run them solo via `just bench-ios`.
run_leg "ios-swift" just test-ios-nobench

# ── Wait for every leg, then report ─────────────────────────────────────────

wait

end=$(date +%s)
elapsed=$((end - start))

pass=0
fail=0
printf '\n%-20s %-6s %s\n' "LEG" "RESULT" "LOG"
printf -- '-------------------------------------------------------------\n'
failed_names=""
for slug in $names; do
    status_file="$LOG_DIR/$slug.status"
    status=$(cat "$status_file" 2>/dev/null || echo 1)
    log="$LOG_DIR/$slug.log"
    saved_log="/tmp/hakka-verify-$slug.log"
    cp "$log" "$saved_log" 2>/dev/null || true
    if [ "$status" -eq 0 ]; then
        printf '%-20s %-6s %s\n' "$slug" "PASS" "$saved_log"
        pass=$((pass + 1))
    else
        printf '%-20s %-6s %s\n' "$slug" "FAIL" "$saved_log"
        fail=$((fail + 1))
        failed_names="$failed_names $slug"
    fi
done

printf -- '-------------------------------------------------------------\n'
printf 'verify: %d passed, %d failed, %ds elapsed\n' "$pass" "$fail" "$elapsed"

if [ "$fail" -gt 0 ]; then
    printf '\nFailed legs:%s\n' "$failed_names"
    printf 'Tail of each failing log:\n'
    for slug in $failed_names; do
        printf '\n==> %s (%s) <==\n' "$slug" "/tmp/hakka-verify-$slug.log"
        tail -n 30 "/tmp/hakka-verify-$slug.log" 2>/dev/null
    done
    exit 1
fi

exit 0
