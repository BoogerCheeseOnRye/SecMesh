#!/bin/bash
# secmesh-config.sh — tray menu "Config…": fabric preset drawer.
# Low / Medium / High scale the entangled-node count, bench rounds, guard count
# and supervisor strategy; applying one POSTs it to serve.js /config?profile=<n>,
# which persists it and restarts the supervisor with the profile's args.
#   spawned by the tray menu   arg: [$1 = port]
set -u
PORT=${1:-8080}
API="http://127.0.0.1:${PORT}"

cur=$(curl -s -m 4 "${API}/config" 2>/dev/null)
prof=$(printf '%s' "$cur" | python3 -c "
import sys, json
try:
    c = json.load(sys.stdin).get('current') or {}
    print(c.get('profile') or 'default')
except Exception:
    print('?')" 2>/dev/null)
[ -z "$prof" ] || [ "$prof" = "?" ] && prof="default"

row_low="Low — conservation · 2 peers · 4k rounds · 2 guards · perimeter · passive (no autoscale)"
row_med="Medium — balanced · 5 peers · 8k rounds · 4 guards · sweep · auto-scale"
row_hi="High — firepower · 9 peers · 16k rounds · 6 guards · pursuit · auto-scale (RAAM-bounded)"

pick=$(yad --list --radiolist --column=Pick --column=Profile --column=Fabric \
  "$([ "$prof" = low ] && echo TRUE || echo FALSE)" "low"    "$row_low" \
  "$([ "$prof" = medium ] && echo TRUE || echo FALSE)" "medium" "$row_med" \
  "$([ "$prof" = high ] && echo TRUE || echo FALSE)" "high"   "$row_hi" \
  --title="SecMesh — fabric preset" --width=640 --height=230 \
  --print-column=2 --separator="|" --no-headers \
  --button="Close:1" --button="Apply preset:0" 2>/dev/null | tail -n1)

[ -z "${pick:-}" ] && exit 0
sel=$(printf '%s' "$pick" | tr -d '|')
case "$sel" in
  low|medium|high) ;;
  *) exit 0 ;;
esac

notify-send -t 2000 "SecMesh · Config" "applying ${sel} preset — restarting the fabric…" 2>/dev/null || true
out=$(curl -s -m 70 -X POST "${API}/config?profile=${sel}" 2>/dev/null)
msg=$(printf '%s' "$out" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('ok') and d.get('applied'):
        s = d['applied']
        print('OK — %s · %s peers · %s rounds · %s guards · %s' % (s.get('profile'), s.get('nodes'), s.get('rounds'), s.get('guards'), s.get('defStrat')))
    else:
        print('error: ' + str(d.get('error', '?')))
except Exception:
    print('no reply from serve.js')" 2>/dev/null)
notify-send -t 5000 "SecMesh · ${sel} preset" "${msg}" 2>/dev/null || true
echo "config ${sel}: ${msg}"
exit 0