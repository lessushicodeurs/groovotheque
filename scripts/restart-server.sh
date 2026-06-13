#!/usr/bin/env bash
set -euo pipefail

PORT=3099
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/server.log"
PID_FILE="$ROOT/server.pid"

# Kill whatever holds port 3099
PID=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "Libération du port $PORT (pid $PID)..."
  kill -9 "$PID"
fi

# Also clean up tracked pid if stale
if [ -f "$PID_FILE" ]; then
  OLD=$(cat "$PID_FILE")
  kill -0 "$OLD" 2>/dev/null && kill "$OLD" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

# Restart as daemon
nohup node "$ROOT/server.js" >> "$LOG" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
echo "Serveur démarré (pid $NEW_PID) — port $PORT — logs: $LOG"
