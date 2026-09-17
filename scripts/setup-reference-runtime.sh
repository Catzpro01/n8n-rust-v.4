#!/usr/bin/env bash
# Reference runtime for the Workflow LEGO verification.
#
# Installs exactly the packages n8n@2.9.4 depends on:
#   n8n-workflow@2.9.1     the Workflow Model (the artifact this LEGO isolates)
#   n8n-core@2.9.1         the execution engine (live verification)
#   n8n-nodes-base@2.9.1   real node implementations (live verification)
#   flatted@3.2.7          the execution_data wire format (pnpm catalog pin of @n8n/db, n8n@2.9.4)
#   nanoid@3.3.8           id generation (consumed by persistence-lego; see its manifest/source-pins.json)
#
# Notes
#  - The full `n8n` CLI is NOT installed: its native `sqlite3` dependency needs
#    node headers from nodejs.org, which some sandboxes block. The engine stack
#    above is what the live harness needs.
#  - `xlsx` is overridden to the npm registry copy because n8n pins it to a CDN
#    tarball (cdn.sheetjs.com). Only SpreadsheetFile uses it; no gate depends on it.
#
# usage: scripts/setup-reference-runtime.sh [target-dir]   (default: .runtime)
set -euo pipefail

TARGET="${1:-.runtime}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p "$TARGET"
cat > "$TARGET/package.json" <<'JSON'
{
  "name": "lego-reference-runtime",
  "private": true,
  "version": "1.0.0",
  "description": "Pinned reference runtime for the Workflow LEGO verification (the exact dependency set of n8n 2.9.4).",
  "overrides": { "xlsx": "0.18.5" },
  "dependencies": {
    "n8n-core": "2.9.1",
    "n8n-nodes-base": "2.9.1",
    "n8n-workflow": "2.9.1",
    "flatted": "3.2.7",
    "nanoid": "3.3.8"
  }
}
JSON

echo "installing reference runtime into $TARGET ..."
(cd "$TARGET" && npm install --no-audit --no-fund --loglevel=error)

echo "reference runtime ready:"
node -e "
const p = (n) => require('$ROOT/$TARGET/node_modules/' + n + '/package.json').version;
console.log('  n8n-workflow   ', p('n8n-workflow'));
console.log('  n8n-core       ', p('n8n-core'));
console.log('  n8n-nodes-base ', p('n8n-nodes-base'));
console.log('  flatted        ', p('flatted'));
console.log('  nanoid         ', p('nanoid'));
"
echo
echo "Now run:  npm run verify        (uses $TARGET automatically)"
