#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "help" ]]; then
  cat <<'USAGE'
usage: ./scripts/serve_sim.sh [serve-sim args...]

Starts serve-sim for visual iOS Simulator access (browser + agent control).
The default opens the browser bridge at http://localhost:3200.

Subcommands (pass through to serve-sim):
  type <text>                  Type into focused field
  gesture '<json>' [-d udid]   Send a touch gesture
  button [name] [-d udid]      Send a button press (default: home)
  rotate <orientation>         portrait | landscape_left | landscape_right
  memory-warning               Simulate a memory warning
  camera <bundle-id>           Inject synthetic camera feed

Examples:
  ./scripts/serve_sim.sh
  ./scripts/serve_sim.sh --detach --quiet "iPhone 17"
  ./scripts/serve_sim.sh type "Hello"
  ./scripts/serve_sim.sh button home
USAGE
  exit 0
fi

exec npx --yes serve-sim "$@"
