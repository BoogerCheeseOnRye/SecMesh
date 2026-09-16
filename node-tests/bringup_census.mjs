import subprocess, json, time, sys

def sh(c, t=90):
    return subprocess.run(['bash','-c',c], capture_output=True, text=True, timeout=t, encoding='utf-8').stdout.strip()

SER = [s for s in sh("adb devices 2>/dev/null | sed -n '2,$p' | awk '{print $1}' | grep -v '^$'").split() if s]
print('serials', len(SER))
for i, ser in enumerate(SER[:4]):
    ent, ctl, sta = 20001+3*i, 20002+3*i, 20003+3*i
    family = f'node-{i}={ent}:{ctl}:{sta}'
    sh(f"adb -s {ser} forward --remove tcp:{ent} 2>/dev/null; adb -s {ser} forward --remove tcp:{ctl} 2>/dev/null; adb -s {ser} forward --remove tcp:{sta} 2>/dev/null")
    sh(f"adb -s {ser} forward tcp:{ent} tcp:{ent}; adb -s {ser} forward tcp:{ctl} tcp:{ctl}; adb -s {ser} forward tcp:{sta} tcp:{sta}")
    sh(f"adb -s {ser} shell 'cd /data/local/tmp/aarkanum && setsid sh launch.sh --name {family} </dev/null >/dev/null 2>&1 &'")
    print(f'  node-{i} {ser} ent:{ent} ctl:{ctl} sta:{sta} launched')
time.sleep(18)
c = json.loads(sh("curl -s -m 10 http://127.0.0.1:8080/mesh"))
up = [n for n in c.get('nodes',[]) if n.get('up')]
print(f'CENSUS: {len(up)}/5 UP ->', ' '.join(f"{n['name']}@{n.get('sta')}" for n in up))
