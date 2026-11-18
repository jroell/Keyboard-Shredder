#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p -- "$SONG_DATA_DIR"
  chown node:node -- "$SONG_DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
