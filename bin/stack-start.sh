#!/usr/bin/env bash
# Startet den Strategie-Runner (tsx server.ts) auf Port 3000.
set -u

ROOT="/home/finn-powers/Desktop/remix_-kraken-strategy-runner"
PIDFILE="$ROOT/data/logs/stack.pid"
LOG="$ROOT/data/logs/stack.log"
NPM="/snap/bin/npm"
PORT=3000

export PATH="/snap/bin:/usr/local/bin:/usr/bin:/bin"

notify() {
  notify-send -a "Strategie-Runner" "$1" "$2" 2>/dev/null || true
}

listener_pid() {
  local pid cwd
  for pid in $(ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ "$cwd" == "$ROOT" ]]; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

if pid="$(listener_pid)"; then
  notify "Strategie-Runner" "Läuft bereits auf http://localhost:$PORT"
  xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
  exit 0
fi

if [[ ! -x "$NPM" ]]; then
  notify "Strategie-Runner" "npm nicht gefunden: $NPM"
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  notify "Strategie-Runner" "node_modules fehlt. Im Projektordner npm install ausführen."
  exit 1
fi

mkdir -p "$ROOT/data/logs"
cd "$ROOT"

setsid nohup "$NPM" run dev >>"$LOG" 2>&1 </dev/null &
echo $! >"$PIDFILE"

for _ in $(seq 1 45); do
  if listener_pid >/dev/null; then
    notify "Strategie-Runner" "Stack gestartet: http://localhost:$PORT"
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
    exit 0
  fi
  if [[ -f "$PIDFILE" ]]; then
    pid="$(cat "$PIDFILE")"
    if ! kill -0 "$pid" 2>/dev/null; then
      notify "Strategie-Runner" "Start fehlgeschlagen. Siehe data/logs/stack.log"
      exit 1
    fi
  fi
  sleep 1
done

notify "Strategie-Runner" "Start dauert länger als 45s. Siehe data/logs/stack.log"
exit 0
