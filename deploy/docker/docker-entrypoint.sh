#!/bin/sh
# Container entrypoint for n8n lego.
#
#   docker run n8n-lego                       -> n8n-lego start
#   docker run n8n-lego doctor                -> install check
#   docker run n8n-lego catalog               -> refresh catalog/icons
#   docker run n8n-lego start --no-fetch      -> start without network access
#   docker run n8n-lego node -e '...'         -> escape hatch (any other command)
set -e

if [ "$#" -eq 0 ]; then
  set -- start
elif [ "${1#-}" != "$1" ]; then
  # option-first invocation (`--help`, `--version`) belongs to the CLI
  set -- start "$@"
fi

case "$1" in
  start|doctor|catalog|version|help)
    exec node /app/bin/n8n-lego.mjs "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
