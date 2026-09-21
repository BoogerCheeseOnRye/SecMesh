#!/bin/bash
# secmesh-ui.sh — the ONE SecMesh window. A tabbed yad notebook styled like a
# consumer security program: Fabric (live per-device sensor cards) · Config
# (profile presets with Apply) · Blocked (quarantine/prevent log, age-aware) ·
# About (who SecMesh is + open the browser console).
# Reuses the SAME renderers as the tray Status…/Config… so data is byte-identical.
# Spawn-on-open; notebook self-closes; nothing resident beyond the tray.
# Usage: app/secmesh-ui.sh [PORT]
set -u
PORT=${1:-8080}
API="http://127.0.0.1:${PORT}"
CONSOLE="${API}/crosslab/security_defender.html"
# key for the notebook bus (any unused num)
KEY=secmesh-ui-${PORT}

# ── render the Fabric tab body (identical renderer to secmesh-status.sh.sh) ──
FAB=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json, re
api = sys.argv[1]
def g(p):
    try:
        return json.load(urllib.request.urlopen(api + '/peerctl?action=status', timeout=8))
    except Exception:
        return None
d = g('status') or {}
def fmt(s):
    s = max(0, int(s or 0)); d, r = divmod(s, 86400); h, r = divmod(r, 3600); m, _ = divmod(r, 60)
    if d: return '%dd %dh' % (d, h)
    if h: return '%dh %dm' % (h, m)
    if m: return '%dm' % m
    return '%ds' % s
rows = []
pairs = d.get('pairs') or []; chassis = d.get('chassis') or []
up = sum(1 for p in pairs if p.get('up'))
rows.append('<b>Fabric</b>  %d/%d peers up · %d chassis attached · supervisor up %s' % (
    up, len(pairs), len(chassis), fmt(d.get('upS'))))
rows.append('')
limit = None
if (d.get('parking') or 0) > 0:
    rows.append('  <span color="#e6743b">■ %d device(s) parked on battery (charge &lt; %.0f%%)</span>' % (
        d.get('parking') or 0, 100.0 * ((d.get('parking') or 5) / 10.0)))
def fmtb(b, short):
    s = max(0, int(format(b or 0, 'f') or 0))
    if short:
        d, r = divmod(s, 86400); h, r = divmod(r, 3600); m, _ = divmod(r, 60)
        if d: return '%dd %dh' % (d, h)
        if h: return '%dh %dm' % (h, m)
        if m: return '%dm' % m
        return '%ds' % s
    d, r = divmod(s, 86400); h, r = divmod(r, 3600); m, s2 = divmod(r, 60)
    return '%dd %d:%02d:%02d' % (d, h, m, s2)
for c in chassis or []:
    n = c.get('name') or '?'
    m = c.get('model') or '?'
    up_txt = ' · up <b>%s</b>' % fmtb(c.get('upS')) if (c.get('upS') and c.get('phones')) else ''
    if (c.get('absent')):
        tag = ' ✖ offline'; batt = ''
    else:
        tag = ''
        b = c.get('battery') or {}
        lvl = b.get('level')
        if lvl is not None and lvl >= 0:
            fill = '◉' if b.get('charging') else '○'
            col = '#2ecc71' if lvl >= 40 or b.get('charging') else '#e6743b'
            batt = ' <span color="%s">%s %d%%</span>' % (col, fill, lvl)
            sens = []
            if b.get('tempC') is not None:
                sens.append('🌡 %.1f°C' % b['tempC'])
            if b.get('voltageMv') is not None:
                sens.append('%d mV' % b['voltageMv'])
            if b.get('currentMa') is not None:
                sens.append('🗲 %d mA' % b['currentMa'])
            if sens:
                batt += ' · ' + ' · '.join(sens)
        else:
            batt = ''
    rows.append('  <b>%s</b> · %s%s · %s%s' % (n, m, tag, up_txt, batt))
rows.append('')
prof = d.get('profile') or 'default'
rows.append('  preset <b>%s</b> · %d world %s ago' % (prof, ...))
print('\n'.join(rows))
PY
)

# ── render the Config tab body (identical to secmesh-config.sh) ──
CONF=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json
api = sys.argv[1]
try:
    d = json.load(urllib.request.urlopen(api + '/config', timeout=8))
except Exception:
    print('<b>SecMesh</b>\n\nConfig API unreachable — is the service up? (use Start SecMesh)')
    raise SystemExit
cur = (d.get('current') or {}).get('profile') or 'default'
rows = ['<b>Config — fabric presets</b>', '', '  current: <b>%s</b>' % cur, '']
for p in (d.get('presets') or []):
    n = (p or {}).get('name') or '?'
    mark = ' ●' if str(n).lower() == str(cur).lower() else ' ○'
    rows.append('  %s  <b>%s</b>' % (mark, n))
    for k in ('rounds', 'guards', 'battery', 'profile'):
        if p.get(k) is not None:
            rows.append('      %-9s %s' % (k, p[k]))
    rows.append('')
print('\n'.join(rows))
PY
)

# ── render the Blocked tab body (consumer security log: quarantine + parked + strikes) ──
BLK=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json
api = sys.argv[1]
try:
    d = json.load(urllib.request.urlopen(api + '/peerctl?action=status', timeout=8))
except Exception:
    d = {}
def fmt(s):
    s = max(0, int(s or 0))
    d, r = divmod(s, 86400); h, r = divmod(r, 3600); m, _ = divmod(r, 60)
    if d: return '%dd %dh' % (d, h)
    if h: return '%dh %dm' % (h, m)
    if m: return '%dm' % m
    return '%ds' % s
rows = ['<b>Blocked — SecMesh prevented these devices from harm</b>', '']
qs = d.get('quarantines') or []
if not qs:
    rows.append('  <span color="#8e8f96">nothing quarantined</span>')
for q in qs:
    rows.append('  ⛔ <b>%s</b> · %s' % (q.get('name') or '?', q.get('reason') or '?ove'))
    if q.get('leftS') is not None:
        rows.append('      <span color="#8e8f96">quarantined %s ago — left %s</span>' % (
            fmt(q.get('leftS')), fmt(q.get('leftS'))))
rows.append('')
park = sum(1 for c in (d.get('chassis') or []) if c.get('parked'))
if park:
    rows.append('  <span color="#e6743b">■ %d device(s) parked on battery</span>' % park)
rows.append('')
strikes = d.get('strikes') or 0
if strikes:
    rows.append('  <span color="#e74c3c">⚠ %d strike(s) this session</span>' % strikes)
err = d.get('lastError')
if err:
    age = d.get('errAt')
    rows.append('  <span color="#e74c3c">⚠ %s</span>' % err)
print('\n'.join(rows))
PY
)

# ── About tab body (who SecMesh is — from the repo's own docs, NOT app/README.md) ──
ABT=$(python3 - <<'PY' 2>/dev/null
import re, html
try:
    t = open('/mnt/storage/aarkanum/app/about.html', encoding='utf-8').read()
except Exception:
    t = ''
t = re.sub(r'<script.*?</script>', '', t, flags=re.S)
t = re.sub(r'<style.*?</style>', '', t, flags=re.S)
t = re.sub(r'<[^>]+>', '\n', t)
t = html.unescape(t)
t = re.sub(r'\n{3,}', '\n\n', t)
print(t.strip()[:1500])
PY
)

# ── the tray "About" already has a real content source: app/about.html. So
#    About tab = that content + a "Open console in browser" link ──

# ── spawn the notebook (master) + 4 plugs (children); byte-different dialogs ──
readonly KEY
yad --plug=${KEY} --tab="Fabric" --list --no-headers --column="" --width=560 --height=380 \
    --text="${FAB}" --no-buttons &
yad --plug=${KEY} --tab="Config" --list --no-headers --column="" --width=560 --height=380 \
    --text="${CONF}" --no-buttons &
yad --plug=${KEY} --tab="Blocked" --list --no-headers --column="" --width=560 --height=380 \
    --text="${BLK}" --no-buttons &
yad --plug=${KEY} --tab="About" --list --no-headers --column="" --width=560 --height=380 \
    --text="${ABT}" --no-buttons &

exec yad --notebook --key=${KEY} --width=620 --height=440 --tab-pos=top \
    --title="SecMesh" --window-icon=/mnt/storage/aarkanum/app/assets/secmesh-on.png \
    --button="Open Console:setsid xdg-open '${CONSOLE}' >/dev/null 2>&1 &" \
    --button="Refresh:${0} ${PORT}" \
    --button="Close:0"
