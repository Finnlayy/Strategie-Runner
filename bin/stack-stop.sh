#!/usr/bin/env bash
# Beendet den Strategie-Runner, der aus diesem Projekt auf Port 3000 läuft.
set -u

ROOT="/home/finn-powers/Desktop/remix_-kraken-strategy-runner"
PIDFILE="$ROOT/data/logs/stack.pid"
PORT=3000

export PATH="/usr/local/bin:/usr/bin:/bin"

notify() {
  notify-send -a "Strategie-Runner" "$1" "$2" 2>/dev/null || true
}

stop_pid() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  local _
  for _ in 1 2 3 4 5 6 7 8; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.25
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

if [[ -f "$PIDFILE" ]]; then
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]]; then
    stop_pid "$pid"
  fi
  rm -f "$PIDFILE"
fi

for pid in $(ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  if [[ "$cwd" == "$ROOT" ]]; then
    stop_pid "$pid"
  fi
done

if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q ":$PORT"; then
  still=""
  for pid in $(ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ "$cwd" == "$ROOT" ]]; then
      still="$pid"
    fi
  done
  if [[ -n "$still" ]]; then
    notify "Strategie-Runner" "Port $PORT ist noch belegt (PID $still)."
    exit 1
  fi
fi

notify "Strategie-Runner" "Stack beendet."
exit 0
