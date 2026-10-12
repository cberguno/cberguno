#!/usr/bin/env bash
# Start a throwaway local Postgres for the integration tests (no Docker needed).
# Usage: scripts/test-pg.sh start|stop   ->  listens on 127.0.0.1:54329, trust auth, user "postgres".
# In CI use a postgres service container and set TEST_DATABASE_URL instead.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
DIR=${TEST_PG_DIR:-/var/lib/postgresql/agent-platform-test}
run() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
case "${1:-start}" in
  start)
    if [ "$(id -u)" = 0 ]; then install -d -o postgres -g postgres "$DIR"; else mkdir -p "$DIR"; fi
    [ -f "$DIR/data/PG_VERSION" ] || run "$BIN/initdb" -D "$DIR/data" -A trust >/dev/null
    run "$BIN/pg_ctl" -D "$DIR/data" -o "-p 54329 -k $DIR -c fsync=off" -l "$DIR/log" -w start >/dev/null || true
    pg_isready -h 127.0.0.1 -p 54329 ;;
  stop) run "$BIN/pg_ctl" -D "$DIR/data" -m fast stop ;;
esac
