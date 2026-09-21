#!/usr/bin/env bash
# Build every n8n lego distribution artifact from one command.
#
#   bash scripts/release.sh [options]
#
#   --npm-only      only the npm package (tarball + `npm pack`)
#   --no-docker     skip `docker build` (no docker binary on this machine)
#   --tag <tag>     version/tag for the docker image and artifact names
#   --out <dir>     output directory (default dist/)
#   -h, --help
#
# Artifacts:
#   dist/n8n-lego-<version>.tgz          npm package (`npm install -g` / npx)
#   dist/n8n-lego-<version>.tar.gz       offline tarball for a VPS + systemd
#   dist/n8n-lego-<version>.tar.gz.sha256
#   docker image n8n-lego:<version>      built from the repository Dockerfile
#
# The npm package vendors the reconstructed engine (`vendor/reconstructed-engine`)
# so a global install is self-contained; the catalog is *not* bundled — it is
# fetched on first boot by `n8n-lego start` (or explicitly, `n8n-lego catalog`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/n8n-lego"
ENGINE_DIR="$REPO_ROOT/packages/reconstructed-engine"

OUT_DIR="$REPO_ROOT/dist"
NPM_ONLY=0
DO_DOCKER=1
TAG=""

usage() {
  sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --npm-only) NPM_ONLY=1 ;;
    --no-docker) DO_DOCKER=0 ;;
    --tag) TAG="${2:?--tag needs a value}"; shift ;;
    --out) OUT_DIR="${2:?--out needs a value}"; shift ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
  shift
done

say() { printf '\n\033[1mn8n-lego release:\033[0m %s\n' "$*"; }

VERSION="$(node -p "require('$APP_DIR/package.json').version")"
TAG="${TAG:-$VERSION}"
say "version $VERSION (tag $TAG)"

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------- prerequisites
say "checks"
node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a<22 || (a===22 && b<18)) { console.error('node >= 22.18 required, found '+process.versions.node); process.exit(1); }"
[ -f "$ENGINE_DIR/index.mjs" ] || { echo "engine missing: $ENGINE_DIR/index.mjs" >&2; exit 1; }
( cd "$APP_DIR" && node --test "test/*.test.mjs" >/dev/null ) || { echo "app tests failed" >&2; exit 1; }
echo "  ok  node $(node -p process.versions.node), engine present, tests pass"

# ------------------------------------------------------------- vendor the engine
say "vendoring the reconstructed engine into the package"
rm -rf "$APP_DIR/vendor"
mkdir -p "$APP_DIR/vendor/reconstructed-engine"
for file in index.mjs runner.mjs node-registry.mjs validation.mjs node-catalog.mjs localization.mjs package.json; do
  cp "$ENGINE_DIR/$file" "$APP_DIR/vendor/reconstructed-engine/$file"
done
[ -d "$ENGINE_DIR/src" ] && cp -R "$ENGINE_DIR/src" "$APP_DIR/vendor/reconstructed-engine/src"
du -sh "$APP_DIR/vendor/reconstructed-engine" | awk '{print "  ok  vendored "$1}'

# ------------------------------------------------------------------ npm package
say "npm package"
( cd "$APP_DIR" && npm pack --pack-destination "$OUT_DIR" >/dev/null )
NPM_TARBALL="$OUT_DIR/n8n-lego-$VERSION.tgz"
[ -f "$NPM_TARBALL" ] || { echo "npm pack did not produce $NPM_TARBALL" >&2; exit 1; }
echo "  ok  $NPM_TARBALL ($(du -h "$NPM_TARBALL" | cut -f1))"

if [ "$NPM_ONLY" = "1" ]; then
  say "done (npm only)"
  exit 0
fi

# ------------------------------------------------------------------ VPS tarball
say "offline tarball"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG_ROOT="$STAGE/n8n-lego-$VERSION"
mkdir -p "$PKG_ROOT"

# The install tree is what `scripts/install.sh` expects: the npm package plus the
# installer, the systemd unit and a copy of the editor UI so the VPS needs no
# network at install time.
cp -R "$APP_DIR/bin" "$APP_DIR/src" "$APP_DIR/scripts" "$APP_DIR/data" "$PKG_ROOT/"
cp "$APP_DIR/package.json" "$APP_DIR/package-lock.json" "$APP_DIR/README.md" "$APP_DIR/LICENSE.md" "$PKG_ROOT/"
cp -R "$APP_DIR/vendor" "$PKG_ROOT/vendor"
cp -R "$REPO_ROOT/deploy/systemd" "$PKG_ROOT/systemd" 2>/dev/null || true
cp "$REPO_ROOT/apps/n8n-lego/scripts/install-tarball.sh" "$PKG_ROOT/install.sh" 2>/dev/null || true

# `npm install --omit=dev` inside the installer needs the UI dependency; ship the
# installed tree when it is present so a VPS install works offline.
if [ -d "$APP_DIR/node_modules/n8n-editor-ui" ]; then
  mkdir -p "$PKG_ROOT/node_modules"
  cp -R "$APP_DIR/node_modules/n8n-editor-ui" "$PKG_ROOT/node_modules/"
  find "$PKG_ROOT/node_modules" -name '*.map' -delete 2>/dev/null || true
  echo "  ok  editor UI vendored ($(du -sh "$PKG_ROOT/node_modules" | cut -f1))"
else
  echo "  warn  apps/n8n-lego/node_modules missing — the tarball needs network on install"
fi

TARBALL="$OUT_DIR/n8n-lego-$VERSION.tar.gz"
tar -C "$STAGE" -czf "$TARBALL" "n8n-lego-$VERSION"
( cd "$OUT_DIR" && sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )
echo "  ok  $TARBALL ($(du -h "$TARBALL" | cut -f1))"

# ------------------------------------------------------------------------ docker
if [ "$DO_DOCKER" = "1" ]; then
  say "docker image n8n-lego:$TAG"
  if command -v docker >/dev/null 2>&1; then
    docker build -f "$REPO_ROOT/Dockerfile" -t "n8n-lego:$TAG" -t n8n-lego:latest "$REPO_ROOT"
    echo "  ok  docker image n8n-lego:$TAG"
  else
    echo "  skip  docker binary not available — Dockerfile and compose are in the repo"
  fi
fi

say "artifacts in $OUT_DIR"
ls -lh "$OUT_DIR" | sed 's/^/  /'
