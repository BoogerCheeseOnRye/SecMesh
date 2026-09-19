#!/usr/bin/env python3
# make-icons.py — render the SecMesh taskbar icons (24×24) to app/assets/*.png
# using only the stdlib (zlib + struct), so the tray icon needs no ImageMagick.
#   on  = bright green hex-mesh node (fabric active, batteries healthy)
#   off = gray hex (fabric stopped / tray idle)
import zlib, struct, math, os, sys

SIZE = 24
C = SIZE / 2.0
R = 9.0

def seg_dist(px, py, ax, ay, bx, by):
    # distance from point P to segment AB
    abx, aby = bx - ax, by - ay
    t = ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby + 1e-12)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * abx, ay + t * aby
    return math.hypot(px - cx, py - cy)

def render(rgb):
    # rgb = (r,g,b) for the mesh color
    hex_edges = []
    for i in range(6):
        a = math.radians(60 * i)
        b = math.radians(60 * (i + 1))
        hex_edges.append(((C + R * math.cos(a), C + R * math.sin(a)),
                         (C + R * math.cos(b), C + R * math.sin(b))))
    sats = [(C, 4.2), (19.2, 15.5), (4.8, 15.5)]
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            # hex outline
            d = min(seg_dist(x + 0.5, y + 0.5, *a, *b) for a, b in hex_edges)
            a = 0.0
            if d <= 1.3:
                a = 0.95
            elif d <= 2.1:
                a = 0.45 * (1 - (d - 1.3) / 0.8)
            # spokes center→satellites
            for sx, sy in sats:
                ds = seg_dist(x + 0.5, y + 0.5, C, C, sx, sy)
                if ds <= 0.8:
                    a = max(a, 0.85)
            # center + satellite nodes
            dc = math.hypot(x + 0.5 - C, y + 0.5 - C)
            if dc <= 2.6:
                a = max(a, 1.0)
            for sx, sy in sats:
                ds = math.hypot(x + 0.5 - sx, y + 0.5 - sy)
                if ds <= 1.9:
                    a = max(a, 1.0)
            row += bytes((int(rgb[0] * a), int(rgb[1] * a), int(rgb[2] * a), int(255 * a)))
        rows.append(bytes(row))
    return rows

def png(rows, p):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        c += struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
        return c
    raw = b''.join(b'\x00' + r for r in rows)
    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(raw, 9))
    out += chunk(b'IEND', b'')
    with open(p, 'wb') as f:
        f.write(out)
    print('wrote', p, len(out), 'bytes')

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    assets = os.path.join(here, 'assets')
    os.makedirs(assets, exist_ok=True)
    png(render((0x2e, 0xcc, 0x71)), os.path.join(assets, 'secmesh-on.png'))
    png(render((0x98, 0x9a, 0x9e)), os.path.join(assets, 'secmesh-off.png'))
    png(render((0xe6, 0x74, 0x3b)), os.path.join(assets, 'secmesh-warn.png'))
    return 0

if __name__ == '__main__':
    sys.exit(main())