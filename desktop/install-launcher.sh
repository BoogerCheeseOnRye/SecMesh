#!/bin/bash
# Install the one-click control-node launcher + desktop icons from a packaged
# aarkanum release tarball. Safe to re-run (idempotent): it only copies files.
#
#   cd <unpacked-release> && bash desktop/install-launcher.sh
#
# Result on the control node:
#   ~/.local/bin/aarkanum-secmesh-launch      (the full fabric bring-up script)
#   ~/Desktop/aarkanum.desktop                (Aarkanum AI — launches everything)
#   ~/Desktop/aarkanum-secmesh.desktop        (explicit SecMesh console icon)
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
BINDIR="$HOME/.local/bin"
DESK="$HOME/Desktop"

mkdir -p "$BINDIR" "$DESK"

# The launcher resolves its own repo at runtime (REPO discovery handles both the
# installed and the in-repo layout); bake the absolute repo path into the
# installed copy so it points at THIS unpacked repo even if moved afterwards.
REPO="$(cd "$HERE/.." && pwd)"
sed "s|^  REPO=.*\$|  REPO=$REPO|" \
  "$HERE/aarkanum-secmesh-launch" > "$BINDIR/aarkanum-secmesh-launch"
chmod +x "$BINDIR/aarkanum-secmesh-launch"

# Desktop entries must point at the ABSOLUTE installed launcher path so the
# icons survive this repo being moved/renamed after unpacking.
for f in aarkanum.desktop aarkanum-secmesh.desktop; do
  sed "s|^Exec=.*|Exec=$BINDIR/aarkanum-secmesh-launch|" "$HERE/$f" > "$DESK/$f"
  chmod +x "$DESK/$f"
done

echo "installed:"
echo "  $BINDIR/aarkanum-secmesh-launch"
echo "  $DESK/aarkanum.desktop"
echo "  $DESK/aarkanum-secmesh.desktop"
echo "double-click a desktop icon (or run aarkanum-secmesh-launch) to bring up"
echo "adb → serve.js :8080 → peer-supervisor :22100 → all phones → the console."