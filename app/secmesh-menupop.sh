#!/bin/bash
# secmesh-menupop.sh — the SecMesh tray **actions panel**. yad 0.40's built-in
# GtkStatusIcon menu wedges on this box (stale POPUP windows that never unmap
# and keep the X grab, so subsequent "Setup Wizard…" clicks show nothing), so
# the tray icon now opens this plain yad --list dialog instead: one window that
# maps/focuses reliably, mirrors the config/tune dialog pattern, and runs any
# action DETACHED. Arg: [$1 = port]. Spawned by app/secmesh-tray.sh --command.
set -u
PORT=${1:-8080}
DIR=$(dirname "$(readlink -f "$0")")
API="http://127.0.0.1:${PORT}"
CONSOLE="${API}/crosslab/security_defender.html"
ICON="${DIR}/assets/secmesh-on.png"

# send a decodeable fabric one-liner (graceful when serve.js is down)
ST=$(curl -s -m 3 "${API}/peerctl?action=status" 2>/dev/null \
  | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    cap = ' · %s peers cap' % d.get('autoCap') if d.get('autoCap') else ''
    if d.get('stopped'):  print('stopped%s' % cap)
    elif d.get('up'):     print('up%s' % cap)
    else:                 print('supervisor down')
except Exception:
    pass" 2>/dev/null)
ST=${ST:-unreachable}

# NOTE: no --window-icon here — keep 'assets/secmesh' OUT of this cmdline so the
# tray daemon's kill_icons() redraw can never reap this dialog mid-use.
ACTION=$(yad --center --title="SecMesh — Actions" --width=400 --height=330 \
    --list --no-headers --column="" --column="Run":HD \
    --print-column=2 --separator='\n' --action-column=2 \
    --text="Fabric <b>${ST}</b> — double-click, or pick + Run" \
    --button="Cancel":1 --button="Run selected":0 \
    "Open console"        "xdg-open '${CONSOLE}' &" \
    "SecMesh window…"     "${DIR}/secmesh-ui.sh ${PORT}" \
    "Tune fabric…"        "${DIR}/secmesh-tune.sh ${PORT}" \
    "Setup wizard…"       "${DIR}/secmesh-setup.sh ${PORT}" \
    "Reboot SecMesh"      "${DIR}/secmesh-ctl.sh reboot ${PORT}" \
    "Pause SecMesh"       "${DIR}/secmesh-ctl.sh stop ${PORT}" \
    "Start SecMesh"       "${DIR}/secmesh-ctl.sh start ${PORT}" \
    "Quit tray icon"      "rm -f /tmp/${USER}/secmesh-tray.pid; pkill -f 'secmesh-tray.sh'" \
    2>/dev/null | grep -v '^$' | tail -n1)
rc=$?
[ "$rc" = 0 ] && [ -n "$ACTION" ] && setsid sh -c "$ACTION" >/dev/null 2>&1 &
exit 0