#!/bin/bash
# secmesh-tray.sh — SecMesh taskbar icon for the IceWM SystemTray.
# Appears whenever serve.js is active; left-click opens the console, right-click
# menu controls the fabric. Icon swaps on/off with the fabric state.
#   spawned by app/serve.js (boot / launch / reboot)   arg: [$1 = port]
set -u
PORT=${1:-8080}
DIR=$(dirname "$(readlink -f "$0")")
UPID="/tmp/${USER}/secmesh-tray.pid"
API="http://127.0.0.1:${PORT}"
CONSOLE="${API}/crosslab/security_defender.html"
mkdir -p "/tmp/${USER}"

# single-instance guard (staleness-aware: a dead daemon's pidfile is reclaimed)
if [ -f "$UPID" ]; then
  old=$(cat "$UPID" 2>/dev/null)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then exit 0; fi
fi
echo $$ > "$UPID"

poll_state(){
  curl -s -m 3 "${API}/peerctl?action=status" 2>/dev/null \
    | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    print('stopped' if d.get('stopped') else ('up' if d.get('up') else 'supervisor-down'))
except Exception:
    print('unreachable')" 2>/dev/null || echo unreachable
}
# /usr/local/bin/yad is a bash wrapper that spawns the real /usr/bin/yad as a
# child, so killing one PID orphans the other. Both carry the icon path, so
# matching on it reaps wrapper + real binary + any orphans in one shot.
# The match is tightened to the notification's OWN marker ("--text=SecMesh")
# so the actions panel / setup wizard (which also use secmesh-on.png) are
# never reaped by a state-change redraw.
kill_icons(){ pkill -f 'secmesh-\(on\|off\|warn\)\.png --text=SecMesh' 2>/dev/null; sleep 0.4; }
cleanup(){ rm -f "$UPID"; kill_icons; }
trap cleanup EXIT INT TERM

while :; do
  echo $$ > "$UPID"          # heartbeat — pidfile always tracks the live daemon
  st=$(poll_state)
  case "$st" in
    up)                ic="secmesh-on.png";  tip="SecMesh — fabric up (click for menu)" ;;
    stopped)           ic="secmesh-off.png"; tip="SecMesh — stopped (click → Start)" ;;
    *)                 ic="secmesh-warn.png"; tip="SecMesh — supervisor down (${st})" ;;
  esac
  kill_icons                                                 # stale/duplicate icons never survive a redraw
  yad --notification \
      --image="${DIR}/assets/${ic}" \
      --text="SecMesh (${st})" \
      --tooltip="${tip}" \
      --command="setsid bash '${DIR}/secmesh-menupop.sh' ${PORT}" \
      >/dev/null 2>&1 &
  YPID=$!
  while kill -0 "$YPID" 2>/dev/null; do
    [ -f "$UPID" ] || exit 0                                # Quit pressed
    sleep 2
    [ "$(poll_state)" = "$st" ] || break                    # state changed → redraw with the new icon
  done
  sleep 1
done