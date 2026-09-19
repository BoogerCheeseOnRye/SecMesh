#!/bin/bash
# secmesh-status.sh — tray menu "Status…": live fabric summary in a small dialog.
# Shows host + supervisor uptime, the active fabric preset, and per-device
# battery, model and peer uptime. Reads both the supervisor status and /config.
set -u
PORT=${1:-8080}
API="http://127.0.0.1:${PORT}"
curl -s -m 6 "${API}/peerctl?action=status" 2>/dev/null > /tmp/secmesh-status.json
curl -s -m 4 "${API}/config" 2>/dev/null > /tmp/secmesh-config.json
python3 -c "
import sys, json, re
try:
    d = json.load(open('/tmp/secmesh-status.json'))
except Exception:
    print('<b>SecMesh</b> — control API unreachable')
    sys.exit(0)
try:
    cfg = json.load(open('/tmp/secmesh-config.json')).get('current') or {}
except Exception:
    cfg = {}

def fmt(s, short=True):
    s = max(0, int(s or 0))
    if short:
        d, r = divmod(s, 86400); h, r = divmod(r, 3600); m, _ = divmod(r, 60)
        if d:  return '%dd %dh' % (d, h)
        if h:  return '%dh %dm' % (h, m)
        if m:  return '%dm' % m
        return '%ds' % s
    d, r = divmod(s, 86400); h, r = divmod(r, 3600); m, s2 = divmod(r, 60)
    return '%dd %02d:%02d:%02d' % (d, h, m, s2)

rows = []
pairs = d.get('pairs') or []
up = sum(1 for p in pairs if p.get('up'))
rows.append('<b>Host peers</b>  %d/%d up' % (up, len(pairs)))
rows.append('supervisor up <b>%s</b>' % fmt(d.get('upS')))
if 'parking' in d:
    rows.append('<span color=\"#e6743b\">%d peer(s) parked on battery</span>' % d['parking'])
# config profile (from serve.js /config)
if cfg.get('profile'):
    rows.append('preset <b>%s</b> · %s peers · %s r/link · %s guards · %s%s' % (
        cfg.get('profile'), cfg.get('nodes'), cfg.get('rounds'), cfg.get('guards'), cfg.get('defStrat'),
        (' · auto' if cfg.get('auto') else ' · passive')))
rows.append('')
chassis = d.get('chassis') or []
rows.append('<b>Devices</b>')
if not chassis:
    rows.append('  none attached')
for c in chassis:
    b = c.get('battery')
    if b and b.get('level') is not None and b.get('level') >= 0:
        lvl = b.get('level')
        fill = '●' if b.get('charging') else '○'
        col = '#2ecc71' if (lvl >= 35 or b.get('charging')) else ('#e6743b' if lvl >= 20 else '#e74c3c')
        batt = '<span color=\"%s\">%s %d%%</span>' % (col, fill, lvl)
    else:
        batt = '—'
    tag = ' \u26a0 parked' if c.get('parked') else (' \u2716 offline' if c.get('absent') else '')
    up_txt = (' · up <b>%s</b>' % fmt(c.get('upS'))) if (c.get('upS') and c.get('phones')) else ''
    rows.append('  %s \u00b7 %s%s%s    %s' % (c.get('name','?'), (c.get('model') or '?'), tag, up_txt, batt))
rows.append('')
st = d.get('stats')
if st and isinstance(st, dict):
    rows.append('<b>Host</b>  load %.2f \u00b7 %d MiB free \u00b7 %dc \u00b7 mem %d%%' % (
        st.get('load1',0) or 0, st.get('availMB',0) or 0, st.get('cores',0) or 0, st.get('usedPct',0) or 0))
if d.get('devPer') is not None:
    rows.append('  mesh: devPer=%s \u00b7 %d chassis' % (d['devPer'], len(chassis)))
if d.get('autoCap') is not None:
    rows.append('  autoscale cap %s peers' % d['autoCap'])
er = d.get('lastError')
if er:
    rows.append('<span color=\"#e74c3c\">⚠ %s</span>' % re.sub(r'<[^>]+>', '', er)[:160])
print('<span size=\"large\"><b>SecMesh fabric</b></span>\n' + '\n'.join(rows))
" > /tmp/secmesh-status.txt 2>/dev/null || echo 'unreachable' > /tmp/secmesh-status.txt
yad --title="SecMesh — Status" --info --width=520 --height=320 --button="Close:0" \
    --text="$(cat /tmp/secmesh-status.txt)" 2>/dev/null &
exit 0