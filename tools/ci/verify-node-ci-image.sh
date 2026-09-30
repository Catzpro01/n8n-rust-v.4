#!/usr/bin/env bash
# Prove n8n-node-ci:latest can host the five remaining ubuntu-latest jobs BEFORE any
# workflow is migrated onto it.
#
# The point is to fail here, on a 20-second image check, instead of discovering a
# missing Chromium library in a red CI run 25 minutes into a pull request.
#
#   docker build -f tools/ci/Dockerfile.node-ci -t n8n-node-ci:latest .
#   docker run --rm n8n-node-ci:latest bash /opt/ci/verify-node-ci-image.sh
#
# Exit 0 = the image satisfies every requirement read out of the workflows.

set -uo pipefail

PASS=0
FAIL=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }

need_bin() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 present ($(command -v "$1"))"
  else
    bad "$1 MISSING — required by: $2"
  fi
}

echo "n8n-node-ci image verification"
echo "=============================="
echo
echo "binaries the five jobs invoke:"
need_bin node     "architecture, gate, clean-clone, runtime gate"
need_bin npm      "gate, clean-clone, runtime gate"
need_bin bash     "gate, runtime gate"
need_bin git      "clean-clone, rust-scope contract"
need_bin curl     "clean-clone health polling"
need_bin setsid   "clean-clone — detaches the instance"
need_bin sha256sum "gate — release checksum verification"
need_bin tar      "gate — offline tarball"

echo
echo "node version (workflows pin 22.18):"
NODE_V="$(node --version 2>/dev/null || echo none)"
case "$NODE_V" in
  v22.18*) ok "node $NODE_V matches the pinned 22.18" ;;
  v22.*)   ok "node $NODE_V (22.x — compatible, but the workflows pin 22.18)" ;;
  *)       bad "node $NODE_V does NOT satisfy the pinned 22.18" ;;
esac

echo
echo "browser (clean-clone only):"
if [ -n "${CHROME_PATH:-}" ] && [ -x "${CHROME_PATH}" ]; then
  ok "CHROME_PATH=$CHROME_PATH is executable"
  if "$CHROME_PATH" --version >/dev/null 2>&1; then
    ok "chromium runs: $("$CHROME_PATH" --version 2>&1 | head -1)"
  else
    bad "chromium is present but will not execute — check the shared libraries below"
  fi
else
  bad "CHROME_PATH unset or not executable (tests/e2e/*.mjs read process.env.CHROME_PATH)"
fi

if [ "${PUPPETEER_SKIP_DOWNLOAD:-}" = "1" ]; then
  ok "PUPPETEER_SKIP_DOWNLOAD=1 — npm ci will not pull a second browser"
else
  bad "PUPPETEER_SKIP_DOWNLOAD is not 1; npm ci will download its own Chromium"
fi

echo
echo "chromium shared libraries (the classic runtime failure):"
if command -v ldd >/dev/null 2>&1 && [ -n "${CHROME_PATH:-}" ] && [ -x "${CHROME_PATH}" ]; then
  MISSING="$(ldd "$CHROME_PATH" 2>/dev/null | grep -c 'not found' || true)"
  if [ "${MISSING:-0}" -eq 0 ]; then
    ok "no unresolved shared libraries"
  else
    bad "$MISSING unresolved shared library/libraries:"
    ldd "$CHROME_PATH" 2>/dev/null | grep 'not found' | sed 's/^/        /'
  fi
else
  bad "cannot run ldd against CHROME_PATH"
fi

echo
echo "actually launch the browser headless (the only proof that counts):"
LAUNCH_OUT="$("$CHROME_PATH" --headless=new --no-sandbox --disable-gpu \
              --disable-dev-shm-usage --dump-dom about:blank 2>&1)" && LAUNCH_RC=0 || LAUNCH_RC=$?
if [ "${LAUNCH_RC:-1}" -eq 0 ] && printf '%s' "$LAUNCH_OUT" | grep -qi '<html'; then
  ok "headless launch rendered a DOM"
else
  bad "headless launch failed (rc=${LAUNCH_RC:-?})"
  printf '%s\n' "$LAUNCH_OUT" | head -5 | sed 's/^/        /'
fi

echo
echo "git on a bind-mounted workspace (the contract job uses fetch-depth: 0):"
if git config --system --get-all safe.directory 2>/dev/null | grep -q .; then
  ok "safe.directory configured — git will read a host-owned bind mount"
else
  bad "safe.directory not configured; git will refuse a Windows-host bind mount"
fi

echo
echo "=============================="
printf 'PASS %d   FAIL %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  echo
  echo "Image is NOT ready. Do not migrate any workflow onto it yet."
  exit 1
fi
echo
echo "Image satisfies every requirement read out of the five remaining ubuntu-latest jobs."
