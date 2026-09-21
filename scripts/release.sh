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
echo "  ok  node $(node -p process.versions.node), engine present"

# The app ships `data/roles.json` because npm/Docker/tarball installs have no
# reference checkout to extract it from. It is a generated file, so a clean clone
# must be able to reproduce it byte for byte: the generator reads the pinned n8n
# source under reference/ (tracked) and never the network.
say "bundled data (roles.json) is reproducible"
BUNDLED_ROLES="$APP_DIR/data/roles.json"
ROLES_CHECK_DIR="$OUT_DIR/.roles-check"
rm -rf "$ROLES_CHECK_DIR"
node "$APP_DIR/scripts/fetch-n8n-roles.mjs" --dir "$ROLES_CHECK_DIR" >/dev/null \
  || { echo "cannot regenerate roles.json from reference/n8n" >&2; exit 1; }
GENERATED_ROLES="$ROLES_CHECK_DIR/roles.json"
if [ ! -f "$BUNDLED_ROLES" ]; then
  echo "  missing $BUNDLED_ROLES — regenerate it: node apps/n8n-lego/scripts/fetch-n8n-roles.mjs --dir apps/n8n-lego/data" >&2
  exit 1
fi
if ! diff -q "$GENERATED_ROLES" "$BUNDLED_ROLES" >/dev/null; then
  echo "  $BUNDLED_ROLES is out of date — regenerate it: node apps/n8n-lego/scripts/fetch-n8n-roles.mjs --dir apps/n8n-lego/data" >&2
  exit 1
fi
echo "  ok  data/roles.json matches reference/n8n"

# --------------------------------------------------------------- catalog for tests
# The REST suite asserts the node catalog. A developer checkout usually has one in
# <repo>/data/n8n-lego/catalog; a clean clone does not, so fetch the pinned catalog
# into the output directory (same documented fetch the app does on first boot).
say "test catalog"
if [ -n "${N8N_LEGO_CATALOG_DIR:-}" ] && [ -f "$N8N_LEGO_CATALOG_DIR/nodes.json" ]; then
  TEST_CATALOG="$N8N_LEGO_CATALOG_DIR"
  echo "  using N8N_LEGO_CATALOG_DIR=$TEST_CATALOG"
elif [ -f "$REPO_ROOT/data/n8n-lego/catalog/nodes.json" ]; then
  TEST_CATALOG="$REPO_ROOT/data/n8n-lego/catalog"
  echo "  using the checkout catalog ($TEST_CATALOG)"
else
  TEST_CATALOG="$OUT_DIR/.test-catalog"
  if [ ! -f "$TEST_CATALOG/nodes.json" ]; then
    echo "  fetching the pinned catalog into $TEST_CATALOG"
    node "$APP_DIR/scripts/fetch-n8n-catalog.mjs" --dir "$TEST_CATALOG" >/dev/null \
      || { echo "catalog fetch failed — set N8N_LEGO_CATALOG_DIR to an existing catalog to run offline" >&2; exit 1; }
    node "$APP_DIR/scripts/fetch-n8n-roles.mjs" --dir "$TEST_CATALOG" >/dev/null || true
  fi
  echo "  using the freshly fetched catalog ($TEST_CATALOG)"
fi

( cd "$APP_DIR" && N8N_LEGO_CATALOG_DIR="$TEST_CATALOG" node --test "test/*.test.mjs" >/dev/null ) \
  || { echo "app tests failed" >&2; exit 1; }
echo "  ok  app tests pass"

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
