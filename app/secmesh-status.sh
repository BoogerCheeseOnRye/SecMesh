#!/bin/bash
# secmesh-status.sh — tray menu "Status…": live fabric summary in a small dialog.
set -u
PORT=${1:-8080}
API="http://127.0.0.1:${PORT}"
curl -s -m 6 "${API}/peerctl?action=status" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('<b>SecMesh</b> — control API unreachable')
    sys.exit(0)
rows = []
pairs = d.get('pairs') or []
up = sum(1 for p in pairs if p.get('up'))
rows.append('<b>Host peers</b>  %d/%d up' % (up, len(pairs)))
if 'parking' in d:
    rows.append('<span color=\"#e6743b\">%d peer(s) parked on battery</span>' % d['parking'])
rows.append('')
chassis = d.get('chassis') or []
rows.append('<b>Devices</b>')
if not chassis:
    rows.append('  none attached')
for c in chassis:
    b = c.get('battery')
    if b is None or b.get('level') is None:
        batt = '—'
    elif b.get('level') < 0:
        batt = '—'
    else:
        lvl = b.get('level')
        fill = '●' if b.get('charging') else '○'
        col = '#2ecc71' if (lvl >= 35 or b.get('charging')) else ('#e6743b' if lvl >= 20 else '#e74c3c')
        batt = '<span color=\"%s\">%s %d%%</span>' % (col, fill, lvl)
    tag = ' \u26a0 parked' if c.get('parked') else (' \u2716 offline' if c.get('absent') else '')
    rows.append('  %s \u00b7 %s%s    %s' % (c.get('name','?'), (c.get('model') or '?'), tag, batt))
rows.append('')
st = d.get('stats')
if st and isinstance(st, dict):
    rows.append('<b>Host</b>  load %.2f \u00b7 %d MiB free' % (st.get('load1',0) or 0, st.get('availMB',0) or 0))
if d.get('devPer') is not None:
    rows.append('  mesh: devPer=%s \u00b7 %d chassis' % (d['devPer'], len(chassis)))
er = d.get('lastError')
if er:
    rows.append('<span color=\"#e74c3c\">⚠ %s</span>' % er)
print('<span size=\"large\"><b>SecMesh fabric</b></span>\n' + '\n'.join(rows))
" > /tmp/secmesh-status.txt 2>/dev/null || echo 'unreachable' > /tmp/secmesh-status.txt
yad --title="SecMesh — Status" --info --width=460 --height=280 --button="Close:0" \
    --text="$(cat /tmp/secmesh-status.txt)" 2>/dev/null &
exit 0