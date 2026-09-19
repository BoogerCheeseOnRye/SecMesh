#!/bin/bash
# secmesh-ctl.sh — tray menu action → serve.js control API → response toast.
#   secmesh-ctl.sh <start|stop|reboot> [port]
set -u
ACT=${1:-status}
PORT=${2:-8080}
API="http://127.0.0.1:${PORT}"
case "$ACT" in
  start)   A=launch  ;;
  stop)    A=stop    ;;
  reboot)  A=restart ;;
  *)       A="$ACT"  ;;
esac
out=$(curl -s -m 25 "${API}/peerctl?action=${A}" 2>/dev/null)
msg=$(printf '%s' "$out" | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    print('OK' if d.get('ok') else ('error: ' + str(d.get('error','?'))))
except Exception:
    print('no reply from serve.js')" 2>/dev/null)
notify-send -t 3000 "SecMesh · ${ACT}" "${msg}" 2>/dev/null || true
echo "${ACT}: ${msg}"
exit 0