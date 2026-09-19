#!/usr/bin/env bash
# Repeat native tests and optionally exercise an already-running desktop bridge.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${APP_ROOT}/../.." && pwd)"
LIVE=0
TEST_ARGS=(--package-path "$APP_ROOT")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --live) LIVE=1; shift ;;
    --filter)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--filter requires a Swift test filter" >&2; exit 2; }
      TEST_ARGS+=(--filter "$2"); shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--filter <test-filter>] [--live]"
      echo "--live requires Hakka listening on port 8989 and built JS packages."
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

LOG_DIR="${REPO_ROOT}/artifacts/desktop-retest/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$LOG_DIR"
echo "Logs: $LOG_DIR"
START=$SECONDS
if command -v xcbeautify >/dev/null 2>&1; then
  if ! swift test "${TEST_ARGS[@]}" 2>&1 \
    | tee "$LOG_DIR/native.log" | xcbeautify --quiet --is-ci > "$LOG_DIR/formatted.log"; then
    tail -n 60 "$LOG_DIR/native.log"
    exit 1
  fi
  tail -n 3 "$LOG_DIR/native.log"
else
  swift test "${TEST_ARGS[@]}" 2>&1 | tee "$LOG_DIR/native.log"
fi
echo "Native tests: $((SECONDS - START))s" | tee "$LOG_DIR/result.log"
if [[ "$LIVE" == 1 ]]; then
  node "$REPO_ROOT/examples/desktop-bridge/run.mjs" --check 2>&1 | tee "$LOG_DIR/bridge.log"
fi
echo "PASS: desktop retest completed in $((SECONDS - START))s" | tee -a "$LOG_DIR/result.log"
