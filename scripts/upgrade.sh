#!/usr/bin/env bash
# Upgrade the runtime to a newer revision, with automatic rollback on failure.
#
#   bash scripts/upgrade.sh [--ref <branch|tag|commit>] [--skip-typecheck] [--no-restart] [--help]
#
# Default ref: the branch currently checked out, fast-forwarded from origin
# (on the VPS that is usually `main`).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

TARGET_REF=""
SKIP_TYPECHECK=0
RESTART=1
HISTORY_FILE="$STATE_DIR/deploy-history.log"
LAST_GOOD_FILE="$STATE_DIR/last-good-ref"

usage() {
  cat <<EOF
usage: bash scripts/upgrade.sh [options]

  --ref <ref>      revision to deploy (default: fast-forward the current branch)
  --skip-typecheck skip the tsc gate before restarting
  --no-restart     only update the working tree (no restart, no health check)
  -h, --help       show this help

Guarantee: if the new revision does not become healthy, the previous revision is
restored automatically by scripts/rollback.sh and the script exits non-zero.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) shift; TARGET_REF="${1:-}" ;;
    --skip-typecheck) SKIP_TYPECHECK=1 ;;
    --no-restart) RESTART=0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

ensure_dirs
load_env
have_cmd git || die "git is required for upgrades"
[ -d "$REPO_ROOT/.git" ] || die "$REPO_ROOT is not a git checkout"

PREVIOUS_REF="$(git_ref)"
PREVIOUS_BRANCH="$(git_branch)"
printf '%s\n' "$PREVIOUS_REF" > "$LAST_GOOD_FILE"

step "Upgrading from $PREVIOUS_REF ($PREVIOUS_BRANCH)"
if git_is_dirty; then
  warn "the working tree has local changes — they will be preserved if git can fast-forward"
fi

git -C "$REPO_ROOT" fetch --all --tags --prune || warn "git fetch failed — trying with the local objects"

if [ -n "$TARGET_REF" ]; then
  if git -C "$REPO_ROOT" rev-parse --verify --quiet "origin/$TARGET_REF" >/dev/null; then
    git -C "$REPO_ROOT" checkout --quiet -B "$TARGET_REF" "origin/$TARGET_REF" || die "cannot check out origin/$TARGET_REF"
  elif git -C "$REPO_ROOT" rev-parse --verify --quiet "$TARGET_REF" >/dev/null; then
    git -C "$REPO_ROOT" checkout --quiet "$TARGET_REF" || die "cannot check out $TARGET_REF"
  else
    die "unknown revision: $TARGET_REF"
  fi
else
  upstream="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || printf 'origin/%s' "$PREVIOUS_BRANCH")"
  if ! git -C "$REPO_ROOT" merge --ff-only "$upstream" >/dev/null 2>&1; then
    warn "cannot fast-forward to $upstream — working tree left as is"
  fi
fi

NEW_REF="$(git_ref)"
if [ "$NEW_REF" = "$PREVIOUS_REF" ]; then
  ok "already up to date at $NEW_REF"
  [ "$RESTART" -eq 1 ] && { bash "$SCRIPT_DIR/start.sh"; exit $?; }
  exit 0
fi
ok "now at $NEW_REF ($(git_branch))"

step "Installing dependencies"
if ! install_runtime_deps >/dev/null 2>&1; then
  warn "npm install failed — attempting to continue"
fi

if [ "$SKIP_TYPECHECK" -eq 0 ] && [ -x "$REPO_ROOT/apps/n8n-ts/node_modules/.bin/tsc" ]; then
  step "Typechecking the new revision"
  if ! npm --prefix "$REPO_ROOT/apps/n8n-ts" run typecheck >/dev/null 2>&1; then
    fail "typecheck failed for $NEW_REF — rolling back to $PREVIOUS_REF"
    bash "$SCRIPT_DIR/rollback.sh" --to "$PREVIOUS_REF" || fail "automatic rollback also failed — manual intervention required"
    exit 1
  fi
  ok "typecheck clean"
fi

if [ "$RESTART" -eq 0 ]; then
  ok "working tree updated to $NEW_REF (service not restarted)"
  exit 0
fi

step "Restarting the runtime"
bash "$SCRIPT_DIR/stop.sh" --quiet || true

if bash "$SCRIPT_DIR/start.sh"; then
  if bash "$SCRIPT_DIR/doctor.sh" --quick >/dev/null 2>&1; then
    ok "upgrade to $NEW_REF complete"
    printf '%s %s\n' "$NEW_REF" "$(date -Is)" >> "$HISTORY_FILE"
    printf '%s\n' "$NEW_REF" > "$LAST_GOOD_FILE"
    exit 0
  fi
  warn "runtime is up but doctor.sh reported problems"
fi

fail "upgrade to $NEW_REF failed — rolling back to $PREVIOUS_REF"
if bash "$SCRIPT_DIR/rollback.sh" --to "$PREVIOUS_REF"; then
  warn "rollback completed; the runtime is running the previous revision"
else
  fail "automatic rollback failed — manual intervention required"
fi
exit 1
