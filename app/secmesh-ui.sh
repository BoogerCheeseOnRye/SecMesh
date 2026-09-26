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
# key for the notebook bus — yad 0.40 requires an INTEGER (a string key makes
# every --plug/--key parse fail: 'Cannot parse integer value'). $$ is unique
# per invocation and identical for all five dialogs spawned below.
KEY=$$

# ── render the Fabric tab body (identical renderer to secmesh-status.sh.sh) ──
FAB=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json, time
api = sys.argv[1]
def g(p):
    try:
        return json.load(urllib.request.urlopen(api + p, timeout=8))
    except Exception:
        return None
d = g('/peerctl?action=status') or {}
try:
    cfg = g('/config') or {}
    cfg = (cfg or {}).get('current') or {}
except Exception:
    cfg = {}
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
if cfg.get('profile'):
    rows.append('  preset <b>%s</b> · %s peers · %s r/link · %s guards · %s%s' % (
        cfg.get('profile'), cfg.get('nodes'), cfg.get('rounds'), cfg.get('guards'), cfg.get('defStrat'),
        (' · auto' if cfg.get('auto') else ' · passive')))
rows.append('  <span color="#8e8f96">⚙ watchdog %s · autoscale %s · signed ctl %s · %s</span>' % (
    'on' if d.get('watchdog') else 'off',
    'on' if d.get('auto') else 'off',
    'on' if d.get('signed') else 'off',
    'seeding…' if d.get('seeding') else 'idle'))
rows.append('  <span color="#8e8f96">%s rounds/link · rss cap %sMB · battery park %s%%→%s%% · %s phone × devPer=%s</span>' % (
    d.get('rounds'), d.get('rssHard'), d.get('batteryPark'), d.get('batteryResume'),
    d.get('devHosts'), d.get('devPer')))
rows.append('')
err = d.get('lastError')
if err:
    age = d.get('errAt')
    if age and (int(time.time() * 1000) - age) > 90000:
        rows.append('  <span color="#8e8f96">⚠ stale (%ds ago) — recovered</span>' % int((int(time.time() * 1000) - age) / 1000))
    else:
        rows.append('  <span color="#e74c3c">⚠ %s</span>' % err)
    rows.append('')
if (d.get('parking') or 0) > 0:
    rows.append('  <span color="#e6743b">■ %d device(s) parked on battery</span>' % (d.get('parking') or 0))
    rows.append('')
if pairs:
    rows.append('<b>Entangled nodes</b>  autoscale cap <b>%s</b> · user floor %s' % (d.get('autoCap'), d.get('userFloor') or 0))
    for p in pairs:
        if p.get('up'):
            mark, col, st = '◉', '#2ecc71', 'up <b>%s</b>' % fmt(p.get('upS'))
        else:
            mark, col = '○', '#8e8f96'
            st = 'down'
            if p.get('stopped'): st += ' (stopped — held)'
            if p.get('quarantined'): st += ' · quarantined'
        extra = []
        if p.get('rssMB'): extra.append('%sMB' % p['rssMB'])
        if p.get('restarts'): extra.append('%d restart%s' % (p['restarts'], 's' if p['restarts'] != 1 else ''))
        if p.get('strikes'): extra.append('%d strike%s' % (p['strikes'], 's' if p['strikes'] != 1 else ''))
        rows.append('  <span color="%s">%s</span> <b>%s</b> · %s%s' % (col, mark, p['name'], st, (' · ' + ' · '.join(extra)) if extra else ''))
    rows.append('')
devs = d.get('devices') or []
if devs:
    rows.append('<b>Phone peers</b>  %d connected peer%s across %d chassis' % (
        len(devs), '' if len(devs) == 1 else 's', len(chassis)))
    for x in devs:
        mark, col = ('◉', '#2ecc71') if x.get('up') else ('○', '#8e8f96')
        parts = []
        if x.get('parked'): parts.append('parked 🔋')
        if x.get('restarts'): parts.append('%d restart%s' % (x['restarts'], 's' if x['restarts'] != 1 else ''))
        if x.get('strikes'): parts.append('%d strike%s' % (x['strikes'], 's' if x['strikes'] != 1 else ''))
        rows.append('  <span color="%s">%s</span> <b>%s</b> · %s%s' % (col, mark, x['name'], x.get('model') or '?',
            (' · ' + ' · '.join(parts)) if parts else ''))
    rows.append('')
honey = d.get('honey') or []
if honey:
    rows.append('<b>Honeypot nodes</b>')
    for x in honey:
        rows.append('  <span color="#9aa">%s</span> · snare <b>%s</b> · alive %s%s' % (
            x['name'], x.get('snare') or 0, x.get('alive') or 0,
            ' · quarantined' if x.get('quarantined') else ''))
    rows.append('')
for c in chassis or []:
    n = c.get('name') or '?'
    m = c.get('model') or '?'
    up_txt = ' · up <b>%s</b>' % fmt(c.get('upS')) if (c.get('upS') and c.get('phones')) else ''
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
sl = (d.get('supLog') or '').split('|')
if sl and sl != ['']:
    rows.append('')
    rows.append('<b>Watchdog trace</b>')
    for ln in sl[-3:]:
        ln = ln.split(' sup · ', 1)[-1] if ' sup · ' in ln else ln
        rows.append('  <span color="#8e8f96">» %s</span>' % ln)
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
try:
    s = json.load(urllib.request.urlopen(api + '/peerctl?action=status', timeout=8))
except Exception:
    s = {}
cur = (d.get('current') or {}).get('profile') or 'default'
rows = ['<b>Config — fabric presets</b>', '', '  current: <b>%s</b>' % cur, '']
for p in (d.get('presets') or []):
    n = (p or {}).get('profile') or (p or {}).get('name') or '?'
    mark = ' ●' if str(n).lower() == str(cur).lower() else ' ○'
    rows.append('  %s  <b>%s</b>  · %s' % (mark, n, (p or {}).get('label') or ''))
    for k in ('rounds', 'guards', 'defStrat', 'auto'):
        if p.get(k) is not None:
            rows.append('      %-9s %s' % (k, p[k]))
    rows.append('')
rows.append('<b>Advanced — supervisor tunables</b>')
rows.append('<span color="#8e8f96">set at supervisor launch (a preset Apply restarts the fabric)</span>')
rows.append('')
rows.append('  <b>bench rounds</b>    %s /link     · presets 4k / 8k / 16k' % (s.get('rounds', d.get('current', {}).get('rounds') or '?')))
rows.append('  <b>RSS hard cap</b>     %s MB        · supervisor reboots a peer past this' % (s.get('rssHard') or '?'))
rows.append('  <b>battery park</b>     ≤ %s%%        · phone peers park below this while discharging' % (s.get('batteryPark') or '?'))
rows.append('  <b>battery resume</b>   ≥ %s%%        · peers revive once past this / charging' % (s.get('batteryResume') or '?'))
rows.append('  <b>autoscale</b>        %s            · peers grown/retired by free RAM (hysteresis)' % ('on' if s.get('auto') else ('off' if 'auto' in s else '?')))
rows.append('  <b>watchdog</b>         %s            · respawns dead peers · holds stopped ones' % ('on' if s.get('watchdog') else ('off' if 'watchdog' in s else '?')))
rows.append('  <b>device peers</b>     %s chassis × %s linked phone peer(s)' % (s.get('devHosts') or '?', s.get('devPer') or '?'))
rows.append('  <b>quarantine</b>       10 min built-in   · automatic rest after a strike')
rows.append('  <b>signed control</b>   %s' % ('on — control API needs HMAC' if s.get('signed') else 'off — local-only control'))
print('\n'.join(rows))
PY
)

# ── render the Blocked tab body (consumer security log: quarantine + parked + strikes) ──
BLK=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json, time
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
if qs:
    rows.append('')
park = sum(1 for c in (d.get('chassis') or []) if c.get('parked'))
if park:
    rows.append('  <span color="#e6743b">■ %d device(s) parked on battery</span>' % park)
    rows.append('')
strikes = d.get('strikes') or 0
if strikes:
    rows.append('  <span color="#e74c3c">⚠ %d strike(s) this session</span>' % strikes)
seedRows = (d.get('seedLog') or '').strip().splitlines()
autoHealed = [x for x in seedRows if ('KEY' in x or 'conference' in x)][-2:]
if autoHealed:
    rows.append('')
    rows.append('  <span color="#2ecc71">✓ auto-healed — live shared-secret links</span>')
    for x in autoHealed:
        rows.append('      <span color="#8e8f96">%s</span>' % x.strip()[:110])
err = d.get('lastError')
if err:
    age = d.get('errAt')
    if age and (int(time.time() * 1000) - age) > 90000:
        rows.append('  <span color="#8e8f96">⚠ stale (%ds ago) — recovered</span>' % int((int(time.time() * 1000) - age) / 1000))
    else:
        rows.append('  <span color="#e74c3c">⚠ %s</span>' % err)
print('\n'.join(rows))
PY
)

# ── Events tab (supervisor ring: watchdog/scale/seed/quarantine decisions) ──
EVN=$(python3 - "${API}" <<'PY' 2>/dev/null
import sys, urllib.request, json
api = sys.argv[1]
try:
    d = json.load(urllib.request.urlopen(api + '/peerctl?action=log&n=30', timeout=8))
except Exception:
    d = {}
rows = ['<b>Events — SecMesh activity</b>', '',
        '<span color="#8e8f96">rolling ring · newest last · press Refresh for the latest</span>', '']
lines = d.get('lines') or []
if not lines:
    rows.append('  <span color="#8e8f96">no events yet — supervisor idle</span>')
for ln in lines:
    t, rest = '', ln
    if 'T' in str(ln) and len(str(ln)) > 20:
        t, rest = ln[11:19], ln.split(' sup · ', 1)[-1]
    rest = str(rest).strip()
    lvl = ''
    if rest.startswith(('info', 'warn', 'error')):
        lvl, _, rest = rest.partition(' · ')
    col = '#8e8f96'
    if lvl == 'warn': col = '#e6743b'
    if lvl == 'error': col = '#e74c3c'
    if len(rest) > 220: rest = rest[:220] + '…'
    rows.append('  <span color="%s">%s%s%s</span> %s' % (col, t, (' ' if t else ''), lvl, rest))
print('\n'.join(rows))
PY
)

# ── About tab body (what SecMesh is — from the concept doc, NOT app/about.html) ──
ABT=$(python3 - <<'PY' 2>/dev/null
import re
try:
    t = open('/mnt/storage/aarkanum/docs/secmesh-concept.md', encoding='utf-8').read()
except Exception:
    t = ''

def section(md, start_pat):
    # return from the heading matching start_pat until the next top-level '## '
    lines = md.splitlines()
    out, on = [], False
    for ln in lines:
        if ln.startswith('## ') and not on:
            if start_pat in ln:
                on = True
                continue
        elif ln.startswith('## ') and on:
            break
        if on:
            out.append(ln)
    return '\n'.join(out)

rows = ['<b>SecMesh</b> — a self-managing mesh security fabric', '',
        '<span color="#8e8f96">from </span><b>docs/secmesh-concept.md</b><span color="#8e8f96"> — the concept baseline</span>', '']
idea = section(t, 'The idea in one paragraph')
if idea:
    # pull just the single conceptual paragraph, one line of human prose
    p = re.sub(r'^1\.?.*\n', '', idea)
    p = re.sub(r'\n{2,}', ' ', p).strip()
    p = re.sub(r'\*\*|`|\*', '', p)
    rows.append(p[:520])
rows.append('')
rows.append('<b>How it works</b>  every host a node with a health value; traffic')
rows.append('deposits pheromone trails and bends health when it misbehaves; a fixed')
rows.append('fleet of lightweight defenders hunts the offending flows; a healing')
rows.append('layer drives each degraded node back to baseline. No signatures, no')
rows.append('per-host rules, no operator retuning.')
rows.append('')
rows.append('<b>Baseline (69 trials, 3 seeds, config untouched)</b>  zero intrusions')
rows.append('and 1.000 availability through a 10× threat ramp and 8× wave growth;')
rows.append('15,855 attackers blocked; defense effort scales with attack load;')
rows.append('first degradation only at ~14× baseline, degrading smoothly and')
rows.append('self-healing instead of cliff-dropping. Defense cost is a fleet')
rows.append('property (~0.016–0.10 defenders per node), not a per-host line item.')
rows.append('')
rows.append('<b>Limits</b>  "compromise" is a node driven below its 0.30 health')
rows.append('watermark (an early-warning flag, not a kill chain); steps are policy')
rows.append('intervals, not seconds; the attacker does not learn or coordinate; the')
rows.append('field is not a replacement for auth, encryption, or patching.')
rows.append('')
rows.append('<b>Reproduce</b>  node node-tests/secmesh-exp.mjs all')
print('\n'.join(rows))
PY
)

# ── About tab = the concept-doc summary above (from docs/ is authoritative) ──

# ── screen-fit geometry: center a resizable window that always fits ──
DIMS=$(xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2; exit}')   # e.g. 1366x768
SW=${DIMS%x*}; SH=${DIMS#*x}
W=$(( SW * 2 / 3 ));  [ "$W" -lt 700 ] && W=700;  [ "$W" -gt 1000 ] && W=1000
H=$(( SH * 3 / 4 ));  [ "$H" -gt 620 ] && H=620
GEOM="${W}x${H}+$(( (SW - W) / 2 ))+$(( (SH - H) / 2 ))"

# ── spawn the notebook (master) + 4 plugs (children); byte-different dialogs ──
# plug syntax: integer --plug=KEY --tabnum=N (the tab labels live on the
# notebook master's --tab= args, in the same order)
readonly KEY
yad --plug=${KEY} --tabnum=1 --list --no-headers --column="" --width=560 --height=380 \
    --text="${FAB}" --no-buttons &
yad --plug=${KEY} --tabnum=2 --list --no-headers --column="" --width=560 --height=380 \
    --text="${CONF}" --no-buttons &
yad --plug=${KEY} --tabnum=3 --list --no-headers --column="" --width=560 --height=380 \
    --text="${BLK}" --no-buttons &
yad --plug=${KEY} --tabnum=4 --list --no-headers --column="" --width=560 --height=380 \
    --text="${ABT}" --no-buttons &
yad --plug=${KEY} --tabnum=5 --list --no-headers --column="" --width=560 --height=380 \
    --text="${EVN}" --no-buttons &

exec yad --notebook --key=${KEY} --tab="Fabric" --tab="Config" --tab="Blocked" --tab="About" --tab="Events" \
    --width=620 --height=440 --tab-pos=top --geometry="${GEOM}" \
    --title="SecMesh" --window-icon=/mnt/storage/aarkanum/app/assets/secmesh-on.png \
    --button="Open Console:setsid xdg-open '${CONSOLE}' >/dev/null 2>&1 &" \
    --button="Refresh:${0} ${PORT}" \
    --button="Close:0"
