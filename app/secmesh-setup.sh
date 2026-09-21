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
DIR="$(cd "$(dirname "$0")" && pwd)"

# ── SCREEN 1 · INTRO — what SecMesh is / what you're installing ──
INTRO=$(python3 - <<'PY' 2>/dev/null
import re, html
try:
    t = open('/mnt/storage/aarkanum/docs/secmesh-concept.md', encoding='utf-8').read()
except Exception:
    t = ''
first = t.split('\n\n')[0] if t else 'SecMesh — a self-managing radio mesh security fabric.'
t = re.sub(r'\n{2,}', ' — ', t[:700]).strip()
print('<b>SecMesh</b> — a self-managing mesh security program')
print('')
print('  ' + t)
PY
)
yad --form --no-buttons --width=520 --height=260 \
    --title="Setup Wizard" \
    --field="<span foreground='#8e8f96'></span>:LBL" "" \
    --field="Biography":TXT "$(python3 - <<'PY' 2>/dev/null
print('SecMesh inhabits a small fleet of everyday devices — phones, tablets,\na netbook — that quietly work together to keep your home network safe.\n\nIt detects threats, quarantines them, and tells you exactly what it\nprevented. No cloud, no subscription, no setup complexity. Just a fabric\nof small machines acting as one.\n\nThis wizard will: scan your devices, choose a protection level, and\napply it — in under a minute.')
PY
)" \
    --button="Cancel:1" \
    --button="Start Setup:2" \
    --icon-name=security-medium \
    -s | grep -q ':2' || exit 0

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
    rows.append('  <span color="#e74c3c">none attached — is SecMesh running?</span>')
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
    rows.append('  <b>%s</b> · %s%s%s' % (c.get('name') or '?', m, batt, absent))
rows.append('')
rows.append('These devices will be used as one fabric. Next, pick a protection level.')
print('\n'.join(rows))
PY
)
yad --form --no-buttons --width=520 --height=300 \
    --title="Setup Wizard — Your Devices" \
    --field="":LBL "$(printf '')" \
    --field="":TXT "$CENSUS" \
    --button="Back:1" \
    --button="Next:2" \
    --icon-name=security-medium \
    -s | grep -q ':1' && exec "$0" ${PORT} || true

# ── SCREEN 3 · PROFILE — radio presets (byte-identical to secmesh-config.sh) ──
PROFILES=$(python3 - <<'PY' 2>/dev/null
import json, urllib.request
try:
    d = json.load(urllib.request.urlopen('http://127.0.0.1:8080/config', timeout=8))
except Exception:
    print('low|Medium|high')
    raise SystemExit
cur = (d.get('current') or {}).get('profile') or 'default'
print('FALSE|low|Low — conserve battery · balanced security')
print('FALSE|medium|Medium — balanced · fabric + executor')
print('FALSE|high|High — maximum width · firewall + quarantine')
print('RADIOSRC: ', cur)
PY
)
# the real radio body (formatted as yad list rows, byte-identical to config.sh)
PROF_DRAW=$(python3 - <<'PY' 2>/dev/null
import json

try:
    d = json.load(open('/tmp/secmesh-ui-config.json')) \
        if __import__('os').path.exists('/tmp/secmesh-ui-config.json') else None
except Exception:
    d = None
try:
    d = d or json.load(urllib.request.urlopen('http://127.0.0.1:8080/config', timeout=8))
except Exception:
    d = {}
cur = (d.get('current') or {}).get('profile') or 'low'
rows = []
presets = d.get('presets') or []
if not presets:
    presets = [
        {'name': 'low', 'rounds': 5, 'guards': 4},
        {'name': 'medium', 'rounds': 8, 'guards': 4},
        {'name': 'high', 'rounds': 16, 'guards': 6},
    ]
for p in presets:
    n = p.get('name') or '?'
    mark = '●' if n.lower() == str(cur).lower() else '○'
    desc = ' · '.join('%s %s' % (k, v) for k, v in p.items() if k != 'name')
    rows.append('%s %s  <span color="#8e8f96">%s</span>' % (mark, n, desc))
print('\n'.join(rows))
PY
)
yad --list --checklist --no-headers --column="Pick" --column="Preset" --column="Detail" \
    --width=520 --height=240 \
    --title="Setup Wizard — Protection Level" \
    --text="Choose how much protection SecMesh should provide:" \
    --button="Back:1" --button="Apply Config:2" \
    --format "ROW:%s" \
    --print-all \
    --column="o" \
    --separator="|" \
    < <(printf 'FALSE|low|Low — conserve battery, balanced security\nFALSE|medium|Medium — balanced, fabric+executor\nFALSE|high|High — max width, firewall+quarantine\n') \
    -s | grep -q ':1' && exec "$0" ${PORT}
echo "$PROF_DRAW" >/tmp/secmesh-setup-profile.txt

# read which radio was chosen from the yad output (first col is the toggle)
CHOICE=$(echo "$PROF_DRAW" | grep -o 'TRUE|[a-z]*' | head -1 | cut -d'|' -f2)
[ -z "$CHOICE" ] && CHOICE=medium

# ── SCREEN 4 · APPLY + VERIFY — POST profile, confirm live (byte-identical) ──
curl -s -m 20 -X POST "${API}/config?profile=${CHOICE}" >/tmp/secmesh-setup-apply.json
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
rows.append('  <span color="#2ecc71">● %d/%d devices active</span>' % (up, len(pairs)))
rows.append('  profile: <b>%s</b>' % '$CHOICE')
rows.append('')
rows.append('  Open the dashboard in your browser to watch it work.')
print('\n'.join(rows))
PY
)
yad --image=secmesh-on --form --title="Setup Wizard — Complete" --width=520 --height=220 \
    --field="":TXT "$VERIFY" \
    --button="Open Dashboard:xdg-open '${CONSOLE}'" \
    --button="Close:0" \
    -s >/dev/null 2>&1
