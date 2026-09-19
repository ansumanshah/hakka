#!/bin/sh
# Headless gate for `just verify`: build shared dist, then run independent checks.

set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hakka-verify.XXXXXX")
printf 'Verification logs: %s\n' "$LOG_DIR"

names=""
start=$(date +%s)

run_leg() {
    name=$1
    shift
    slug=$(printf '%s' "$name" | tr -c 'a-zA-Z0-9' '_')
    log="$LOG_DIR/$slug.log"
    (
        if "$@" >"$log" 2>&1; then
            echo 0 >"$LOG_DIR/$slug.status"
        else
            echo $? >"$LOG_DIR/$slug.status"
        fi
    ) &
    names="$names $slug"
}

# Build before readers start: concurrent rebuilds erase dist during typechecks/tests.
if ! just build-core build-bridge build-node build-browser >"$LOG_DIR/prebuild.log" 2>&1; then
    echo "FAIL: pre-build of hakka-core/hakka-bridge/hakka-node/hakka-browser dist" >&2
    cat "$LOG_DIR/prebuild.log" >&2
    exit 1
fi

run_leg "typecheck" bun run typecheck
run_leg "lint" bun run lint
run_leg "fmt-check" bun run fmt:check
run_leg "cleanup-check" bun run cleanup:check
run_leg "version-audit" just version-audit
run_leg "sync-ios-check" just sync-ios-check
run_leg "sync-tokens-check" just sync-tokens-check
run_leg "ui-token-check" just ui-token-check
run_leg "spec-drift-check" just spec-drift-check
run_leg "spec-api-check" just spec-api-check
run_leg "dep-declaration-check" just dep-declaration-check
run_leg "rn-jest" just test
run_leg "web-jsside" just test-web-prebuilt
run_leg "android-unit" just test-android
# Run timing-sensitive benchmarks alone with `just bench-ios`.
run_leg "ios-swift" just test-ios-nobench
run_leg "desktop-swift" just test-desktop

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
    if [ "$status" -eq 0 ]; then
        printf '%-20s %-6s %s\n' "$slug" "PASS" "$log"
        pass=$((pass + 1))
    else
        printf '%-20s %-6s %s\n' "$slug" "FAIL" "$log"
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
        printf '\n==> %s (%s) <==\n' "$slug" "$LOG_DIR/$slug.log"
        tail -n 30 "$LOG_DIR/$slug.log" 2>/dev/null
    done
    exit 1
fi

exit 0
