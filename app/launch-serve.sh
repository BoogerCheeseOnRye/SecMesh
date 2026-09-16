#!/bin/bash
# serve launcher — the SAME command the desktop icon's "ARM / relaunch" fires.
# kill by PORT only (fuser) — NEVER a -f pattern (would match this script's own argv).
cd "$(dirname "$0")" || exit 1
fuser -k 8080/tcp 2>/dev/null; sleep 1.5
node --check serve.js || exit 1
setsid node serve.js > /tmp/serve.launch.log 2>&1 < /dev/null &
disown
sleep 2.5
pgrep -f "serve.js" | head -5
