#!/bin/bash
# secmesh-tune.sh — live fabric tuning (behind the tray menu "Tune Fabric…"):
# flips the autoscale + watchdog switches and re-keys the fabric with a chosen
# bench round count, straight to the supervisor through serve.js /peerctl (the
# same proxy the console uses). Read-only when status is unreachable.
#   spawned by the tray menu   arg: [$1 = port]
set -u
PORT=${1:-8080}
API="http://127.0.0.1:${PORT}"

cur=$(curl -s -m 4 "${API}/peerctl?action=status" 2>/dev/null)
vals=$(
  printf '%s' "$cur" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(int(d.get('auto') or 0))
    print(int(d.get('watchdog') or 1))
    print(int(d.get('rounds') or 8000))
except Exception:
    print(0); print(1); print(8000)" 2>/dev/null)
mapfile -t v <<< "$vals"
auto_now=${v[0]:-0}; wd_now=${v[1]:-1}; rounds_now=${v[2]:-8000}

row=$(yad --form \
  --field="Autoscale — grow/retire peers by free RAM":CHK "$([ "$auto_now" = 1 ] && echo TRUE || echo FALSE)" \
  --field="Watchdog — respawn a dead peer / hold a stopped one":CHK "$([ "$wd_now" = 1 ] && echo TRUE || echo FALSE)" \
  --field="Re-key bench rounds":NUM "$rounds_now!400..100000!32" \
  --title="SecMesh — tune the live fabric" --width=470 --height=130 \
  --button="Close:1" --button="Tune fabric:0" 2>/dev/null)
[ -z "$row" ] && exit 0
IFS=$'\t' read -r new_auto new_wd new_rounds <<< "$row"
new_rounds=$(printf '%.0f' "${new_rounds:-$rounds_now}" 2>/dev/null || echo "$rounds_now")

logs=""
if [ "$new_auto" = TRUE ] && [ "$auto_now" != 1 ]; then curl -s -m 5 -X POST "${API}/peerctl?action=auto&on=1" >/dev/null 2>&1; logs="$logs · autoscale on"
elif [ "$new_auto" = FALSE ] && [ "$auto_now" != 0 ]; then curl -s -m 5 -X POST "${API}/peerctl?action=auto&on=0" >/dev/null 2>&1; logs="$logs · autoscale off"
fi
if [ "$new_wd" = TRUE ] && [ "$wd_now" != 1 ]; then curl -s -m 5 -X POST "${API}/peerctl?action=wd&on=1" >/dev/null 2>&1; logs="$logs · watchdog on"
elif [ "$new_wd" = FALSE ] && [ "$wd_now" != 0 ]; then curl -s -m 5 -X POST "${API}/peerctl?action=wd&on=0" >/dev/null 2>&1; logs="$logs · watchdog off"
fi
if [ "$new_rounds" != "$rounds_now" ]; then
  out=$(curl -s -m 20 -X POST "${API}/peerctl?action=seed&rounds=${new_rounds}" 2>/dev/null)
  if printf '%s' "$out" | grep -q '"ok":true'; then logs="$logs · re-key ${new_rounds} rounds"
  else logs="$logs · re-key failed"; fi
fi
[ -z "$logs" ] && { notify-send -t 2000 "SecMesh · Tune" "nothing changed" 2>/dev/null || true; exit 0; }
notify-send -t 4000 "SecMesh · Tune" "applied:$logs" 2>/dev/null || true
echo "tune:$logs"
exit 0