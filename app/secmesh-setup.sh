#!/bin/bash
# secmesh-setup.sh — the SecMesh **Setup Wizard**: the consumer-program
# "Install a security program" experience. Four short sequential screens
# (intro → device census → preset → apply+verify), each a separate lightweight
# yad dialog; nothing resident. Data is byte-identical to the tray's proven
# secmesh-status.sh / secmesh-config.sh renderers and the ctl/rt POST paths.
#
# Usage: app/secmesh-setup.sh [PORT]   Defaults: PORT=8080
set -u
PORT=${1:-8080}
API="http://127.0.0.1:${PORT}"
CONSOLE="${API}/crosslab/security_defender.html"
ICON="$(cd "$(dirname "$0")" && pwd)/assets/secmesh-on.png"

# launch log — every attempt self-reports its context + each screen's outcome
WZLOG=/tmp/secmesh-wizard.log
{
  echo "== $(date '+%F %T') start pid=$$  via=$(ps -o comm= -p ${PPID:-1} 2>/dev/null | tr -d ' ')  pwd=$(pwd)  DISPLAY=${DISPLAY:-none}"
} >> "$WZLOG" 2>/dev/null

# screen-fit centered geometry (fallback if xdpyinfo unavailable: 700x600)
DIMS=$(xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2; exit}')
SW=${DIMS%x*}; SH=${DIMS#*x}
[ -z "$SW" ] && SW=1366; [ -z "$SH" ] && SH=768
W=$(( SW * 2 / 3 ));  [ "$W" -lt 700 ] && W=700;  [ "$W" -gt 1000 ] && W=1000
H=$(( SH * 3 / 4 ));  [ "$H" -gt 620 ] && H=620
GEOM="${W}x${H}+$(( (SW - W) / 2 ))+$(( (SH - H) / 2 ))"

# ── SCREEN 1 · INTRO — what SecMesh is / what you're installing ──
yad --center --geometry="${GEOM}" --window-icon="${ICON}" --image="${ICON}" --image-on-top \
    --title="SecMesh Setup — Welcome" --width=560 --height=340 --form \
    --field="":LBL "<b>Install your home security fabric</b>

SecMesh turns the phones and devices you already own into one quiet fabric that watches your home network, blocks intruders, and repairs itself when attacked — no cloud, no subscription.

It detects threats, quarantines them, and tells you what it prevented. Just a mesh of small machines acting as one.

This wizard will: <b>1</b> scan your devices · <b>2</b> choose a protection level · <b>3</b> apply it — in under a minute." \
    --button="Cancel":1 --button="Start Setup":2 >/dev/null 2>&1
rc=$?
echo "   screen1 intro rc=$rc" >> "$WZLOG"
[ "$rc" = 2 ] || exit 0

# ── SCREEN 2 · CENSUS — who's attached, who's absent (byte-identical to status.sh) ──
CENSUS=$(curl -s -m 8 "${API}/peerctl?action=status" 2>/dev/null >/tmp/secmesh-setup-status.json
python3 - <<'PY' 2>/dev/null
import json
try:
    d = json.load(open('/tmp/secmesh-setup-status.json'))
except Exception:
    d = {}
chassis = d.get('chassis') or []
rows = []
rows.append('<b>Devices found on your mesh (%d)</b>' % len(chassis))
rows.append('')
if not chassis:
    rows.append('<span color="#e74c3c">none attached — is SecMesh running?</span>')
for c in chassis:
    m = c.get('model') or '?'
    b = c.get('battery')
    batt = ''
    if b and b.get('level') is not None and b.get('level') >= 0:
        lvl = b['level']
        fill = '◉' if b.get('charging') else '○'
        col = '#2ecc71' if (lvl >= 35 or b.get('charging')) else ('#e6743b' if lvl >= 20 else '#e74c3c')
        batt = '  <span color="%s">%s %d%%</span>' % (col, fill, lvl)
    absent = ' <span color="#e74c3c">✖ absent</span>' if c.get('absent') else ''
    rows.append('<b>%s</b> · %s%s%s' % (c.get('name') or '?', m, batt, absent))
rows.append('')
rows.append('These devices will run as one fabric. Next, pick a protection level.')
print('\n'.join(rows))
PY
)
yad --center --window-icon="${ICON}" --title="SecMesh Setup — Your Devices" --width=560 --height=320 --form \
    --field="":LBL "<b>Here is what SecMesh found:</b>" \
    --field="Fabric devices":LBL "$CENSUS" \
    --button="Back":1 --button="Next":2 >/dev/null 2>&1
rc=$?
echo "   screen2 census rc=$rc" >> "$WZLOG"
[ "$rc" = 1 ] && exec "$0" "$PORT"
[ "$rc" = 2 ] || exit 0

# ── SCREEN 3 · PROFILE — radio presets (live rows, byte-identical to config.sh) ──
ROWS=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json
api = sys.argv[1]
try:
    d = json.load(urllib.request.urlopen(api + '/config', timeout=8))
except Exception:
    print('FALSE|low|Low — conservation · 2 peers · 4k rounds · 2 guards')
    raise SystemExit
cur = (d.get('current') or {}).get('profile') or 'default'
for p in (d.get('presets') or []):
    n = (p or {}).get('profile') or (p or {}).get('name') or '?'
    mark = 'TRUE' if str(n).lower() == str(cur).lower() else 'FALSE'
    bits = []
    if p.get('nodes') is not None: bits.append('%s peers' % p.get('nodes'))
    if p.get('rounds') is not None: bits.append('%s r/link' % p.get('rounds'))
    if p.get('guards') is not None: bits.append('%s guards' % p.get('guards'))
    if p.get('defStrat') is not None: bits.append(str(p.get('defStrat')))
    if p.get('auto'): bits.append('auto-scale')
    print('%s|%s|%s — %s' % (mark, n, (p or {}).get('label') or n, ' · '.join(bits)))
PY
)
pick=$(yad --center --window-icon="${ICON}" --list --radiolist \
    --column="Pick":RAD --column="Profile":HD --column="Fabric":TEXT \
    --no-headers --title="SecMesh Setup — Protection Level" --width=660 --height=260 \
    --text="How much protection should SecMesh provide?" \
    --print-column=2 --separator="|" \
    --button="Back":1 --button="Apply preset":0 <<< "$ROWS" 2>/dev/null | tail -n1)
rc=$?
echo "   screen3 profile: rc=$rc pick='${pick%|*}'" >> "$WZLOG"
[ "$rc" = 1 ] && exec "$0" "$PORT"
[ "$rc" = 0 ] || exit 0
sel=$(printf '%s' "$pick" | tr -d '|' | tr -d '\n')
case "$sel" in
  low|medium|high) ;;
  *) echo "bad preset pick: '$pick'" >&2; exit 0 ;;
esac

# ── SCREEN 4 · APPLY + VERIFY — POST profile, confirm live (byte-identical) ──
notify-send -t 2000 "SecMesh · Setup" "applying ${sel} preset — restarting the fabric…" 2>/dev/null || true
out=$(curl -s -m 70 -X POST "${API}/config?profile=${sel}" 2>/dev/null)
msg=$(printf '%s' "$out" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('ok') and d.get('applied'):
        s = d['applied']
        print('%s · %s peers · %s rounds · %s guards · %s' % (s.get('profile'), s.get('nodes'), s.get('rounds'), s.get('guards'), s.get('defStrat')))
    else:
        print('error: ' + str(d.get('error', '?')))
except Exception:
    print('no reply from serve.js')" 2>/dev/null)
echo "   screen4 apply: msg='${msg}'" >> "$WZLOG"
sleep 2
VERIFY=$(curl -s -m 8 "${API}/peerctl?action=status" 2>/dev/null
python3 - <<'PY' 2>/dev/null
import json
try:
    d = json.load(open('/tmp/secmesh-setup-status.json'))
except Exception:
    d = {}
pairs = d.get('pairs') or []
up = sum(1 for p in pairs if p.get('up'))
rows = ['<b>All done — SecMesh is live with your settings.</b>', '']
rows.append('<span color="#2ecc71">● %d/%d device peers active</span>' % (up, len(pairs)))
rows.append('')
rows.append('Open the dashboard in your browser to watch it work.')
print('\n'.join(rows))
PY
)
yad --center --window-icon="${ICON}" --title="SecMesh Setup — Complete" --width=560 --height=240 --form \
    --field="Applied":LBL "<b>${msg}</b>" \
    --field="":LBL "$VERIFY" \
    --button="Close":0 --button="Open Dashboard:setsid xdg-open '${CONSOLE}' >/dev/null 2>&1 &" >/dev/null 2>&1
exit 0