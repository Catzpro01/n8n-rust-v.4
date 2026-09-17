#!/usr/bin/env bash
# One-shot workspace setup — ISSUE-023 + ISSUE-025.
#
# `scripts/setup-reference-runtime.sh` only installs the pinned *reference runtime*
# (.runtime). It does not install the per-package devDependencies, so a clean clone
# fails `npm run verify:all` with symptoms that look like code defects but are not:
#
#   sh: 1: tsc: not found                       (connection-lego / validation-lego build)
#   Cannot find package 'luxon'                 (expression-lego, needed by workflow-model-lego)
#   Cannot find module 'n8n-workflow'           (workflow-lego, needed by node-lego gate N05)
#
# This script runs both halves, in order, and is safe to re-run.
#
# usage: scripts/setup-all.sh [--force]
#   --force   rebuild .runtime from scratch even if it already looks complete
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- 1. reference runtime
# The runtime is only "complete" when every pinned package resolves. ISSUE-023 was a
# runtime that looked present but was missing `flatted`, which made five of seven
# persistence-lego test files fail to load — so presence of the directory is not enough.
REQUIRED=(n8n-workflow n8n-core n8n-nodes-base flatted nanoid)
missing=0
for pkg in "${REQUIRED[@]}"; do
  [ -d ".runtime/node_modules/$pkg" ] || missing=1
done

if [ "$FORCE" = "1" ]; then
  echo "==> --force: rebuilding .runtime from scratch"
  rm -rf .runtime
  bash scripts/setup-reference-runtime.sh
elif [ "$missing" = "1" ]; then
  echo "==> .runtime is missing one or more pinned packages — installing"
  bash scripts/setup-reference-runtime.sh
else
  echo "==> .runtime already complete (${REQUIRED[*]})"
fi

# ---------------------------------------------------------------- 2. per-package installs
# Any package that declares devDependencies needs a local node_modules; there is no
# npm workspace at the root, so each one is installed in place.
installed=0
for dir in packages/*/; do
  [ -f "$dir/package.json" ] || continue
  # `dependencies` counts too: expression-lego declares `luxon`/`jmespath` as runtime
  # deps with no devDependencies, and skipping it is exactly what made
  # workflow-model-lego fail 17/42 (ISSUE-025 step 3).
  if ! node -e '
    const p = require(process.argv[1]);
    const n = (o) => o && Object.keys(o).length ? 1 : 0;
    process.exit(n(p.dependencies) || n(p.devDependencies) ? 0 : 1);
  ' "$ROOT/$dir/package.json"; then
    continue
  fi
  if [ -d "$dir/node_modules" ] && [ -n "$(ls -A "$dir/node_modules" 2>/dev/null)" ]; then
    echo "==> ${dir%/} already installed"
    continue
  fi
  echo "==> npm install --prefix $dir"
  npm install --prefix "$dir" --no-audit --no-fund --loglevel=error
  installed=$((installed + 1))
done

echo
echo "setup complete (${installed} package(s) installed)."
echo
echo "Suggested next steps:"
echo "  npm run verify:all     # or the narrower gates your lane owns"
echo "  node tools/branch-collision-check.mjs --scope packages/ HEAD <peer-ref>"
