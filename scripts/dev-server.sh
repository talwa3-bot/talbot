#!/usr/bin/env bash
# Restart the demo API+UI server in the background. Synthetic data only.
PIDFILE="${TMPDIR:-/tmp}/ledgerlens.pid"
[ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
for p in $(ps -eo pid,args | awk '/node .*packages\/api\/src\/server.ts/ && !/awk/ {print $1}'); do kill "$p" 2>/dev/null; done
sleep 1
LEDGERLENS_DEMO_AUTH=1 DATABASE_URL="${DATABASE_URL:-postgres://ledger_app:ledger_app_dev@localhost/ledgerlens}" PORT="${PORT:-3000}" \
  nohup npx tsx packages/api/src/server.ts > "${TMPDIR:-/tmp}/ledgerlens.log" 2>&1 &
echo $! > "$PIDFILE"
for i in $(seq 1 20); do curl -sf "localhost:${PORT:-3000}/healthz" >/dev/null && echo "server up" && exit 0; sleep 0.5; done
echo "server failed"; cat "${TMPDIR:-/tmp}/ledgerlens.log"; exit 1
