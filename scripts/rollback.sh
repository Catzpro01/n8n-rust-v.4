#!/usr/bin/env bash
# Roll the runtime back to a previous revision.
#
#   bash scripts/rollback.sh [--to <ref>] [--no-restart] [--help]
#
# Without --to it uses state/last-good-ref, then the previous entry of
# state/deploy-history.log.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

TARGET_REF=""
RESTART=1
HISTORY_FILE="$STATE_DIR/deploy-history.log"
LAST_GOOD_FILE="$STATE_DIR/last-good-ref"

usage() {
  cat <<EOF
usage: bash scripts/rollback.sh [options]

  --to <ref>     revision to roll back to (branch, tag or commit)
  --no-restart   check out the revision without restarting the service
  -h, --help     show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --to) shift; TARGET_REF="${1:-}" ;;
    --no-restart) RESTART=0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

ensure_dirs
load_env
have_cmd git || die "git is required for rollback"
[ -d "$REPO_ROOT/.git" ] || die "$REPO_ROOT is not a git checkout"

current_ref="$(git_ref)"

if [ -z "$TARGET_REF" ]; then
  if [ -f "$LAST_GOOD_FILE" ] && [ -s "$LAST_GOOD_FILE" ]; then
    TARGET_REF="$(tail -n1 "$LAST_GOOD_FILE")"
  elif [ -f "$HISTORY_FILE" ]; then
    TARGET_REF="$(grep -v "^$current_ref " "$HISTORY_FILE" 2>/dev/null | tail -n1 | awk '{print $1}')"
  fi
fi

[ -n "$TARGET_REF" ] || die "no rollback target known — pass --to <ref>"
[ "$TARGET_REF" != "$current_ref" ] || { ok "already at $current_ref"; exit 0; }

step "Rolling back $current_ref → $TARGET_REF"

if git -C "$REPO_ROOT" rev-parse --verify --quiet "$TARGET_REF" >/dev/null; then
  git -C "$REPO_ROOT" checkout --quiet "$TARGET_REF" || die "git checkout $TARGET_REF failed"
else
  git -C "$REPO_ROOT" fetch --all --tags --prune >/dev/null 2>&1 || true
  if git -C "$REPO_ROOT" rev-parse --verify --quiet "origin/$TARGET_REF" >/dev/null; then
    git -C "$REPO_ROOT" checkout --quiet -B "$TARGET_REF" "origin/$TARGET_REF" || die "checkout of origin/$TARGET_REF failed"
  else
    die "unknown revision: $TARGET_REF"
  fi
fi
ok "now at $(git_ref) ($(git_branch))"

step "Reinstalling dependencies"
if install_runtime_deps >/dev/null 2>&1; then ok "dependencies ready"; else warn "dependency install failed — continuing"; fi

if [ "$RESTART" -eq 0 ]; then
  ok "rollback checkout complete (service not restarted)"
  exit 0
fi

step "Restarting the runtime"
bash "$SCRIPT_DIR/stop.sh" --quiet || true
if bash "$SCRIPT_DIR/start.sh"; then
  ok "rollback to $TARGET_REF completed and healthy"
  printf '%s %s\n' "$(git_ref)" "$(date -Is)" >> "$HISTORY_FILE"
  exit 0
fi

fail "rollback target $TARGET_REF did not become healthy"
info "last log lines:"
tail_log 20
exit 1
