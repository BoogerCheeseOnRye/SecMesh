// Atomic Printer Sim — pure simulation core.
// Units: length nm, mass amu, time femtosecond.
// 1 eV = 9.6485e-5 (amu·nm^2/fs^2); k_B = 8.314e-9 (same units per K).
// All functions are side-effect free or operate on Chamber only (no DOM/three).

export const U0 = 1;                     // amu·nm^2/fs^2
export const K_B = 8.314e-9;             // per kelvin
export const EV = 9.6485e-5;             // eV in U0
export const GOLD = 2.399963229728653;   // golden angle rad

/* ---------------- helpers ---------------- */

export function fmtTime(fs){
  const a = Math.abs(fs);
  if (a < 1e3)        return { v: fs,            unit: 'fs',   prec: 2 };
  if (a < 1e6)        return { v: fs / 1e3,      unit: 'ps',   prec: 3 };
  if (a < 1e9)        return { v: fs / 1e6,      unit: 'ns',   prec: 3 };
  if (a < 1e12)       return { v: fs / 1e9,      unit: 'µs',   prec: 3 };
  if (a < 1e15)       return { v: fs / 1e12,     unit: 'ms',   prec: 3 };
  if (a < 6e16)       return { v: fs / 1e15,     unit: 's',    prec: 4 };
  if (a < 3.6e18)     return { v: fs / 6e16,     unit: 'min',  prec: 3 };
  if (a < 8.64e19)    return { v: fs / 3.6e18,   unit: 'h',    prec: 3 };
  if (a < 3.15576e22) return { v: fs / 8.64e19,  unit: 'd',    prec: 3 };
  if (a < 3.15576e28) return { v: fs / 3.15576e22, unit: 'y',  prec: 3 };   // 1 y ≈ 3.16e22 fs
  if (a < 3.15576e31) return { v: fs / 3.15576e28, unit: 'My', prec: 3 };   // 1 My ≈ 3.16e28 fs
  return { v: fs / 3.15576e31, unit: 'Gy', prec: 3 };                        // 1 Gy ≈ 3.16e31 fs
}
export function fmtFancyTime(fs){
  const t = fmtTime(fs);
  return `${t.v.toFixed(t.prec)} ${t.unit}`;
}
// rate = simulated femtoseconds advanced per rendered frame.
// The scale now spans 10 attoseconds → trillions of years per frame: the slow
// end resolves every bond wiggle in cinematic slo-mo, the macro end (beyond
// MAX_SUBSTEPS*DT_MAX) runs as one coarse PBD + renormalized-thermo substep
// that still lands the full commanded time every frame.
export const RATE_TICKS = [
  { fs: 0.01,  label: '0.01 fs' },
  { fs: 0.05,  label: '0.05 fs' },
  { fs: 0.1,   label: '0.1 fs' },
  { fs: 0.25,  label: '¼ fs' },
  { fs: 0.5,   label: '½ fs' },
  { fs: 1,     label: '1 fs' },
  { fs: 1e2,   label: '100 fs' },
  { fs: 1e3,   label: '1 ps' },
  { fs: 1e4,   label: '10 ps' },
  { fs: 1e5,   label: '100 ps' },
  { fs: 1e6,   label: '1 ns' },
  { fs: 1e7,   label: '10 ns' },
  { fs: 1e8,   label: '100 ns' },
  { fs: 1e9,   label: '1 µs' },
  { fs: 1e10,  label: '10 µs' },
  { fs: 1e11,  label: '100 µs' },
  { fs: 1e12,  label: '1 ms' },
  { fs: 1e13,  label: '10 ms' },
  { fs: 1e14,  label: '100 ms' },
  { fs: 1e15,  label: '1 s' },
  { fs: 1e16,  label: '10 s' },
  { fs: 1e17,  label: '100 s' },
  { fs: 1e18,  label: '17 min' },
  { fs: 1e20,  label: '28 h' },
  { fs: 1e22,  label: '116 d' },
  { fs: 1e24,  label: '32 y' },
  { fs: 1e26,  label: '3.2 ky' },
  { fs: 1e28,  label: '0.32 My' },
  { fs: 1e30,  label: '32 My' },
  { fs: 1e32,  label: '3.2 Gy' },
  { fs: 1e35,  label: '3.2 T y' },
];
export const DT_MIN = 0.01;      // fs / substep — resolves sub-femtosecond force detail
export const DT_MAX = 4000;      // fs / substep (fine-regime spring integration cap)
export const MAX_SUBSTEPS = 140;

export function hexToRgb(hex){
  if (!hex || typeof hex !== 'string') return [0.6, 0.6, 0.7];
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0.6, 0.6, 0.7];
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export function mix(a, b, t){
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function clamp(x, lo, hi){ return x < lo ? lo : (x > hi ? hi : x); }

/* ---------------- chamber geometry ---------------- */

export const SHAPES = [
  { id: 'cube',      label: 'Cube',      icon: '⬛', dim: '3D', help: 'The classic box. Chemistry at room scale.' },
  { id: 'cylinder',  label: 'Cylinder',  icon: '◍', dim: '3D', help: 'A vertical drum — like a reactor vessel.' },
  { id: 'sphere',    label: 'Sphere',    icon: '⬤', dim: '3D', help: 'Everything squeezed into a globe.' },
  { id: 'ellipsoid', label: 'Ellipsoid', icon: '◯', dim: '3D', help: 'A flattened globe — polar-compressed.' },
  { id: 'cone',      label: 'Cone',      icon: '▲', dim: '3D', help: 'A funnel that narrows upward.' },
  { id: 'pyramid',   label: 'Pyramid',   icon: '⛬', dim: '3D', help: 'Square base, pointy top.' },
  { id: 'torus',     label: 'Torus',     icon: '◌', dim: '3D', help: 'A doughnut of space — atoms orbit the hole.' },
  { id: 'helix',     label: 'Twist',     icon: '✱', dim: '3D', help: 'A knotted (2,3) stellarator tube — atoms thread the twist.' },
  { id: 'rose',      label: 'Rose Knot', icon: '✿', dim: '3D', help: 'A (2,5) torus knot wound as a five-fold rose — strands braid around a blooming axis.' },
  { id: 'crown',     label: 'Crown Knot', icon: '♛', dim: '3D', help: 'A (3,5) torus knot-nebula: three interlacing lobes that cinch a crown at the poles.' },
  { id: 'spire',     label: 'Spire Lattice', icon: 'ϟ', dim: '3D', help: 'A (3,7) torus knot so dense it reads as a woven spire-lattice — atoms thread a thready braid.' },
  { id: 'gyroid',    label: 'Gyroid',  icon: '≋', dim: '3D', help: 'The triply-periodic minimal surface — a cubic labyrinth of twisting bicontinuous channels.' },
  { id: 'cage',      label: 'Fullerene', icon: '⬭', dim: '3D', help: 'A hollow buckyball shell — atoms skate on the inside and outside walls of a C₆₀ cage.' },
  { id: 'plate',     label: 'Plate',     icon: '▭', dim: '2D', help: 'A thin slab — the arena for Chladni vibration patterns.' },
];

export const SHAPE_IDS = SHAPES.map(s => s.id);

/* Time bands for the deploy selector. Each experiment's dossier recommends one
   band + a concrete rate; the others are derived as relative dials so the user
   can stretch or freeze the simulation without breaking the scenario. */
export const TIME_BANDS = [
  { key: 'fs',  label: 'fs · pulse', why: 'frozen femtosecond frames — watch single bonds' },
  { key: 'ns',  label: 'ns · dial',  why: 'nanosecond sweep — chemistry resolves hand-over-hand' },
  { key: 'us',  label: 'µs · cruise', why: 'microsecond cruise — ensembles, melts, cascades' },
  { key: 's',   label: 's · conjure', why: 'seconds in a breath — long soaks and phase drama' },
];
export function timeBandRate(pick, key){
  if (pick && pick.time && key === pick.time.band) return pick.time.rate;
  const base = pick && pick.time ? pick.time.rate : 2e4;
  const m = TIME_BANDS.find(b => b.key === key);
  const mult = (key === 'fs') ? 1 / 200 : (key === 'us' ? 40 : (key === 's' ? 2000 : 1));
  return m ? Math.max(8, Math.round(base * mult)) : base;
}

/* ----- twisty stellarator tube: a (2,3) torus knot as a thick tube -----
   The knot lies FLAT — its two big loops sweep the horizontal XZ plane and the
   twist is thin in Y — so the machine reads as a horizontal stellarator from
   the default camera (axis standing vertically), matching the torus shape. */
const HELIX = { P: 2, Q: 3, Rf: 0.86, rf: 0.15, tube: 0.24 };
export const HELIX_TUBE = HELIX.tube;

/* Super-complex cage curves: every shape here is a thick tube wrapping a
   (P,Q) torus knot. Higher orders spin the atlas into a dense weave — a
   (3,5) or (3,7) knot has the strands interleaving far more than the flat
   stellarator, so atoms thread an intricate braid. The Rf/rf ratio is the
   same as the helix so the knot brackets the viewport identically; only the
   tube gauge shrinks for denser weaves so strands don't fuse. */
export const KNOTS = {
  rose:  { P: 2, Q: 5, Rf: 0.86, rf: 0.15, tube: 0.20 },
  crown: { P: 3, Q: 5, Rf: 0.86, rf: 0.15, tube: 0.17 },
  spire: { P: 3, Q: 7, Rf: 0.86, rf: 0.15, tube: 0.14 },
};
export function knotParams(shape){
  if (shape === 'helix') return HELIX;
  return KNOTS[shape] || null;
}
export function isKnotShape(shape){ return shape === 'helix' || !!KNOTS[shape]; }

export function torusKnotPoint(t, h, u){ return torusKnotPointC(t, h, u, HELIX.P, HELIX.Q); }

export function torusKnotPointC(t, h, u, P, Q){
  const R = h * 0.86, rq = h * 0.15, r = h * knotTubeOf(P, Q);
  const c = R + rq * Math.cos(Q * t);
  const x = c * Math.cos(P * t);
  const z = c * Math.sin(P * t);
  const y = rq * Math.sin(Q * t);
  if (u === undefined) return [x, y, z];
  const e = 1e-3;
  const T0 = torusKnotPointC(t - e, h, undefined, P, Q), T1 = torusKnotPointC(t + e, h, undefined, P, Q);
  let tx = (T1[0] - T0[0]) / (2 * e), ty = (T1[1] - T0[1]) / (2 * e), tz = (T1[2] - T0[2]) / (2 * e);
  const tl = Math.hypot(tx, ty, tz) || 1e-9; tx /= tl; ty /= tl; tz /= tl;
  let nx = -ty, ny = tx, nz = 0;
  const bl = Math.hypot(nx, ny, nz);
  if (bl < 1e-6){ nx = 0; ny = tz; nz = -ty; }
  else { nx /= bl; ny /= bl; nz /= bl; }
  const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
  const cl = Math.cos(u), sl = Math.sin(u);
  return [x + r * (nx * cl + bx * sl), y + r * (ny * cl + by * sl), z + r * (nz * cl + bz * sl)];
}
function knotTubeOf(P, Q){
  for (const q in KNOTS) if (KNOTS[q].P === P && KNOTS[q].Q === Q) return KNOTS[q].tube;
  return HELIX.tube;
}

function knotNearestT(x, y, z, h, P, Q){
  const S = 80;
  let best = 0, bd = Infinity;
  for (let i = 0; i < S; i++){
    const t = i / S * Math.PI * 2;
    const c = torusKnotPointC(t, h, undefined, P, Q);
    const d = (c[0] - x) ** 2 + (c[1] - y) ** 2 + (c[2] - z) ** 2;
    if (d < bd){ bd = d; best = t; }
  }
  let t = best, dt = Math.PI * 2 / S;
  for (let it = 0; it < 7; it++){
    const c0 = torusKnotPointC(t - dt, h, undefined, P, Q), c1 = torusKnotPointC(t, h, undefined, P, Q), c2 = torusKnotPointC(t + dt, h, undefined, P, Q);
    const da = (c0[0] - x) ** 2 + (c0[1] - y) ** 2 + (c0[2] - z) ** 2;
    const d1 = (c1[0] - x) ** 2 + (c1[1] - y) ** 2 + (c1[2] - z) ** 2;
    const db = (c2[0] - x) ** 2 + (c2[1] - y) ** 2 + (c2[2] - z) ** 2;
    if (da < d1 && da < db) t -= dt;
    else if (db < d1) t += dt;
    dt *= 0.5;
  }
  return t;
}
function helixNearestT(x, y, z, h){
  return knotNearestT(x, y, z, h, HELIX.P, HELIX.Q);
}

/* Gyroid — the triply-periodic minimal surface G = sin a·cos + sin·cos + cos·sin,
   split into two interpenetrating channel networks. Atoms live inside ONE network
   (the G ≥ G₀ sponge — the classic cubic-bicontinuous labyrinth that block-copolymer
   and lipid cubic phases form); the gyroid mid-surface is their wall. */
export function gyroidVal(x, y, z, h){
  const a = (Math.PI * 2.2) / Math.max(h, 0.5);
  return Math.sin(a * x) * Math.cos(a * y)
       + Math.sin(a * y) * Math.cos(a * z)
       + Math.sin(a * z) * Math.cos(a * x);
}
const GYROID_G0 = -0.8;
const GYROID_RMAX = 0.97;
function gyroidClamp(ch, x, y, z, m = 0){
  const h = ch.size;
  const gT = GYROID_G0 + 0.08 + m * 0.3;
  const rCap = h * GYROID_RMAX;
  const R = Math.hypot(x, y, z);
  let X = x, Y = y, Z = z;
  if (R > rCap){ const k = rCap / R; X *= k; Y *= k; Z *= k; }
  for (let it = 0; it < 24; it++){
    if (gyroidVal(X, Y, Z, h) >= gT) return [X, Y, Z];
    const e = 1e-4;
    const dgx = (gyroidVal(X + e, Y, Z, h) - gyroidVal(X - e, Y, Z, h)) / (2 * e);
    const dgy = (gyroidVal(X, Y + e, Z, h) - gyroidVal(X, Y - e, Z, h)) / (2 * e);
    const dgz = (gyroidVal(X, Y, Z + e, h) - gyroidVal(X, Y, Z - e, h)) / (2 * e);
    const gl2 = dgx * dgx + dgy * dgy + dgz * dgz;
    if (!(gl2 > 1e-12)) break;
    const step = 0.5 * (gT - gyroidVal(X, Y, Z, h)) / gl2;
    X += dgx * step; Y += dgy * step; Z += dgz * step;
    const r2 = Math.hypot(X, Y, Z);
    if (r2 > rCap){ const k = rCap / r2; X *= k; Y *= k; Z *= k; }
  }
  return [X, Y, Z];
}

/* Fullerene cage — a hollow spherical shell (like a buckyball wall). Atoms are
   confined to the shell skin, skating on the inner+outer walls. */
function cageClamp(ch, x, y, z, m = 0){
  const h = ch.size;
  const R = h * 0.82, t = Math.max(0.12, h * 0.26 - m);
  const r = Math.hypot(x, y, z) || 1e-9;
  const lo = Math.max(0.02, R - t), hi = R + t;
  if (r >= lo && r <= hi) return [x, y, z];
  const k = r < lo ? lo / r : hi / r;
  return [x * k, y * k, z * k];
}

// Signed clamp of a point into a chamber shape's interior. Returns closest contained point.
// `m` (optional) shrinks the interior by a skin depth so round bodies stay inside the cage.
export function shapeClampPoint(ch, x, y, z, h = ch.size, m = 0){
  const s = ch.shape || 'cube';
  switch (s){
    case 'sphere': {
      const r = Math.hypot(x, y, z);
      if (r > h){ const t = h / r; return [x * t, y * t, z * t]; }
      return [x, y, z];
    }
    case 'cylinder': {
      const rr = Math.hypot(x, z);
      const yy = clamp(y, -h, h);
      if (rr > h){ const t = h / rr; return [x * t, yy, z * t]; }
      return [x, yy, z];
    }
    case 'ellipsoid': {
      const a = h * 1.15, b = h * 0.8, c = h * 1.15;
      const n2 = (x / a) * (x / a) + (y / b) * (y / b) + (z / c) * (z / c);
      if (n2 > 1){ const t = 1 / Math.sqrt(n2); return [x * t, y * t, z * t]; }
      return [x, y, z];
    }
    case 'cone': {
      const yy = clamp(y, -h, h);
      const w = Math.max(0.001, (h - yy) / 2);
      const rr = Math.hypot(x, z);
      if (rr > w){ const t = w / rr; return [x * t, yy, z * t]; }
      return [x, yy, z];
    }
    case 'pyramid': {
      const yy = clamp(y, -h, h);
      const w = Math.max(0.001, (h - yy) / 2);
      return [clamp(x, -w, w), yy, clamp(z, -w, w)];
    }
    case 'torus': {
      const R = h * 0.72, r = h * 0.34;
      const rho = Math.hypot(x, z);
      const dCross = Math.hypot(rho - R, y);
      if (dCross > r){ const t = r / dCross; const rn = R + (rho - R) * t; const lam = rho > 1e-9 ? rn / rho : 0;
        return [x * lam, y * t, z * lam]; }
      return [x, y, z];
    }
    case 'helix':
    case 'rose':
    case 'crown':
    case 'spire': {
      const k = knotParams(s);
      const t = knotNearestT(x, y, z, h, k.P, k.Q);
      const c = torusKnotPointC(t, h, undefined, k.P, k.Q);
      const rTube = Math.max(0.05, h * k.tube - m);
      const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
      if (d > rTube && d > 1e-9){
        const r2 = rTube / d;
        return [c[0] + (x - c[0]) * r2, c[1] + (y - c[1]) * r2, c[2] + (z - c[2]) * r2];
      }
      return [x, y, z];
    }
    case 'gyroid':
      return gyroidClamp(ch, x, y, z, m);
    case 'cage':
      return cageClamp(ch, x, y, z, m);
    case 'plate': {
      const t = h * 0.22;
      return [clamp(x, -h, h), clamp(y, -t, t), clamp(z, -h, h)];
    }
    case 'cube':
    default:
      return [clamp(x, -h, h), clamp(y, -h, h), clamp(z, -h, h)];
  }
}

export function shapeContains(ch, x, y, z, tol = 1e-5){
  const s = ch.shape || 'cube';
  if (s === 'gyroid'){
    const h = ch.size;
    return gyroidVal(x, y, z, h) >= GYROID_G0 - 0.02
      && Math.hypot(x, y, z) <= h * GYROID_RMAX + 0.02;
  }
  const p = shapeClampPoint(ch, x, y, z);
  return Math.abs(p[0] - x) < tol && Math.abs(p[1] - y) < tol && Math.abs(p[2] - z) < tol;
}

// Clamp a point so a sphere of radius ~m fits fully inside the chamber: keeps
// atom centers a skin-depth inside the cage so their rendered bodies never
// poke through the boundary (inner wireframe). Uses a few Gauss-Seidel-like
// relaxations along the inward surface normal, which correctly handles sloped
// walls (cone / pyramid) where a single push can drift sideways out.
export function shapeInnerPoint(ch, x, y, z, mIn){
  const id = ch.shape || 'cube';
  // cone / pyramid have sloped walls that converge at the apex: a fixed normal
  // push can't rescue atoms parked near the tip, so clamp into the exact
  // margin-solid (apex cap pulled in by m*sqrt(1+slope^2), every ring shrunk by
  // the same amount) so a sphere of radius ~m always fits.
  if (id === 'cone' || id === 'pyramid'){
    const h = ch.size;
    const cap = mIn * Math.sqrt(5);
    const yy = Math.min(Math.max(y, -h + mIn), h - cap);
    const rrMax = Math.max(0, (h - yy - cap) / 2);
    if (id === 'cone'){
      const rr = Math.sqrt(x * x + z * z);
      const s = rr > rrMax && rr > 1e-9 ? rrMax / rr : 1;
      return [x * s, yy, z * s];
    }
    return [Math.sign(x) * Math.min(Math.abs(x), rrMax), yy, Math.sign(z) * Math.min(Math.abs(z), rrMax)];
  }
  // gyroid/twisty tubes: exact — clamp straight into the margin-shrunken interior
  if (id === 'gyroid' || id === 'helix' || id === 'rose' || id === 'crown' || id === 'spire') return shapeClampPoint(ch, x, y, z, ch.size, mIn);
  let X = x, Y = y, Z = z;
  const isTorus = id === 'torus';
  for (let it = 0; it < 3; it++){
    const p = shapeClampPoint(ch, X, Y, Z);
    const dx = X - p[0], dy = Y - p[1], dz = Z - p[2];
    const nd = Math.hypot(dx, dy, dz);
    if (nd > 1e-6){
      // outside: push inward by the margin along the outward normal
      const k = Math.min(mIn, nd * 0.999) / nd;
      X = p[0] - dx * k; Y = p[1] - dy * k; Z = p[2] - dz * k;
      continue;
    }
    // inside: probe outward; for the torus the interior is the tube
    // centerline (the origin sits in the hole)
    const reach = mIn * 2;
    let nx = 0, ny = 0, nz = 0, anyOut = false;
    if (isTorus){
      const R = ch.size * 0.72;
      const ang = Math.atan2(Z, X);
      const tx = R * Math.cos(ang), tz = R * Math.sin(ang);
      let ux = X - tx, uy = Y, uz = Z - tz;
      const ud = Math.hypot(ux, uy, uz) || 1e-9;
      ux /= ud; uy /= ud; uz /= ud;
      const pr = shapeClampPoint(ch, X + ux * reach, Y + uy * reach, Z + uz * reach);
      if ((pr[0] - (X + ux * reach)) ** 2 + (pr[1] - (Y + uy * reach)) ** 2 + (pr[2] - (Z + uz * reach)) ** 2 > 1e-10){
        nx = -ux * mIn; ny = -uy * mIn; nz = -uz * mIn; anyOut = true;
      }
    } else {
      const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (const [ax, ay, az] of axes){
        const pr = shapeClampPoint(ch, X + ax * reach, Y + ay * reach, Z + az * reach);
        if ((pr[0] - (X + ax * reach)) ** 2 + (pr[1] - (Y + ay * reach)) ** 2 + (pr[2] - (Z + az * reach)) ** 2 > 1e-10){
          anyOut = true; nx -= ax * mIn; ny -= ay * mIn; nz -= az * mIn;
        }
      }
    }
    if (!anyOut) break;
    X += nx; Y += ny; Z += nz;
  }
  return [X, Y, Z];
}

export function mulberry(seed){
  let t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- element derived params ---------------- */

const BLK_FALLBACK = { s: [0.8, 0.3, 0.9], p: [0.3, 0.85, 1.0], d: [1.0, 0.6, 0.25], f: [0.2, 0.9, 0.5] };

const NOBLE = 'Noble gas', METAL_LIKE = new Set([
  'Alkali metal', 'Alkaline earth', 'Transition metal', 'Post-transition',
  'Lanthanide', 'Actinide',
]);
const NONMETAL_LIKE = new Set(['Nonmetal', 'Metalloid', 'Unknown']);
// "roll with it" chemistry families derived straight from the audited dataset.
export function isMetal(el){ return METAL_LIKE.has(el.cat); }
export function isNoble(el){ return el.cat === NOBLE || el.grp === 18; }
export function isHalogen(el){ return el.grp === 17 && !isNoble(el); }
export function isAlkali(el){ return el.cat === 'Alkali metal'; }
export function isAlkaline(el){ return el.cat === 'Alkaline earth'; }
export function isNonmetal(el){ return NONMETAL_LIKE.has(el.cat); }

export function valence(el){
  if (isNoble(el)) return 0;
  if (el.grp >= 14 && el.blk === 'p') return el.grp - 10;      // C4 Si4 N3 O2 F1
  if (el.grp === 13 && el.blk === 'p') return 3;
  if (el.grp === 1) return 1;
  if (el.grp === 2) return 2;
  if (el.blk === 'd') return 4;                                 // metals: delocalized, cap display only
  if (el.blk === 'f') return 3;
  return 2;
}

// effective contact radius nm, from molar volume, clamped to sane atom sizes
export function atomRadius(el){
  const d = el.d && el.d > 0 ? el.d : (isMetal(el) ? 10 : 2);
  const V = el.m / (602.2 * d);                                 // nm^3
  let r = Math.cbrt(3 * V / (4 * Math.PI));
  r = clamp(r * 1.0, 0.11, 0.24);                               // H..Cs / superheavy bounds
  if (el.s === 'H') r = 0.12;
  if (isNoble(el)) r = clamp(r * 0.92, 0.12, 0.2);
  return r;
}
export function atomMass(el){ return el.m || 1; }

// LJ well depth (U0) keyed to melt temperature so phase change happens ~ T_melt
export function eps(el){
  const melt = el.melt && el.melt > 300 ? el.melt : (el.boil ? el.boil * 0.6 : 500);
  const e = 1.6 * K_B * melt;                                   // ~1.6 kT at melt
  return clamp(e, K_B * 90, K_B * 2600);
}
export function elementColor(el){
  const c = hexToRgb(el.cpk);
  if (el.cpk === null || el.cpk === undefined) return (BLK_FALLBACK[el.blk] || [0.6, 0.6, 0.7]).slice();
  return c;
}

/* ---------------- the chamber ---------------- */

export class Chamber {
  constructor(data, opts = {}){
    this.data = data;
    this.elByZ = new Map(data.map(e => [e.z, e]));
    this.size = opts.size || 2.4;                                  // box half-size nm
    this.atoms = [];
    this.bonds = [];                                             // {a,b,type,r0,k,dis}
    this.t = 0;                                                  // sim fs
    this.dt = opts.dt || 1.0;                                    // fs per substep (adjusted per frame)
    this.substeps = 1;
    this.T_target = Number.isFinite(opts.T) ? opts.T : 300;                               // thermostat setpoint K (null = off)
    this.T_cur = 300;
    this.heatPower = 0.0;                                        // 0..1 furnace
    this.beams = [this._newBeam('ray', 'y', 1, 0)];              // beam bank — up to several optical
    // beams along any of the six directions, each with its own optics.
    // `laser` / `laserOn` / `laserAxis` / … are legacy accessors that map
    // onto beams[0] so experiments, HUD and exports keep working.
    this.cross = { preset: null, ...(opts.cross || {}) };        // physicsSim-derived fields
    this.env = Object.assign({ g: 0, atm: 0 }, (opts.env || {})); // ambient environment (gravity, atmosphere)
    this.bio = Object.assign({ enabled: false }, (opts.bio || {})); // biology hook (hydrophobics, folding)
    this.events = [];                                            // HUD narration buffer
    this.rng = opts.rng || Math.random;
    this.alphaCounter = 0;
    this._grid = new Map();                                      // cell hashing
    this._cell = 0.6;
    this._maxId = 0;
    this.stepsTotal = 0;
    this.excitedCount = 0;
    this.reactionCount = 0;
    this.decayCount = 0;
    this._pruned = 0;
    this.shape = opts.shape || 'cube';
    this.wallInset = opts.wallInset ?? 0.12;              // skin-depth keeping atom bodies inside the cage
    this.sandMode = false;
    this.freq = 0;                                       // Hz audio driver (Chladni)
    this.mode = opts.mode || { m: 2, n: 2 };             // plate vibration mode (m,n)
    this.drive = 0;                                      // 0..1 plate drive
    this.platePhase = 0;
    this.sandOrder = 0;                                  // 0..1 how settled grains are onto nodes
    this.scopeMode = 'temp';                             // 'temp' | 'atom0x' | 'energy' | 'audio'
    this.scopeBuf = new Float32Array(1024);
    this.scopeN = 0;
    this.scopeSample = 0;
    this._scopePhase = 0;
    // machine fields: magnetic confinement, electric bias, input power
    this.B = opts.B || 0;                                // magnetic field strength
    this.E = opts.E || 0;                                // electric field strength
    this.power = opts.power || 0;                        // input power (heating)
    this.Baxis = opts.Baxis || 'y';                      // 'x' | 'y' | 'z' — Lorentz rotation plane
    this.Edir = opts.Edir || 'x';                        // electric field axis
    // timed feeder: slots {z, n, every(fs), start, next, inlet, enabled}
    this.feed = [];
    this.feedTotal = 0;
    this.feederOn = true;
    this.MAX_FEED = 2200;                            // soft cap: feeder stops at this many atoms
  }

  event(msg, kind = 'info'){
    this.events.push({ t: this.t, msg, kind });
    if (this.events.length > 24) this.events.shift();
  }

  setHeat(k, T){ this.heatPower = k; if (Number.isFinite(T)) this.T_target = T; }

  /* ----- optically-managed beam bank ----- */
  _newBeam(type = 'ray', axis = 'y', dir = 1, power = 0){
    return {
      type: type || 'ray', axis: (axis || 'y'), dir: dir >= 0 ? 1 : -1,
      power: clamp(power, 0, 1), spot: 0.16, rate: 10, grip: 0.5,
      phase: 0, on: false,
      d: null,                                           // optional unit direction [ux,uy,uz] — off-axis source mounts
      offx: 0, offy: 0, offz: 0,                         // traverse offset: parallel line raised off the mount axis
      wav: 532,                                          // spectral tuning: center wavelength nm (→ photon energy)
      delay: 0,                                          // pump-probe: phase delay as a fraction of the pulse period
      _hits: 0, _E: 0,                                   // far-mount detector flux deposited since last read
    };
  }

  beamAdd(type, opts = {}){
    const b = this._newBeam(type || 'ray', opts.axis || 'x', opts.dir ?? 1, opts.power ?? 0.45);
    if (opts.d) b.d = opts.d.slice();                    // an arbitrary source direction overrides the axis
    if (opts.wav) b.wav = clamp(opts.wav, 150, 2500);
    if (opts.delay) b.delay = clamp(opts.delay, 0, 1);
    b.on = opts.on !== false;
    this.beams.push(b);
    return this.beams.length - 1;
  }

  beamRemove(i){
    if (this.beams.length < 2) return false;
    const idx = clamp(i | 0, 0, this.beams.length - 1);
    this.beams.splice(idx, 1);
    return true;
  }

  resetBeams(){ this.beams = [this._newBeam('ray', 'y', 1, 0)]; }

  get laser(){ let p = 0; for (const b of this.beams){ if (b.on && b.power > p) p = b.power; } return p; }
  set laser(v){ this.beams[0].power = clamp(v, 0, 1); }
  get laserOn(){ return this.beams.some(b => b.on); }
  set laserOn(v){ this.beams[0].on = !!v; }
  get laserAxis(){ const b = this.beams[0]; return b.dir < 0 ? '-' + b.axis : b.axis; }
  set laserAxis(a){ const ax = String(a || 'y').replace(/^[-+]/, ''); this.beams[0].axis = ax || 'y'; this.beams[0].dir = /^-/.test(a) ? -1 : 1; }
  get laserType(){ return this.beams[0].type; }
  set laserType(t){ this.beams[0].type = t; }
  get laserSpot(){ return this.beams[0].spot; }
  set laserSpot(s){ this.beams[0].spot = clamp(s, 0.05, 0.5); }
  get laserRate(){ return this.beams[0].rate; }
  set laserRate(r){ this.beams[0].rate = Math.max(0.1, r); }
  get laserGrip(){ return this.beams[0].grip; }
  set laserGrip(g){ this.beams[0].grip = clamp(g, 0, 1); }

  reset(){ clearAtoms.call(this); }

  contains(x, y, z, tol = 1e-4){
    return shapeContains(this, x, y, z, tol);
  }

  /* ----- spawning ----- */
  randInShape(){
    const b = this.size * 0.6;
    for (let i = 0; i < 64; i++){
      const x = (2 * this.rng() - 1) * b;
      const y = (2 * this.rng() - 1) * b;
      const z = (2 * this.rng() - 1) * b;
      if (shapeContains(this, x, y, z)) return [x, y, z];
    }
    return shapeClampPoint(this, (2 * this.rng() - 1) * b, (2 * this.rng() - 1) * b, (2 * this.rng() - 1) * b);
  }

  spawn(z, opts = {}){
    const el = this.elByZ.get(z);
    if (!el) return null;
    const [sx, sy, sz] = opts.x != null ? [opts.x, opts.y ?? 0, opts.zz ?? 0] : this.randInShape();
    const a = {
      id: ++this._maxId, z, el,
      x: sx, y: sy, zz: sz,
      vx: opts.vx ?? (2 * this.rng() - 1) * 3e-4,
      vy: opts.vy ?? (2 * this.rng() - 1) * 3e-4,
      vz: opts.vz ?? (2 * this.rng() - 1) * 3e-4,
      fx: 0, fy: 0, fz: 0,
      m: opts.m || atomMass(el),
      r: opts.r || atomRadius(el),
      q: opts.q ?? 0,
      base: elementColor(el),
      color: elementColor(el),
      bonds: [], fixed: opts.fixed || false,
      excited: 0, glow: 0, decayL: 0, decayed: false, daughter: null,
      wallHit: 0,
      reacted: null, stateT: 0, ke: 0, temp: 300, released: 0,
      label: opts.label ?? '', cap: opts.cap ?? 4, spn: opts.spn ?? 0,
      hyd: opts.hyd ?? 0,
      frozen: !!(opts.fixed),
      trail: [],
      sand: false, localAmp: 0,
    };
    if (opts.temp) thermalize(a, opts.temp, this.rng);
    this.atoms.push(a);
    return a;
  }

  spawnWater(center, n, T){
    for (let i = 0; i < n; i++){
      const c = center || { x: this.rng(), y: this.rng(), zz: this.rng() };
      const ox = c.x + (this.rng() - 0.5) * 0.45;
      const oy = c.y + (this.rng() - 0.5) * 0.45;
      const oz = c.zz + (this.rng() - 0.5) * 0.45;
      const o = this.spawn(8, { x: ox, y: oy, zz: oz, temp: T });
      const ang = this.rng() * Math.PI * 2;
      const phi = this.rng() * Math.PI;
      const h1x = ox + 0.096 * Math.cos(ang) * Math.cos(phi);
      const h1y = oy + 0.096 * Math.sin(ang);
      const h1z = oz + 0.096 * Math.sin(phi);
      const h2x = ox + 0.096 * Math.cos(ang + (104.5 * Math.PI / 180)) * Math.cos(phi);
      const h2y = oy + 0.096 * Math.sin(ang + (104.5 * Math.PI / 180));
      const h2z = oz + 0.096 * Math.sin(phi);
      const h1 = this.spawn(1, { x: h1x, y: h1y, zz: h1z, temp: T });
      const h2 = this.spawn(1, { x: h2x, y: h2y, zz: h2z, temp: T });
      this.addBond(o, h1, { type: 'covalent', r0: 0.1 });
      this.addBond(o, h2, { type: 'covalent', r0: 0.1 });
    }
  }

  spawnGroup(z, count, opts = {}){
    const T = opts.T ?? this.T_target ?? 300;
    for (let i = 0; i < count; i++) this.spawn(z, { ...opts, temp: T });
    return count;
  }

  /* ----- timed feeder ----- */
  clearFeed(){ this.feed.length = 0; this.feedTotal = 0; }
  addFeed(o){
    const s = {
      z: o.z, n: o.n || 1, every: o.every || 5e5,
      start: o.start || 0, next: o.start || 0,
      inlet: !!o.inlet, q: o.q || 0,
      enabled: o.enabled !== false, label: o.label || '',
    };
    this.feed.push(s);
    return s;
  }
  feedNow(z, n = 1, inlet = false){
    const el = this.elByZ.get(z);
    if (!el) return 0;
    const cap = this.MAX_FEED - this.atoms.length;
    const cnt = Math.min(n, Math.max(0, cap));
    for (let i = 0; i < cnt; i++){
      if (inlet) this.spawnInlet(z);
      else this.spawn(z, { temp: this.T_target ?? 300 });
    }
    this.feedTotal += cnt;
    return cnt;
  }
  spawnInlet(z, opts = {}){
    const h = this.size;
    const ax = this.Edir === 'z' ? 'z' : 'x';
    let p, v;
    if (ax === 'z'){
      p = { x: (this.rng() - 0.5) * h * 0.4, y: (this.rng() - 0.5) * h * 0.4, zz: -h * 0.84 };
      v = { vx: (this.rng() - 0.5) * 0.002, vy: (this.rng() - 0.5) * 0.002, vz: 0.03 };
    } else {
      p = { x: -h * 0.84, y: (this.rng() - 0.5) * h * 0.4, zz: (this.rng() - 0.5) * h * 0.4 };
      v = { vx: 0.03, vy: (this.rng() - 0.5) * 0.002, vz: (this.rng() - 0.5) * 0.002 };
    }
    const [cx, cy, cz] = shapeInnerPoint(this, p.x, p.y, p.zz, this.wallInset + 0.1);
    const atom = this.spawn(z, { x: cx, y: cy, zz: cz, temp: opts.temp ?? this.T_target ?? 300, ...v, ...opts });
    if (atom) atom._inletFrom = { x: p.x, y: p.y, z: p.zz };   // visual entry point for the 3D fly-in
    return atom;
  }

  spawnSand(n){
    const z = (this.elByZ.get(14) || this.elByZ.get(6) || this.elByZ.get(8)).z;
    for (let i = 0; i < n; i++){
      const a = this.spawn(z, { r: 0.028, cap: 0, temp: 300 });
      a.sand = true;
      a.base = '#d8b46a';                                  // fine quartz-sand tint (rendered as flattened grains)
      a.color = a.base;
      a.x = (2 * this.rng() - 1) * this.size * 0.9;
      a.y = this.size * 0.18;
      a.zz = (2 * this.rng() - 1) * this.size * 0.9;
      a.vx = a.vy = a.vz = 0;
      a.fixed = false;
    }
    return n;
  }

  addBond(a, b, opts = {}){
    if (a.bonds.length >= a.cap || b.bonds.length >= b.cap) return null;
    if (!opts.free && this.bonds.some(bd => (bd.a === a && bd.b === b) || (bd.a === b && bd.b === a))) return null;
    const r0 = opts.r0 || ((a.r + b.r) * 0.92);
    const type = opts.type || bondType(a.el, b.el);
    const k = opts.k ?? (type === 'ionic' ? 0.5 : type === 'metal' ? 0.28 : 0.16);
    const dis = opts.dis ?? (type === 'ionic' ? 0.9 : type === 'metal' ? 0.5 : 0.55);
    const bd = { a, b, type, r0, k, dis, meltT: opts.meltT || null, age: 0 };
    this.bonds.push(bd);
    a.bonds.push(bd); b.bonds.push(bd);
    return bd;
  }

  removeBond(bd){
    const i = this.bonds.indexOf(bd);
    if (i >= 0) this.bonds.splice(i, 1);
    const ia = bd.a.bonds.indexOf(bd); if (ia >= 0) bd.a.bonds.splice(ia, 1);
    const ib = bd.b.bonds.indexOf(bd); if (ib >= 0) bd.b.bonds.splice(ib, 1);
  }

  clearAtoms(){ this.atoms.length = 0; this.bonds.length = 0; this.events.length = 0; this.stepsTotal = 0; }

  /* ----- time control ----- */
  setRate(fsPerFrame){
    // choose substeps & substep dt from requested femtoseconds per frame
    const fs = Math.max(DT_MIN, Math.min(1e36, fsPerFrame));
    if (fs > MAX_SUBSTEPS * DT_MAX){
      // deep-macro band: deliver the requested sim time as ONE macro substep
      // (coarse PBD + renormalized thermo, dt-scaled and rate-consistent) so a
      // 1 s-or-larger tick advances fully every frame at the same realtime cost
      // as any other rate — no 140-step ceiling silently capping the speed.
      this.substeps = 1;
      this.dt = fs;
      return { steps: 1, dt: this.dt, fsPerFrame: this.dt };
    }
    let steps = Math.ceil(fs / DT_MAX);
    if (steps < 1) steps = 1;
    const dt = fs / steps;
    this.substeps = steps;
    this.dt = clamp(dt, DT_MIN, DT_MAX);
    return { steps, dt: this.dt, fsPerFrame: steps * this.dt };
  }

  /* ----- frame ----------------------------------------------------- */
  advance(realMs = 16.7){
    // returns actual femtoseconds advanced this frame
    if (!this._frameConfig) this._frameConfig = { steps: 1, dt: 1 };
    const { steps } = this._frameConfig;
    let advanced = 0;
    for (let s = 0; s < steps; s++){
      this._substep();
      this.t += this.dt;
      advanced += this.dt;
    }
    this.stepsTotal += steps;
    // tube machines circulate their contents along the winding once per frame
    if (this.shape === 'torus' || isKnotShape(this.shape)) applyHelicalFlow.call(this, realMs);
    feedStep.call(this);
    this.refresh();
    // wall-clock pass: Chladni sand migration + oscilloscope sampling
    if (this.sandMode){
      let s = 0, cnt = 0;
      for (const a of this.atoms){
        if (!a.sand) continue;
        chladniGrainStep.call(this, a, realMs);
        s += 1 - Math.abs(plateWave(this, a.x, a.zz));
        cnt++;
      }
      this.sandOrder = cnt ? s / cnt : 0;
    }
    advanceScope.call(this, realMs);
    return advanced;
  }

  _substep(){
    const atoms = this.atoms, bonds = this.bonds, dt = this.dt, h = this.size;
    const cross = this.cross;
    const T = this.T_target;
    const COARSE = dt > 4.5;   // macro fast-forward: rigid bonds via PBD, no spring integration
    if (COARSE) for (const a of atoms){ a.px0 = a.x; a.py0 = a.y; a.pz0 = a.zz; }

    // cell hash (sand grains are visual + nodal-flow only, not force carriers)
    this._grid.clear();
    const cell = this._cell;
    for (const a of atoms){
      if (a.sand) continue;
      const kx = Math.floor(a.x / cell), ky = Math.floor(a.y / cell), kz = Math.floor(a.zz / cell);
      const key = ((kx & 4095) << 24) | ((ky & 4095) << 12) | (kz & 4095);   // packed int: no string-churn in Map
      let arr = this._grid.get(key);
      if (!arr){ arr = []; this._grid.set(key, arr); }
      arr.push(a);
    }

    // pair forces: LJ + coulomb (sand excluded — grid omits them).
    // Each unordered pair is handled by whichever atom carries the higher id,
    // so no cross-pair dedup set is needed (avoids a large per-substep
    // allocation that stalled the frame at moderate fill levels).
    for (const a of atoms){
      if (a.sand) continue;
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell), cz = Math.floor(a.zz / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++){
        const arr = this._grid.get((((cx + dx) & 4095) << 24) | (((cy + dy) & 4095) << 12) | ((cz + dz) & 4095));
        if (!arr) continue;
        for (const b of arr){
          if (b.id >= a.id) continue;   // b === a is excluded too (ids unique)
          pairForce.call(this, a, b);
        }
      }
    }

    // bonds as soft springs (fine regime only; coarse uses PBD below)
    if (!COARSE){
      for (const bd of bonds){
        const a = bd.a, b = bd.b;
        const ddx = b.x - a.x, ddy = b.y - a.y, ddz = b.zz - a.zz;
        let d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > 1e-10){
          const d = Math.sqrt(d2);
          const f = bd.k * (d - bd.r0);
          const e = f / d;
          const fx = ddx * e, fy = ddy * e, fz = ddz * e;
          a.fx += fx; a.fy += fy; a.fz += fz;
          b.fx -= fx; b.fy -= fy; b.fz -= fz;
          const dvx = b.vx - a.vx, dvy = b.vy - a.vy, dvz = b.vz - a.vz;
          const damp = 0.02;
          a.fx += dvx * damp; a.fy += dvy * damp; a.fz += dvz * damp;
          b.fx -= dvx * damp; b.fy -= dvy * damp; b.fz -= dvz * damp;
          bd.pe = 0.5 * bd.k * (d - bd.r0) * (d - bd.r0);
        }
      }
    }

    // cross-lab fields
    if (cross && cross.enabled){
      applyCrossFields.call(this, dt);
    }

    // machine fields: B (confinement) / E (bias) / power (heating)
    if (this.B || this.E || this.power){
      applyMachineFields.call(this, dt);
    }

    // ambient environment: gravity pulls downward, atmosphere adds drag
    const ENV = this.env;
    if (ENV && (ENV.g || ENV.atm)){
      if (ENV.g){ const G = 9.8e-6 * ENV.g * 4e3; for (const a of atoms){ if (!a.fixed && !a.sand) a.fy -= G * a.m * 0.02; } }
      if (ENV.atm > 0){
        const dr = Math.min(0.25, ENV.atm * 3.5e-4 * dt);
        if (dr > 0) for (const a of atoms){ if (!a.fixed && !a.sand){ a.vx *= (1 - dr); a.vy *= (1 - dr); a.vz *= (1 - dr); } }
      }
    }

    // biology: hydrophobic collapse / polar solvation for folding experiments
    if (this.bio && this.bio.enabled){
      applyBioForces.call(this, dt);
    }

    // integrate + thermostat + walls + decay/excite hooks
    const setT = T != null ? T : (this.T_target);
    this._kinSum = 0;
    for (const a of atoms){
      if (a.sand){ a.fx = a.fy = a.fz = 0; a.ke = 0; a.temp = 300 + (a.localAmp || 0) * 2000; continue; }
      if (a.fixed){
        a.fx = a.fy = a.fz = 0;
        a.vx = a.vy = a.vz = 0;
        a.ke = 0;
        continue;
      }
      if (a.wallHit > 0) a.wallHit *= 0.8;                 // impact flash decays over a few substeps
      // walls: geometry-aware soft confinement along the outward normal
      const [cx, cy, cz] = shapeClampPoint(this, a.x, a.y, a.zz);
      const nx = a.x - cx, ny = a.y - cy, nz = a.zz - cz;
      const nd = Math.hypot(nx, ny, nz);
      if (nd > 1e-9){
        // wall stiffness is scaled by substep width so the soft shell never
        // saturates the per-step force clamp at fine rates (which injected a
        // fixed Δv≈4e-3 every step and heated slow speeds to the cap)
        const k = Math.min(nd, 0.25) * 26 * clamp(dt / 4, 0, 1);
        const s = k / nd;
        a.fx += nx * s; a.fy += ny * s; a.fz += nz * s;
        const vr = (a.vx * nx + a.vy * ny + a.vz * nz) / nd;
        if (vr > 0){
          a.vx -= 1.0 * vr * nx / nd; a.vy -= 1.0 * vr * ny / nd; a.vz -= 1.0 * vr * nz / nd;
          a.wallHit = 1;
        }
      }

      // integrate (force-clamped for stability)
      const fmax = a.m * 4e-3 / dt * clamp(dt / 4, 0.25, 1);
      const fl = Math.hypot(a.fx, a.fy, a.fz);
      if (fl > fmax && fl > 0){ const s = fmax / fl; a.fx *= s; a.fy *= s; a.fz *= s; }
      a.vx += a.fx / a.m * dt; a.vy += a.fy / a.m * dt; a.vz += a.fz / a.m * dt;
      const sp2 = a.vx * a.vx + a.vy * a.vy + a.vz * a.vz;
      const VMAX = 0.09;
      if (sp2 > VMAX * VMAX){ const s = VMAX / Math.sqrt(sp2); a.vx *= s; a.vy *= s; a.vz *= s; }
      a.x += a.vx * dt; a.y += a.vy * dt; a.zz += a.vz * dt;
      // inner skin clamp: sphere bodies must stay fully inside the inner cage
      const mIn = this.wallInset + a.r;
      const [ix, iy, iz] = shapeInnerPoint(this, a.x, a.y, a.zz, mIn);
      const sdx = ix - a.x, sdy = iy - a.y, sdz = iz - a.zz;
      const strike = Math.hypot(sdx, sdy, sdz);
      if (strike > 0.02) a.wallHit = 1;
      a.x = ix; a.y = iy; a.zz = iz;
      const ke = 0.5 * a.m * sp2;
      a.ke = ke;
      this._kinSum += ke;
      // decay timers
      if (a.decayL > 0) a.decayL -= dt;
      if (a.excited > 0) a.excited -= dt;
      if (a.glow > 0) a.glow -= dt * 0.06;
      a.trail = null;
    }

    // PBD rigid-bond solve for coarse regime, then derive velocities
    if (COARSE){
      for (let it = 0; it < 3; it++){
        for (const bd of bonds){
          const a = bd.a, b = bd.b;
          if (a.fixed && b.fixed) continue;
          const ddx = b.x - a.x, ddy = b.y - a.y, ddz = b.zz - a.zz;
          const d = Math.hypot(ddx, ddy, ddz) || 1e-9;
          const corr = (d - bd.r0) / d;
          const ka = a.fixed ? 0 : 0.5, kb = b.fixed ? 0 : 0.5;
          const ix = ddx * corr * ka, iy = ddy * corr * ka, iz = ddz * corr * ka;
          if (!a.fixed){ a.x += ix; a.y += iy; a.zz += iz; }
          if (!b.fixed){ b.x -= ix; b.y -= iy; b.zz -= iz; }
        }
      }
      // hard cage: coarse steps are far too large for soft walls to hold
      for (const a of atoms){
        if (a.fixed || a.sand) continue;
        const mIn = this.wallInset + a.r;
        const [cx, cy, cz] = shapeInnerPoint(this, a.x, a.y, a.zz, mIn);
        const move = Math.hypot(cx - a.x, cy - a.y, cz - a.zz);
        if (move > 0.02) a.wallHit = 1;
        a.x = cx; a.y = cy; a.zz = cz;
      }
      for (const a of atoms){
        if (a.fixed) continue;
        a.vx = ((a.x - a.px0) / dt) * 0.62;
        a.vy = ((a.y - a.py0) / dt) * 0.62;
        a.vz = ((a.zz - a.pz0) / dt) * 0.62;
        const fr = Math.max(0.7, 1 - dt * 4e-5);
        a.vx *= fr; a.vy *= fr; a.vz *= fr;
        // macro mode: renormalize derived motion to the commanded thermal speed
        // so the temperature readout reflects the furnace/thermostat setting
        const vt = (T != null) ? Math.sqrt(3 * K_B * T / a.m) : 0;
        if (vt > 0){
          const sp = Math.hypot(a.vx, a.vy, a.vz);
          const spread = (1 + (this.rng() - 0.5) * 0.5) * 1.15;
          const want = vt * spread;
          if (sp > 1e-12){ const k = want / sp; a.vx *= k; a.vy *= k; a.vz *= k; }
          else {
            const th = this.rng() * Math.PI * 2, ph = Math.acos(2 * this.rng() - 1);
            a.vx = want * Math.sin(ph) * Math.cos(th);
            a.vy = want * Math.cos(ph);
            a.vz = want * Math.sin(ph) * Math.sin(th);
          }
        }
      }
      this._kinSum = 0;
      for (const a of atoms){ a.ke = 0.5 * a.m * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz); this._kinSum += a.ke; }
    }

    // thermostat (dt-scaled exponential relaxation toward setpoint)
    const n = atoms.length;
    if (n > 0 && this.T_target != null){
      const Tcur = this._kinSum * 2 / (3 * K_B * n);
      this.T_cur = Tcur;
      const tau = this.heatPower > 0 ? 1.8e6 : 9e6;              // fs relaxation
      const frac = dt / tau;
      const scale = Math.exp(-frac);
      const mean = this.T_target * (1 - scale) + Tcur * scale;
      const lam = clamp(Math.sqrt(mean / (Tcur || 1)), 0.88, 1.45);
      for (const a of atoms){
        if (a.fixed) continue;
        a.vx *= lam; a.vy *= lam; a.vz *= lam;
      }
      this.T_cur = this._kinSum * lam * lam * 2 / (3 * K_B * n);
    }

    // thermal bond breaking: bonds unzip when kT beats their melt-derived strength
    if (this.T_cur && this.T_cur > 0){
      const Tcur = this.T_cur;
      for (let i = this.bonds.length - 1; i >= 0; i--){
        const bd = this.bonds[i];
        const mAl = bd.a.el.melt || bd.a.el.boil * 0.6 || 1500;
        const mBl = bd.b.el.melt || bd.b.el.boil * 0.6 || 1500;
        const tf = bd.type === 'ionic' ? 3 : bd.type === 'metal' ? 1.4 : 1.15;
        const breakT = bd.meltT || Math.sqrt(mAl * mBl) * tf;
        if (Tcur <= breakT) continue;
        const P = ((Tcur - breakT) / (breakT * 8)) * Math.min(1, dt / 400) * 0.5;
        if (this.rng() < clamp(P, 0, 0.85)){
          const lib = `<${bd.a.el.s}–${bd.b.el.s}>`;
          this.removeBond(bd);
          this.event(`${lib} bond broken at ${Tcur.toFixed(0)} K`, 'break');
        }
      }
    }

    // decay
    if (this.cross.decayBoost || this.laser > 0.85 || true) decayStep.call(this, dt);
    // excitation emission
    if (this.laser > 0){ exciteStep.call(this, dt); }
    // laser module: beam bank — each armed beam acts independently, so
    // multiple beams from different directions stack like a real rig
    for (const b of this.beams){
      if (b.on && b.power > 0.005) laserStep.call(this, dt, b);
    }
    // water reactivity
    waterReactStep.call(this, dt);
    // bond life updates
    for (const bd of bonds){ bd.age += dt; }
  }

  refresh(){
    // classify phases + build readouts + prune exploded atoms
    const n = this.atoms.length;
    let keep = 0;
    let tempSum = 0;
    this.excitedCount = 0; this.reactionCount = 0; this.decayCount = 0;
    const out = [];
    for (const a of this.atoms){
      const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
      if (!Number.isFinite(a.x + a.y + a.zz)){
        this._pruned++;
        continue;                               // prune only corrupt atoms
      }
      const sp2 = a.vx * a.vx + a.vy * a.vy + a.vz * a.vz;
      a.temp = sp2 * a.m / (3 * K_B);          // kinetic temperature from LIVE velocity
      if (a.temp > a.el.melt * 1.25) a.released = 1;   // melted latch (melt ladder stays ordered)
      tempSum += a.temp;
      a.stateT = phaseOf(a, this);
      if (a.excited > 0) this.excitedCount++;
      if (a.reacted) this.reactionCount++;
      if (a.decayed) this.decayCount++;
      out.push(a);
      keep++;
    }
    this.atoms.length = 0;
    for (const a of out) this.atoms.push(a);
    for (let i = 0; i < this.bonds.length;){
      const bd = this.bonds[i];
      if (!out.includes(bd.a) || !out.includes(bd.b)){
        this.bonds.splice(i, 1);
        const ia = bd.a.bonds.indexOf(bd); if (ia >= 0) bd.a.bonds.splice(ia, 1);
        const ib = bd.b.bonds.indexOf(bd); if (ib >= 0) bd.b.bonds.splice(ib, 1);
        continue;
      }
      i++;
    }
    if (n > 0) this.T_cur = tempSum / n; else this.T_cur = 0;
  }

  // ----- chemistry / formation -----
  canFormMore(a){ return a.bonds.length < a.cap; }
}

/* ----- pure helpers used above ----- */

function thermalize(a, T, rng){
  const s = Math.sqrt(3 * K_B * T / a.m);
  a.vx = (2 * rng() - 1) * s * 0.9;
  a.vy = (2 * rng() - 1) * s * 0.9;
  a.vz = (2 * rng() - 1) * s * 0.9;
}

export function bondType(ea, eb){
  if (isNoble(ea) || isNoble(eb)) return 'vdw';
  const metal = isMetal(ea), metal2 = isMetal(eb);
  const dEN = Math.abs(ea.en - eb.en);
  if (metal && metal2) return 'metal';
  if (metal !== metal2 && dEN >= 1.5 && (isHalogen(ea) || isHalogen(eb))) return 'ionic';
  if (metal && dEN >= 1.5) return 'ionic';
  if (metal2 && dEN >= 1.5) return 'ionic';
  if (!metal && !metal2) return 'covalent';
  // metal + nonmetal but small EN difference (semiconductors)
  return 'covalent';
}

function canBond(a, b){
  const t = bondType(a.el, b.el);
  if (t === 'vdw') return false;                       // noble gases never bond here
  if (!this.canFormMore(a) || !this.canFormMore(b)) return false;
  if (a.el.z === b.el.z && t === 'covalent') return false;  // no homonuclear bond for display clarity EXCEPT diatomic? allow H2: keep diatomic
  return true;
}

function pairForce(a, b){
  const ddx = b.x - a.x, ddy = b.y - a.y, ddz = b.zz - a.zz;
  const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
  const COARSE = this.dt > 4.5;
  const sig = (a.r + b.r) * 0.5 * 0.92;
  if (d2 > sig * sig * 9) return;
  const d = Math.sqrt(d2);
  // coincident atoms (hard-cage wall corners pin pairs to identical points) — nudge apart, no force
  if (d < 1e-6){
    const nx = this.rng() - 0.5 || 0.1, ny = this.rng() - 0.5 || 0.1, nz = this.rng() - 0.5 || 0.1;
    const l = Math.hypot(nx, ny, nz) || 1, s = 5e-4;
    if (!a.fixed){ a.x += nx / l * s; a.y += ny / l * s; a.zz += nz / l * s; }
    if (!b.fixed){ b.x -= nx / l * s; b.y -= ny / l * s; b.zz -= nz / l * s; }
    return;
  }
  let f = 0;
  if (COARSE){
    // macro mode: soft incompressible overlap only — no LJ well (avoids energy pump)
    if (d < sig * 0.85){
      f = (sig * 0.85 - d) * (30 / Math.max(1, this.dt / 2));
    }
  } else {
    // fine regime: resolved LJ. Deep overlap is constrained as a hard-core
    // push (positional) instead of firing the LJ singularity — the perceived
    // core force clips at fmax and injects spurious heat at small dt.
    const dCore = sig * 0.5;
    if (d < dCore){
      const push = (dCore - d) * 0.28;
      const ex = ddx / d, ey = ddy / d, ez = ddz / d;
      if (!a.fixed){ a.x -= ex * push; a.y -= ey * push; a.zz -= ez * push; }
      if (!b.fixed){ b.x += ex * push; b.y += ey * push; b.zz += ez * push; }
    } else {
      const epsAB = Math.sqrt(eps(a.el) * eps(b.el));
      const sr = sig / d;
      const sr6 = sr * sr * sr * sr * sr * sr;
      const sr12 = sr6 * sr6;
      f = 24 * epsAB / d * (2 * sr12 - sr6);
      if (a.q && b.q) f -= (a.q * b.q) * 0.9 / (d * d);
    }
  }
  if (f){
    const ex = ddx / d, ey = ddy / d, ez = ddz / d;
    a.fx += ex * f; a.fy += ey * f; a.fz += ez * f;
    b.fx -= ex * f; b.fy -= ey * f; b.fz -= ez * f;
  }

  // bond formation attempt (fine & coarse alike — real chemistry still happens on contact)
  if (d < sig * 2.6 && !a.fixed && !b.fixed){
    const t = bondType(a.el, b.el);
    const want = t === 'covalent' ? sig * 1.32 : sig * 1.55;
    const within = COARSE ? d < want * 2.1 : d < want;
    // coarse: atoms alias past each other in one step -> probabilistic capture
    const rolled = COARSE
      ? this.rng() < clamp((want * 2.2 / Math.max(d, sig * 0.05)) * 0.9, 0, 1)
      : true;
    if (within && rolled && canBond.call(this, a, b) && !this.bonds.some(bd => (bd.a === a && bd.b === b) || (bd.a === b && bd.b === a))){
      if (t === 'ionic'){
        const bd = this.addBond(a, b, { type: 'ionic' });
        if (bd){ a.q = (isMetal(a.el) ? 1 : -1) * Math.sign(a.el.en - b.el.en || 1); b.q = -a.q; a.reacted = 'ionized'; b.reacted = 'ionized'; this.event(`${a.el.s}⇄${b.el.s} ionic bond formed`, 'bond'); }
      } else if (t === 'covalent'){
        const bd = this.addBond(a, b, { type: 'covalent' });
        if (bd) this.event(`${a.el.s}–${b.el.s} bond formed`, 'bond');
      } else if (t === 'metal'){
        this.addBond(a, b, { type: 'metal', r0: sig * 1.05 });
      }
    }
  }
}

/* ----- machine fields: magnetic confinement / electric bias / power ----- */
function applyMachineFields(dt){
  const B = this.B, E = this.E, pwr = this.power;
  const atoms = this.atoms;
  if (B){
    // Lorentz: F = q · cB · (v × B̂) — gyration about the chosen axis
    const cB = 8e-3;
    const ax = this.Baxis === 'z' ? 'z' : this.Baxis === 'x' ? 'x' : 'y';
    for (const a of atoms){
      if (a.fixed || a.sand || !a.q) continue;
      const k = a.q * cB * B;
      if (ax === 'y'){ a.fx += k * a.vz; a.fz -= k * a.vx; }
      else if (ax === 'z'){ a.fx += k * a.vy; a.fy -= k * a.vx; }
      else { a.fy += k * a.vz; a.fz -= k * a.vy; }
    }
  }
  if (E){
    // Coulomb: F = q · cE · Ê — charged drift along the field axis
    const cE = 6e-4;
    const ex = this.Edir === 'z' ? 0 : this.Edir === 'y' ? 0 : 1;
    const ey = this.Edir === 'y' ? 1 : 0;
    const ez = this.Edir === 'z' ? 1 : 0;
    for (const a of atoms){
      if (a.fixed || a.sand || !a.q) continue;
      const k = a.q * cE * E;
      a.fx += k * ex; a.fy += k * ey; a.fz += k * ez;
    }
  }
  if (pwr){
    // input power: stochastic plasma heating + furnace equivalent.
    // probability per substep is scaled by dt so the kick rate (per fs) is
    // independent of playback speed — ½ fs must not heat thousands of × harder.
    // It tapers as the plasma approaches ~3× the furnace setpoint so RF power
    // sustains the operating temperature instead of running away to the cap,
    // keeping fine and coarse speeds on the same temperature profile.
    const rate = Math.min(1, pwr * 0.5);          // expected kicks per fs at 0 K
    let taper = 1;
    if (this.T_target != null && this.heatPower > 0){
      const op = Math.max(this.T_target * 3, 2000);
      taper = clamp(1 - this.T_cur / op, 0, 1);
    }
    const p = Math.min(1, rate * dt * taper);
    for (const a of atoms){
      if (a.fixed || a.sand) continue;
      if (this.rng() < p){
        a.vx += (this.rng() - 0.5) * 6e-4;
        a.vy += (this.rng() - 0.5) * 6e-4;
        a.vz += (this.rng() - 0.5) * 6e-4;
        a.wallHit = Math.max(a.wallHit, 0.05);     // faint glow so radio-frequency heating is visible
      }
    }
    if (pwr > this.heatPower) this.heatPower = Math.min(1, pwr * 0.8);
  }
}

/* ----- helical streaming: tube machines (twist / rose / crown / spire / torus)
   A steady circulation along the winding, refreshed once per frame (NOT per
   substep) so the visible current is the same at every playback speed. Real
   stellarators confine with a torsioned field; here the machine's structure
   itself carries atoms around the whole loop so the chamber scan shows the
   plasma threading *all* of the twist's geometry instead of pooling in one
   segment of the knot. Bonded clusters move almost as a unit (they drag less),
   and charged ions stream a little faster than neutrals. */
function applyHelicalFlow(frameMs){
  const adv = 0.038 * clamp((frameMs || 16.7) / 16.7, 0.25, 2);   // nm of tube travel per frame
  for (const a of this.atoms){
    if (a.fixed || a.sand) continue;
    if (a.bonds && a.bonds.length > 4) continue;                  // huge aggregates settle, not stream
    const d = tubeFlowDir(this, a.x, a.y, a.zz);
    if (!d) continue;
    let k = adv;
    if (a.bonds && a.bonds.length) k *= Math.max(0.4, 1 - 0.09 * a.bonds.length);
    if (a.q) k *= 1.35;
    a.x += d.fx * k; a.y += d.fy * k; a.zz += d.fz * k;
    a.vx += d.fx * k * 0.08; a.vy += d.fy * k * 0.08; a.vz += d.fz * k * 0.08;   // velocity echo: kinetic readout stays coherent
  }
}

// unit tangent of the tube centerline nearest the point (for knot + torus shapes)
function tubeFlowDir(ch, x, y, z){
  const s = ch.shape || 'cube';
  if (s === 'torus'){
    const rho = Math.hypot(x, z) || 1e-9;
    return { fx: -z / rho, fy: 0, fz: x / rho };
  }
  const kp = isKnotShape(s) ? knotParams(s) : null;
  if (!kp) return null;
  const t = knotNearestT(x, y, z, ch.size, kp.P, kp.Q);
  const e = 2e-3;
  const c0 = torusKnotPointC(t - e, ch.size, undefined, kp.P, kp.Q);
  const c1 = torusKnotPointC(t + e, ch.size, undefined, kp.P, kp.Q);
  const dx = c1[0] - c0[0], dy = c1[1] - c0[1], dz = c1[2] - c0[2];
  const l = Math.hypot(dx, dy, dz) || 1e-9;
  return { fx: dx / l, fy: dy / l, fz: dz / l };
}

/* ----- timed feeder ----- */
function feedStep(){
  if (!this.feederOn || this.feed.length === 0) return;
  if (this.atoms.length >= this.MAX_FEED) return;
  for (const s of this.feed){
    if (!s.enabled || s.z == null) continue;
    if (this.t < s.start || this.t < s.next) continue;
    s.next = Math.max(this.t + s.every, s.next + s.every);
    if (this.atoms.length >= this.MAX_FEED) break;
    const n = Math.min(s.n, this.MAX_FEED - this.atoms.length);
    for (let i = 0; i < n; i++){
      if (s.inlet) this.spawnInlet(s.z, { q: s.q || 0 });
      else this.spawn(s.z, { temp: this.T_target ?? 300, q: s.q || 0 });
    }
    this.feedTotal += n;
    const el = this.elByZ.get(s.z);
    this.event(`⇢ feeder ${n}×${el ? el.s : '?'} +${this.feedTotal} total`, s.inlet ? 'react' : 'info');
  }
}

/* ----- biology: hydrophobic collapse + polar solvation -----
   Atoms carry `hyd` (+1 hydrophobic / −1 polar). Same-sign hydrophobic groups
   attract across the chain → globular folding; polar↔nonpolar pairs repel so
   polar side-chains stay at the surface, mimicking an aqueous environment. */
function applyBioForces(dt){
  const atoms = this.atoms;
  const cell = this._cell;
  const bio = this.bio;
  const fsc = clamp(dt / 4, 0.25, 1);
  const kA = (bio.kA ?? 3.2e-5) * fsc;     // hydrophobic attraction
  const kR = (bio.kR ?? 1.4e-5) * fsc;     // solvation repulsion
  let seen = false;
  for (const a of atoms){ if (a.hyd){ seen = true; break; } }
  if (!seen) return;
  const rh = bio.range ?? 0.55;            // hydrophobic interaction cutoff
  for (const a of atoms){
    if (a.sand || (a.hyd | 0) === 0) continue;
    const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell), cz = Math.floor(a.zz / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++){
      const arr = this._grid.get((((cx + dx) & 4095) << 24) | (((cy + dy) & 4095) << 12) | ((cz + dz) & 4095));
      if (!arr) continue;
      for (const b of arr){
        if (b.id >= a.id) continue;
        const hb = (b.hyd | 0);
        if (hb === 0 || b.sand) continue;
        const ddx = b.x - a.x, ddy = b.y - a.y, ddz = b.zz - a.zz;
        let d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > rh * rh) continue;
        if (d2 < 1e-4) d2 = 1e-4;
        const d = Math.sqrt(d2);
        const sameHydro = a.hyd > 0 && hb > 0;
        const scale = sameHydro
          ? kA * (1 - d / rh) * clamp((d - 0.12) / 0.2, 0, 1)     // attraction, fades near contact
          : -kR * clamp(1 - d / 0.22, 0, 1);                      // solvation: keep apart
        if (scale === 0) continue;
        const e = scale / d;
        const fx = ddx * e, fy = ddy * e, fz = ddz * e;
        a.fx += fx; a.fy += fy; a.fz += fz;
        b.fx -= fx; b.fy -= fy; b.fz -= fz;
      }
    }
  }
}

function applyCrossFields(dt){
  const c = this.cross;
  const atoms = this.atoms;
  const N = atoms.length;
  const g = 9.8e-6 * (c.gravity || 0) * 4e3;
  if (g) for (const a of atoms){ if (!a.fixed) a.fy += g * a.m * 0.02; }
  if (c.darkEnergy) for (const a of atoms){ a.fx += a.x * c.darkEnergy * 3e-7; a.fy += a.y * c.darkEnergy * 3e-7; a.fz += a.zz * c.darkEnergy * 3e-7; }
  if (c.curvature) {
    for (let i = 0; i < N; i++){
      const a = atoms[i];
      const ang = (i % 89) * GOLD + this.t * c.curvature * 2e-5;
      const r0 = Math.sqrt(a.x * a.x + a.zz * a.zz);
      a.fx += Math.cos(ang) * c.curvature * 2e-7 - (a.x) * c.curvature * 3e-7;
      a.fz += Math.sin(ang) * c.curvature * 2e-7 - (a.zz) * c.curvature * 3e-7;
      a.fy += Math.sin(ang * 3) * c.curvature * 8e-8;
    }
  }
  if (c.inflation) { const g = c.inflation * 2e-5 * dt; for (const a of atoms){ const s = Math.exp(g); a.vx *= s; a.vy *= s; a.vz *= s; } }
  if (c.lattice && N){
    // tether each atom to its spiral node -> crystalline web
    const Sp = 1.15, cl = this.size * 0.5;
    for (let i = 0; i < N; i++){
      const a = atoms[i];
      const t = i / (N - 1 || 1);
      const ang = t * GOLD * 12;
      const rr = Sp * Math.sqrt(i + 1) * 0.28;
      const hx = Math.cos(ang) * rr, hz = Math.sin(ang) * rr;
      const hy = (t - 0.5) * cl;
      a.fx += (hx - a.x) * c.lattice * 3.2e-4;
      a.fy += (hy - a.y) * c.lattice * 3.2e-4;
      a.fz += (hz - a.zz) * c.lattice * 3.2e-4;
    }
  }
  if (c.alignment && N > 1){
    const vmx = new Float64Array(N), vmy = new Float64Array(N), vmz = new Float64Array(N);
    const cnt = new Int32Array(N);
    for (let i = 0; i < N; i++){
      const a = atoms[i];
      const kx = Math.floor(a.x / this._cell), ky = Math.floor(a.y / this._cell), kz = Math.floor(a.zz / this._cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++){
        const arr = this._grid.get((((kx + dx) & 4095) << 24) | (((ky + dy) & 4095) << 12) | ((kz + dz) & 4095));
        if (!arr) continue;
        for (const b of arr){
          if (b === a) continue;
          vmx[i] += b.vx; vmy[i] += b.vy; vmz[i] += b.vz; cnt[i]++;
        }
      }
      if (cnt[i]){
        const s = c.alignment * 1.6e-3;
        a.fx += (vmx[i] / cnt[i] - a.vx) * s;
        a.fy += (vmy[i] / cnt[i] - a.vy) * s;
        a.fz += (vmz[i] / cnt[i] - a.vz) * s;
      }
    }
  }
  if (c.quantum) for (const a of atoms){ a.fx += (this.rng() - 0.5) * c.quantum * 9e-5; a.fy += (this.rng() - 0.5) * c.quantum * 9e-5; a.fz += (this.rng() - 0.5) * c.quantum * 9e-5; }
  if (c.tunnel){
    for (const a of atoms){
      if (this.rng() < c.tunnel * 2.2e-4){
        a.x += (this.rng() - 0.5) * 0.6; a.y += (this.rng() - 0.5) * 0.6; a.zz += (this.rng() - 0.5) * 0.6;
        a.glow = 30;
      }
    }
  }
  if (c.entangle && N > 1){
    for (let i = 0; i < N; i += 2){
      const a = atoms[i], b = atoms[(i + 1) % N];
      const k = c.entangle * 6e-6;
      a.fx += (b.vx - a.vx) * k; a.fy += (b.vy - a.vy) * k; a.fz += (b.vz - a.vz) * k;
      b.fx += (a.vx - b.vx) * k; b.fy += (a.vy - b.vy) * k; b.fz += (a.vz - b.vz) * k;
    }
  }
  if (c.planckJitter) for (const a of atoms){ a.x += (this.rng() - 0.5) * c.planckJitter * 2e-4; a.y += (this.rng() - 0.5) * c.planckJitter * 2e-4; a.zz += (this.rng() - 0.5) * c.planckJitter * 2e-4; }
}

function decayStep(dt){
  const atoms = this.atoms;
  const boost = (this.cross.decayBoost || 0) + 1;
  for (const a of atoms){
    if (a.fixed || a.decayed) continue;
    const z = a.z;
    const unstable = z >= 84 || a.el.cat === 'Actinide' || (this.cross.decayBoost && z >= 43);
    if (!unstable) continue;
    // accelerated half-life: ~6 ps sim time (visualization scale), scaled by decayBoost
    const halfLife = 6e3 / boost;
    const p = 1 - Math.pow(0.5, dt / halfLife);
    if (this.rng() < p){
      decayAtom.call(this, a);
    }
  }
}
function decayAtom(a){
  const dz = Math.max(1, a.z - 2);
  const dEl = this.elByZ.get(dz);
  // alpha particle
  const ai = this.spawn(2, {
    x: a.x + (this.rng() - 0.5) * 0.1, y: a.y + (this.rng() - 0.5) * 0.1, zz: a.zz + (this.rng() - 0.5) * 0.1,
    vx: (this.rng() - 0.5) * 8e-3, vy: (this.rng() - 0.5) * 8e-3, vz: (this.rng() - 0.5) * 8e-3,
  });
  ai.label = 'α';
  ai.base = [1, 0.9, 0.3]; ai.color = [1, 0.9, 0.3];
  ai.cap = 0;
  // recoil
  a.vx -= ai.vx * ai.m / a.m; a.vy -= ai.vy * ai.m / a.m; a.vz -= ai.vz * ai.m / a.m;
  a.decayed = true;
  a.decayL = 30;
  a.glow = 40;
  a.z = dz;
  a.el = dEl || this.elByZ.get(1);
  a.r = atomRadius(a.el);
  a.base = elementColor(a.el); a.color = a.base.slice();
  if (dEl) a.daughter = dEl.s;
  this.event(`${a.el.s} decayed → ${dEl ? dEl.s : '?'} (+α)`, 'decay');
}

function exciteStep(dt){
  const atoms = this.atoms;
  for (const a of atoms){
    if (a.excited <= 0 && this.rng() < this.laser * dt * 6e-4){
      a.excited = 40 + this.rng() * 40;
      a.glow = 30;
      this.event(`${a.el.s} electron excited`, 'excite');
    }
  }
}

function laserStep(dt, b){
  // One optical beam out of the bank. Energy is deposited only in atoms that
  // cross the beam's own cylinder, so beams cut/heats a hot line through the
  // chamber instead of heating everything. dt-scaled like RF so the per-fs
  // behaviour is independent of playback speed. Several beams from different
  // directions simply stack — counter-propagating pairs behave like an
  // optical molasses (each beam walks atoms along its own +direction).
  //
  //  ray   — continuous collimated ray: steady heating + excitation + ionization
  //  pulse — bursts at `rate` Hz with a hard kick per photon (ablation)
  //  trap  — optical tweezers: gradient force pulls in-beam atoms onto the line
  //  flood — wide soft illumination: broad gentle heating, no ionization
  const type = b.type || 'ray';
  const ax = b.axis || 'y';
  const L = this.size * 2.2;                       // beam half-length (reaches both walls)
  const spot = Math.min(0.5, Math.max(0.05, b.spot || 0.16));
  const R = spot * this.size;
  const reach = type === 'flood' ? R * 2.6 : type === 'trap' ? R * 1.8 : R;
  const reach2 = reach * reach;
  const rate = Math.min(1, b.power * 0.5);         // expected hits per fs
  const p = Math.min(1, rate * dt * 0.6);
  // pulse window: 15% duty cycle at the set frequency (Hz → fs period)
  // pump-probe: `delay` shifts the burst window in phase — two pulse beams with
  // different delay probe the same packet at a chosen time offset.
  let burst = 1;
  if (type === 'pulse'){
    const period = Math.max(1e3, 1e9 / Math.min(1e4, Math.max(0.1, b.rate || 10)));
    b.phase = (b.phase || 0) + dt;
    if (b.phase >= period) b.phase %= period;
    const ph = (((b.phase - (b.delay || 0) * period) % period) + period) % period;
    burst = ph < period * 0.15 ? 3.2 : 0;
    if (burst === 0) return;
  }
  const dir = b.dir >= 0 ? 1 : -1;
  // source direction: explicit off-axis vector when mounted, else the classic axis unit vector
  let ux, uy, uz;
  if (b.d && (b.d[0] || b.d[1] || b.d[2])){
    const il = 1 / Math.hypot(b.d[0], b.d[1], b.d[2] || 0);
    ux = b.d[0] * il; uy = b.d[1] * il; uz = (b.d[2] || 0) * il;
  } else {
    ux = ax === 'x' ? dir : 0;
    uy = ax === 'z' ? 0 : (ax === 'y' ? dir : 1);
    uz = ax === 'z' ? dir : 0;
  }
  for (const a of this.atoms){
    if (a.fixed || a.sand) continue;
    const ox = b.offx || 0, oy = b.offy || 0, oz = b.offz || 0;
    const rdx = a.x - ox, rdy = a.y - oy, rdz = a.zz - oz;
    const along = rdx * ux + rdy * uy + rdz * uz;
    const px = rdx - ux * along, py = rdy - uy * along, pz = rdz - uz * along;
    const perp2 = px * px + py * py + pz * pz;
    if (Math.abs(along) > L || perp2 > reach2) continue;
    const d = Math.sqrt(perp2);
    if (type === 'trap'){
      // gradient force: pull the atom toward the beam line (soft at focus)
      if (d < 1e-9) continue;
      const pull = b.power * (0.3 + (b.grip || 0.5) * 0.7) * Math.min(1, dt * 0.02) * 0.05;
      const scale = pull / d;
      a.vx -= px * scale; a.vy -= py * scale; a.vz -= pz * scale;
      a.glow = Math.max(a.glow || 0, 8 + 12 * b.power);
      continue;
    }
    if (this.rng() >= p) continue;
    // momentum dump walks the beam direction (+transverse jitter) — recoil + heat
    const kick = (0.3 + this.rng() * 0.5) * b.power * (type === 'flood' ? 0.55 : 1) * 2.6e-3 * burst;
    b._hits = (b._hits || 0) + 1;                      // far-mount detector: flux + energy board
    b._E = (b._E || 0) + Math.abs(kick);
    a.vx += ux * kick; a.vy += uy * kick; a.vz += uz * kick;
    a.vx += (this.rng() - 0.5) * kick * 0.5;
    a.vz += (this.rng() - 0.5) * kick * 0.5;
    a.glow = Math.max(a.glow || 0, 20 + 34 * b.power);
    if (a.excited <= 0) a.excited = 24 + 30 * b.power;   // photon absorption → fluorescence
    // spectral beams: photon energy from the tuned wavelength; a neutral atom
    // photo-ionizes only when E_ph ≈ covers its first IP (resonant near threshold).
    if ((type === 'ray' || type === 'pulse') && b.power > 0.75 && !a.q){
      const ePh = 1240 / (b.wav || 532);                // eV
      const ip = a.el && a.el.ion ? a.el.ion : 6;
      if (ePh >= ip * 0.88 && this.rng() < 0.015){
        a.q = 1;
        this.event(`${a.el.s} photo-ionized by the ${type} beam (${ePh.toFixed(1)} eV ≥ IP ${ip.toFixed(1)})`, 'react');
      }
    }
  }
}

function waterReactStep(dt){
  const atoms = this.atoms;
  for (const a of atoms){
    if (a.reacted || (!isAlkali(a.el) && !isAlkaline(a.el))) continue;
    let best = Infinity, bO = null;
    for (const b of atoms){
      if (b.z !== 8 || b.fixed || b.reacted) continue;
      const ddx = b.x - a.x, ddy = b.y - a.y, ddz = b.zz - a.zz;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 < best){ best = d2; bO = b; }
    }
    const b = bO;
    if (!b) continue;
    const d = Math.sqrt(best);
    // hydrophilic grab: coarse renormalization ignores forces, so nudge positions toward the pool
    if (d < 4 && d > 1e-9){
      const pull = Math.min(0.12, d * 0.15);
      a.x += ((b.x - a.x) / d) * pull;
      a.y += ((b.y - a.y) / d) * pull;
      a.zz += ((b.zz - a.zz) / d) * pull;
    }
    const reach = a.r + b.r + 3.2;
    const P = d < 1.0 ? 0.9 : d < 2.2 ? 0.45 : 0.12;
    if (this.rng() < P){
    const hydr = b.bonds.map(bd => bd.b).filter(h => h.z === 1 && !h.fixed)[0];
      if (hydr){
        a.reacted = 'M-OH + H↑';
        b.reacted = 'hydroxide';
        this.addBond(a, b, { type: 'ionic', r0: a.r + b.r });
        a.q = 1; b.q = -1;
        hydr.fixed = false;
        hydr.vx += (this.rng() - 0.5) * 5e-3;
        hydr.vy += 8e-3; hydr.vz += (this.rng() - 0.5) * 5e-3;
        hydr.glow = 20;
        hydr.label = 'H↑';
        a.glow = 45;
        this.T_target = (this.T_target || 300) + 60;
        this.event(`${a.el.s} + H₂O → ${a.el.s}OH + H₂↑  (exothermic!)`, 'react');
        this.reactionCount++;
      }
    }
  }
}

/* ---------------- plate waves, sand & oscilloscope ---------------- */

export function plateWave(ch, x, z){
  const m = (ch.mode && ch.mode.m) || 2, n = (ch.mode && ch.mode.n) || 2;
  const L = Math.max(0.1, ch.size);
  return Math.cos(Math.PI * m * x / L) * Math.cos(Math.PI * n * z / L);
}

export const CHLADNI_MODES = [
  { m: 1, n: 1, name: '1×1 · heartbeat' },
  { m: 2, n: 1, name: '2×1 · the gong' },
  { m: 2, n: 2, name: '2×2 · four petals' },
  { m: 3, n: 2, name: '3×2 · six lobes' },
  { m: 3, n: 3, name: '3×3 · the grid' },
  { m: 4, n: 1, name: '4×1 · the scarf' },
  { m: 5, n: 4, name: '5×4 · the lotus' },
];

function chladniGrainStep(a, ms){
  const ch = this;
  const step = ms / 16.7;                                  // wall-clock frames
  const drive = ch.drive || 0;
  if (drive <= 0.02) return;
  const L = Math.max(0.1, ch.size);
  const D = Math.abs(plateWave(ch, a.x, a.zz));
  const e = L * 0.02;
  const Dx = (Math.abs(plateWave(ch, a.x + e, a.zz)) - Math.abs(plateWave(ch, a.x - e, a.zz))) / (2 * e);
  const Dz = (Math.abs(plateWave(ch, a.x, a.zz + e)) - Math.abs(plateWave(ch, a.x, a.zz - e))) / (2 * e);
  // shake pushes grains downhill in |wave| -> they collect on the nodal lines
  const slide = 0.006 * step * drive * (0.2 + D) * L * 0.5;
  a.x -= Dx * slide;
  a.zz -= Dz * slide;
  const jit = 0.005 * step * drive * (0.12 + D);
  a.x += (ch.rng() - 0.5) * jit;
  a.zz += (ch.rng() - 0.5) * jit;
  a.y = L * 0.21;                                          // ride just under the plate's top face
  const edge = L - 0.02;
  a.x = clamp(a.x, -edge, edge);
  a.zz = clamp(a.zz, -edge, edge);
  a.temp = 300 + D * drive * 2200;
  a.localAmp = D * drive;
}

/* Kick every sand grain loose so the plate visibly re-figures when the driver
   (mode, frequency, drive) changes — the half-jump then re-slides onto the new
   nodal lines, which reads instantly instead of over many seconds. */
export function agitateSand(ch, amt = 0.4){
  if (!ch || !ch.sandMode) return 0;
  const L = Math.max(0.1, ch.size);
  const edge = L - 0.02;
  let n = 0;
  for (const a of ch.atoms){
    if (!a.sand) continue;
    a.x = clamp(a.x + (ch.rng() - 0.5) * amt * L, -edge, edge);
    a.zz = clamp(a.zz + (ch.rng() - 0.5) * amt * L, -edge, edge);
    n++;
  }
  return n;
}

function scopeSignalY(ch){
  const m = ch.scopeMode || 'temp';
  if (m === 'atom0x'){ const a = ch.atoms[0]; return a ? a.x / ch.size : 0; }
  if (m === 'energy'){
    let k = 0; for (const a of ch.atoms) k = Math.max(k, a.ke);
    return clamp(Math.sqrt(k) * 90 - 1, -1.2, 1.2);
  }
  return clamp((ch.T_cur || 0) / 4000, -1.2, 1.2);
}

function advanceScope(ms){
  const ch = this;
  if (!ch.scopeBuf) return;
  const B = ch.scopeBuf, cap = B.length;
  if (ch.scopeMode === 'audio'){
    const SR = 48000;
    const n = Math.max(1, Math.round((ms / 1000) * SR));
    const f = Math.max(1, ch.freq || 0);
    for (let i = 0; i < n; i++){
      ch._scopePhase += 2 * Math.PI * f / SR;
      B[ch.scopeN % cap] = Math.sin(ch._scopePhase) * (ch.drive || 0.6);
      ch.scopeN++;
    }
    ch.scopeSample = Math.sin(ch._scopePhase);
  } else {
    const y = scopeSignalY(ch);
    B[ch.scopeN % cap] = y;
    ch.scopeN++;
    ch.scopeSample = y;
  }
}

function phaseOf(a, ch){
  const melt = a.el.melt || 2000, boil = a.el.boil || 4000;
  const T = a.temp;
  if (T > boil * 3) return 'plasma';
  if (T > boil * 1.15 && !a.bonds.length) return 'gas';
  if (T > melt * 1.1) return 'liquid';
  if (T > melt * 0.6) return 'slush';
  if (a.bonds.length >= 2 || T < melt * 0.45) return 'solid';
  return 'liquid';
}

function clearAtoms(){ this.atoms.length = 0; this.bonds.length = 0; }

/* ---------------- cross-field preset mapping ------------------ */

// physicsSim presets mapped into chamber fields + correlated slider knobs
export const CROSS_PRESETS = [
  {
    id: 'off', label: 'Free Chamber', icon: '◎', tag: 'off',
    desc: 'Pure element physics. No cross-laboratory fields.',
    fields: { enabled: false }, knobs: [],
  },
  {
    id: 'quantumFoam', label: 'Quantum Foam', icon: '✦', tag: '10⁻³⁵ m',
    desc: 'Spacetime boils — Planck jitter, tunneling, entanglement. Every atom entangles with its neighbor.',
    fields: { enabled: true, quantum: 1.0, tunnel: 0.9, planckJitter: 0.7, entangle: 0.6 },
    knobs: [
      { k: 'quantum', label: 'ħ quantum', min: 0, max: 2, d: 0.01 },
      { k: 'tunnel', label: 'tunneling', min: 0, max: 2, d: 0.01 },
      { k: 'entangle', label: 'entanglement', min: 0, max: 2, d: 0.01 },
      { k: 'planckJitter', label: 'Planck jitter', min: 0, max: 2, d: 0.01 },
    ],
  },
  {
    id: 'atomic', label: 'Atomic Lattice', icon: '❖', tag: '10⁻¹⁰ m',
    desc: 'Strong force + shell order: atoms tether to their quantum nodes and hold a crystal web.',
    fields: { enabled: true, lattice: 1.0, entangle: 0.15, quantum: 0.15 },
    knobs: [
      { k: 'lattice', label: 'strong lattice', min: 0, max: 2, d: 0.01 },
      { k: 'entangle', label: 'fine-structure α', min: 0, max: 2, d: 0.01 },
      { k: 'quantum', label: 'zero-point', min: 0, max: 1, d: 0.01 },
    ],
  },
  {
    id: 'galactic', label: 'Galactic Web', icon: '⌁', tag: '10²⁰ m',
    desc: 'Gravity + dark energy: your elements become a cosmos. Chains orbit the void.',
    fields: { enabled: true, gravity: 1.0, darkEnergy: 0.8, curvature: 0.7, inflation: 0.15 },
    knobs: [
      { k: 'gravity', label: 'gravity', min: 0, max: 2, d: 0.01 },
      { k: 'darkEnergy', label: 'dark energy', min: 0, max: 2, d: 0.01 },
      { k: 'curvature', label: 'curvature', min: 0, max: 2, d: 0.01 },
      { k: 'inflation', label: 'inflation', min: 0, max: 1, d: 0.01 },
    ],
  },
  {
    id: 'slimeMold', label: 'Slime Mold', icon: '≋', tag: '10⁻⁶ m',
    desc: 'Chemotaxis alignment: atoms flock like a living organism, sensing neighbor velocity.',
    fields: { enabled: true, alignment: 1.0, quantum: 0.1 },
    knobs: [
      { k: 'alignment', label: 'chemotaxis', min: 0, max: 2, d: 0.01 },
      { k: 'quantum', label: 'noise', min: 0, max: 1, d: 0.01 },
    ],
  },
  {
    id: 'neuralNet', label: 'Neural Net', icon: '✳', tag: 'align weights',
    desc: 'Hebbian alignment: atoms learn to move like their neighbors — a neural graph of elements.',
    fields: { enabled: true, alignment: 0.85, entangle: 0.5, quantum: 0.05 },
    knobs: [
      { k: 'alignment', label: 'align strength', min: 0, max: 2, d: 0.01 },
      { k: 'entangle', label: 'connection', min: 0, max: 2, d: 0.01 },
    ],
  },
  {
    id: 'chaos', label: 'Chaos', icon: 'ϟ', tag: 'everything, everywhere',
    desc: 'All forces, maxed. The Cross-Lab’s chaos preset, poured through your elements.',
    fields: { enabled: true, quantum: 1.3, gravity: 1.1, darkEnergy: 1.2, curvature: 1.2, entangle: 1.4, tunnel: 1.0, inflation: 0.3 },
    knobs: [
      { k: 'quantum', label: 'ħ', min: 0, max: 2, d: 0.01 },
      { k: 'gravity', label: 'g', min: 0, max: 2, d: 0.01 },
      { k: 'darkEnergy', label: 'Λ', min: 0, max: 2, d: 0.01 },
      { k: 'curvature', label: 'κ', min: 0, max: 2, d: 0.01 },
      { k: 'entangle', label: '⟨σσ⟩', min: 0, max: 2, d: 0.01 },
      { k: 'tunnel', label: 'ψ', min: 0, max: 2, d: 0.01 },
    ],
  },
];

export function crossBanner(id){
  const c = CROSS_PRESETS.find(p => p.id === id);
  if (!c) return '—';
  return `${c.icon} ${c.label} · ${c.tag}`;
}

/* ---------------- machine presets ---------------- */

export const MACHINES = [
  {
    id: 'autolab', label: 'Auto Lab', icon: '⚗', tag: 'bench reactor',
    desc: 'A plain bench chamber with a warm furnace — the sandbox baseline.',
    shape: 'cube', size: 2.4, T: 420,
    B: 0, E: 0, power: 0.15, Baxis: 'y', Edir: 'x',
    seed: [{ z: 11, n: 12 }, { z: 17, n: 12 }],
    feed: [],
  },
  {
    id: 'tokamak', label: 'Tokamak', icon: '◌', tag: 'toroidal B-field',
    desc: 'A doughnut of plasma. The toroidal field curls charged ions around the hole; the feeder drips deuterium for fusion chemistry.',
    shape: 'torus', size: 2.6, T: 1400, rate: 1e5,
    B: 1.0, E: 0, power: 0.4, Baxis: 'y', Edir: 'z',
    seed: [{ z: 1, n: 10 }, { z: 2, n: 8 }],
    feed: [{ z: 1, n: 4, every: 4e5, q: 1 }, { z: 2, n: 4, every: 4e5, q: 1 }],
  },
  {
    id: 'stellarator', label: 'Stellarator', icon: '✱', tag: 'twisty tube',
    desc: 'A (2,3) torus-knot magnetic bottle — the field follows the twist, so ions thread the knot without a drive current.',
    shape: 'helix', size: 2.2, T: 1500, rate: 1e5,
    B: 1.3, E: 0, power: 0.35, Baxis: 'y', Edir: 'z',
    seed: [{ z: 1, n: 6 }, { z: 2, n: 4 }],
    feed: [{ z: 1, n: 3, every: 3e5, q: 1 }, { z: 2, n: 3, every: 3e5, q: 1 }],
  },
  {
    id: 'beam', label: 'Ion Beamline', icon: '⇶', tag: 'linac · E-field',
    desc: 'An electric field accelerates charged pulses down the bore; the feeder injects from the gun.',
    shape: 'cylinder', size: 2.2, T: 600, rate: 1e4,
    B: 0.5, E: 1.2, power: 0.12, Baxis: 'y', Edir: 'z',
    seed: [{ z: 1, n: 6 }],
    feed: [{ z: 1, n: 2, every: 2e4, inlet: true, q: 1 }, { z: 2, n: 2, every: 2e4, inlet: true, q: 1 }],
  },
  {
    id: 'cvd', label: 'CVD Furnace', icon: '◫', tag: 'gas-phase growth',
    desc: 'Hot gas decomposes and deposits — silane-like feed rains atoms onto a warm seed and a film grows.',
    shape: 'cube', size: 2.2, T: 950, rate: 1e5,
    B: 0, E: 0, power: 0.55, Baxis: 'y', Edir: 'x',
    seed: [{ z: 14, n: 8 }],
    feed: [{ z: 14, n: 2, every: 5e4 }, { z: 1, n: 6, every: 5e4 }],
  },
  {
    id: 'sputter', label: 'Sputter Gun', icon: '✶', tag: 'bias · argon',
    desc: 'A spherical cathode biased against an argon feed — noble ions hammer a target and knock atoms free.',
    shape: 'sphere', size: 2.0, T: 800, rate: 1e4,
    B: 0.7, E: 0.9, power: 0.5, Baxis: 'y', Edir: 'x',
    seed: [{ z: 18, n: 16 }, { z: 26, n: 8 }],
    feed: [{ z: 18, n: 3, every: 3e4, q: 1 }],
  },
];

/* ---------------- preset experiments + education ---------------- */

// Aarkanum Laboratories — environment presets for the opening wizard.
// `g` = gravity in earth units, `atm` = atmosphere density (drag/resistance),
// `gasMix` = ambient gas composition [[z, ppm], …] spawned as light background
// atoms, `stars` = deep-space starfield on the sky dome.
export const ENVIRONMENTS = [
  { id: 'earth-temperate', icon: '🌱', label: 'Temperate Earth', tag: 'N₂/O₂ · 1 g · 300 K', g: 1.0, T: 300, atm: 1.0, gasMix: [[7, 78], [8, 21], [18, 1]], stars: false, bg: 0x0a1428 },
  { id: 'earth-desert', icon: '🏜', label: 'Desert Scorch', tag: 'dry heat · 1 g · 335 K', g: 1.0, T: 335, atm: 0.7, gasMix: [[7, 79], [8, 21]], stars: false, bg: 0x1a1408 },
  { id: 'earth-ocean', icon: '🌊', label: 'Abyssal Ocean', tag: 'deep pressure · 1 g · 276 K', g: 1.0, T: 276, atm: 1.5, gasMix: [[8, 62], [7, 34], [6, 4]], stars: false, bg: 0x061226 },
  { id: 'earth-tundra', icon: '❄', label: 'Glacial Tundra', tag: 'thin air · 1 g · 248 K', g: 1.0, T: 248, atm: 0.85, gasMix: [[7, 78], [8, 21]], stars: false, bg: 0x0c1226 },
  { id: 'space', icon: '🌌', label: 'Deep Space', tag: 'zero g · 3 K · vacuum', g: 0, T: 3, atm: 0, gasMix: [], stars: true, bg: 0x020309 },
  { id: 'moon', icon: '🌕', label: 'The Moon', tag: '0.165 g · 200 K · trace He', g: 0.165, T: 200, atm: 0.02, gasMix: [[2, 100]], stars: true, bg: 0x05070f },
  { id: 'mars', icon: '🔴', label: 'Mars', tag: '0.38 g · 210 K · CO₂ sky', g: 0.38, T: 210, atm: 0.6, gasMix: [[6, 95], [7, 2.8], [18, 1.6]], stars: false, bg: 0x190d06 },
  { id: 'custom', icon: '✦', label: 'Custom', tag: 'make it yours', g: 0.5, T: 300, atm: 0.5, gasMix: [[7, 78], [8, 21]], stars: false, bg: 0x05070f },
];

export function envDefault(){
  return Object.assign({}, ENVIRONMENTS[ENVIRONMENTS.length - 1] || ENVIRONMENTS[0], { id: 'custom' });
}

export const EXPERIMENTS = [
  {
    id: 'salt', name: 'Salt from Nothing', icon: '⌬', tag: 'Na + Cl → NaCl',
    desc: 'Drop sodium and chlorine together, add a little heat, and watch them pull electrons apart into a crystal lattice.',
    setup(ch){
      ch.reset();
      ch.size = 1.25;
      ch.setHeat(0.38, 420);
      ch.spawnGroup(11, 20); ch.spawnGroup(17, 20);
      ch.setRate(6e3);
    },
    steps: [
      { title: 'Ingredients', edu: 'Two groups: soft alkali metal (Na, atomic #11) and sharp halogen gas (Cl, #17). Sodium holds one outer electron loosely; chlorine needs exactly one to fill its shell.', when: ch => ch.atoms.length >= 28 },
      { title: 'Warm-up', edu: 'The furnace pushes kinetic energy — atoms start creeping over 10 nm in a few hundred femtoseconds.', when: ch => ch.T_cur > 350 && ch.T_target >= 420, max: 8e5 },
      { title: 'First contact', edu: 'Sodium touches chlorine and its outer electron jumps across (Δelectronegativity ≈ 2.2). They snap together — ionic bond.', when: ch => ch.bonds.some(b => b.type === 'ionic'), max: 9e5 },
      { title: 'Crystal growing', edu: 'More Na⁺ and Cl⁻ fasten into checkerboards. Opposites attract; a salt crystal is just a huge ionic bond repeating.', when: ch => ch.bonds.filter(b => b.type === 'ionic').length >= 8, max: 2.5e6 },
      { title: 'Table salt', edu: 'One crystal of many — every grain of salt you eat was once ions doing exactly this. ⌬', when: ch => ch.bonds.filter(b => b.type === 'ionic').length >= 20, max: 4e6 },
    ],
    goal: '20+ ionic bonds',
    pick: {
      geo: 'cage',                                      // ions crystallize on both faces of a fullerene shell
      time: { band: 'ns', rate: 6e3, why: 'nanosecond dial — lattice rows fall into place visibly' },
      presets: [
        { id: 'atomic', why: 'a strong lattice grows the crystal exactly where it wants' },
        { id: 'quantumFoam', why: 'tunneling hands electrons across the shell faster' },
        { id: 'off', why: 'pure Coulomb — the classic checkerboard' },
      ],
      feed: [
        { id: 'cl', z: 17, n: 1, every: 4e4, start: 6e4, inlet: true, why: 'fresh chlorine keeps the checkerboard growing clean' },
        { id: 'na', z: 11, n: 1, every: 4e4, start: 6e4, inlet: true, why: 'sodium tops up the metallic half of the lattice' },
      ],
    },
  },
  {
    id: 'bond', name: 'The Bond (femto zoom)', icon: '∞', tag: 'C + C · fs-step',
    desc: 'The crown jewel — slow time to individual femtoseconds and watch a covalent bond actually snap shut and vibrate.',
    setup(ch){
      ch.reset();
      ch.size = 1.2;
      ch.setHeat(0.25, 1200);
      ch.spawn(6, { x: -0.5, y: 0.05, zz: 0, temp: 1200 });
      ch.spawn(6, { x: 0.5, y: -0.05, zz: 0, temp: 1200 });
      ch.spawnGroup(1, 2, { temp: 1200 });
      ch.spawn(15, { x: 0, y: 1.2, zz: 0.4, temp: 1200 });
      ch.scopeMode = 'atom0x';
      ch.setRate(10);
    },
    steps: [
      { title: 'Freeze to f', edu: 'Time is now running at ~10 femtoseconds per step — 10¹⁵× slower than a real clock tick. You can watch a bond form.', when: ch => ch.t > 0 },
      { title: 'Approach', edu: 'Two carbon atoms close in. At femto speeds their thermal jitter is enormous; a covalent bond snaps shut on momentary contact.', when: ch => ch.bonds.some(b => (b.a.z === 6 || b.b.z === 6) && b.type === 'covalent'), max: 6e3 },
      { title: 'Bond phase', edu: 'They locked! The spring between them vibrates at ~15 fs periods — that vibration IS the stored bond energy, quantized phonons.', when: ch => ch.bonds.some(b => (b.a.z === 6 || b.b.z === 6) && b.type === 'covalent' && b.age > 20), max: 1.2e4 },
      { title: 'Zoom out', edu: 'Crank the time dial up to ns/frame: the vibration becomes a blur and molecules behave like rigid rods. Planck’s constant, visually.', when: ch => ch.t > 1e4 },
    ],
    goal: 'Form C–C at femto scale',
    pick: {
      geo: 'cube',                                      // keep the four-atom stage wide open
      time: { band: 'fs', rate: 10, why: 'femtosecond pulse — a bond snaps shut before your eyes' },
      presets: [
        { id: 'quantumFoam', why: 'tunneling lets the electron hop across the gap' },
        { id: 'atomic', why: 'lattice nodes coax the two carbons into register' },
        { id: 'slimeMold', why: 'alignment steers the pair toward contact' },
      ],
    },
  },
  {
    id: 'melt', name: 'Metal Meltdown', icon: '▲', tag: 'Fe · Cu · W furnace',
    desc: 'Cram heavy metals into the furnace, swing the temperature past their melting points, and watch lattices unzip.',
    setup(ch){
      ch.reset();
      ch.setHeat(0.9, 5200);
      ch.spawnGroup(26, 10); ch.spawnGroup(29, 8); ch.spawnGroup(74, 6); ch.spawnGroup(13, 6);
      ch.setRate(5e4);
    },
    steps: [
      { title: 'Metals in', edu: 'Iron (melt 1811 K), copper (1358 K), aluminium (933 K) and tungsten (3695 K) — the melt ladder.', when: ch => ch.atoms.length >= 30 },
      { title: 'Warming', edu: 'Furnace set to 5200 K — far past every melt point. Atoms shake loose from their bonds.', when: ch => ch.T_cur > 1400, max: 3e5 },
      { title: 'First to flow', edu: 'Aluminium melts first — lowest bond strength (lowest ε). It pools as jiggling liquid metal.', when: ch => ch.atoms.some(a => a.z === 13 && a.released), max: 6e5 },
      { title: 'Copper flows', edu: 'Copper unzips next; its d-orbital bonding holds longer than aluminium’s. Liquid metals still conduct — the electron sea never melts.', when: ch => ch.atoms.some(a => a.z === 29 && a.released), max: 1.2e6 },
      { title: 'Tungsten last', edu: 'Tungsten finally gives at ~3700 K — it will be flowing long after the others froze. That’s why it survives inside light bulbs.', when: ch => ch.atoms.some(a => a.z === 74 && a.released), max: 2.4e6 },
    ],
    goal: 'Melt all four metals',
    pick: {
      geo: 'sphere',                                    // compressed furnace — melts collide in the core
      time: { band: 'us', rate: 5e4, why: 'microsecond cruise — four melt points on the ladder' },
      presets: [
        { id: 'chaos', why: 'everything everywhere — the furnace fights the electron sea' },
        { id: 'galactic', why: 'gravity sinks the heavy metals into a molten core' },
        { id: 'neuralNet', why: 'alignment herds the atoms so lattices unzip in order' },
      ],
      feed: [
        { id: 'fe', z: 26, n: 2, every: 5e4, start: 1e4, inlet: true, why: 'iron ingots keep the melt dense and flowing' },
        { id: 'cu', z: 29, n: 2, every: 6e4, start: 3e4, inlet: true, why: 'copper tops up the alloy pool' },
      ],
    },
  },
  {
    id: 'water', name: 'Alkali Storm', icon: '≋', tag: 'Na·K·Cs + H₂O',
    desc: 'The most violent family in the table meets water. Watch electrons rip off and hydrogen bubble free in exothermic fury.',
    setup(ch){
      ch.reset();
      ch.setHeat(0.5, 420);
      ch.spawnWater({ x: -2, y: -1.4, zz: -0.5 }, 12, 350);
      ch.spawnWater({ x: 2, y: -1.4, zz: 0.5 }, 12, 350);
      for (const z of [11, 19, 55]) for (let i = 0; i < 5; i++){
        const cx = (i % 2 === 0 ? -2 : 2) + (ch.rng() - 0.5) * 0.8;
        ch.spawn(z, { x: cx, y: -1.4 + (ch.rng() - 0.5) * 0.4, zz: (2 * ch.rng() - 1) * 1.0, temp: 420 });
      }
      ch.setRate(1.2e4);
    },
    steps: [
      { title: 'Drop them in', edu: 'Na, K, Cs tumble into liquid water. Alkali metals hold ONE valence electron that water desperately wants (oxygen EN 3.44).', when: ch => ch.atoms.some(a => [11, 19, 55].includes(a.z) && a.y < 0) },
      { title: 'Contact — boom', edu: 'The metal’s electron jumps to the water’s oxygen. Hydrogen splits off as H₂ gas — the fizzing you see is hydrogen igniting.', when: ch => ch.reactionCount >= 1, max: 1e5 },
      { title: 'Cascade', edu: 'Each metal–water hit heats the pool further (exothermic!), making the next reaction faster. Cesium—most eager—goes nearly instantly.', when: ch => ch.reactionCount >= 4, max: 2e6 },
      { title: 'Bath of ions', edu: 'What’s left: metal hydroxide ions swimming in warm water — a strongly basic solution. Chemistry, sorted.', when: ch => ch.reactionCount >= 8, max: 4e6 },
    ],
    goal: '8+ metal–water reactions',
    pick: {
      geo: 'cage',                                      // the pool beads on a fullerene shell — fire above, water below
      time: { band: 'ns', rate: 1.2e4, why: 'nanosecond dial — each alkali hit flares in sequence' },
      presets: [
        { id: 'off', why: 'pure ion chemistry — the textbook storm' },
        { id: 'quantumFoam', why: 'tunneling ignites the pool faster' },
        { id: 'chaos', why: 'cascade mode — everything goes at once' },
      ],
      feed: [
        { id: 'k', z: 19, n: 1, every: 3e4, start: 5e4, inlet: true, why: 'potassium keeps the surface crackling' },
        { id: 'na', z: 11, n: 1, every: 3e4, start: 5e4, inlet: true, why: 'sodium feeds the stormfront' },
      ],
    },
  },
  {
    id: 'decay', name: 'Decay Bench', icon: '☢', tag: 'U · Th · Ra',
    desc: 'Heavy nuclei don’t wait — watch alpha decay, recoil, and daughter nuclei under a time-dilating microscope.',
    setup(ch){
      ch.reset();
      ch.setHeat(0, 320);
      ch.cross.decayBoost = 1.0;
      ch.spawnGroup(92, 6); ch.spawnGroup(90, 4); ch.spawnGroup(88, 4);
      ch.setRate(1.2e4);
    },
    steps: [
      { title: 'Heavy nuclei', edu: 'Uranium (#92), Thorium (#90), Radium (#88). Beyond element 82 (lead) the nucleus is big and wobbly; the strong force can’t hold 90+ protons.',
        when: ch => ch.atoms.length >= 14 },
      { title: 'First flash', edu: 'A nucleus ejects an α particle — 2 protons + 2 neutrons = a helium-4 core at ~5% light speed, shown as the golden spark.', when: ch => ch.decayCount >= 1, max: 6e4 },
      { title: 'Recoil', edu: 'The daughter nucleus lurches backward (momentum conservation — same force, opposite reaction). U−2 → Thorium-234.', when: ch => ch.decayCount >= 3, max: 2e5 },
      { title: 'Half-life', edu: 'Watch the bench empty: each decay is random, but the population halves on a fixed schedule — that is the half-life.', when: ch => ch.decayCount >= 6, max: 1e6 },
    ],
    goal: 'Observe decay chain',
    pick: {
      geo: 'crown',                                     // daughters spool away down three interlacing lobes
      time: { band: 's', rate: 1.2e4, why: 'seconds in a breath — watch a whole bench decay in real time' },
      presets: [
        { id: 'atomic', why: 'a lattice catches daughters before they wander off' },
        { id: 'quantumFoam', why: 'tunneling speeds the alpha escapes' },
        { id: 'galactic', why: 'recoil streaks across a gravity web' },
      ],
      feed: [
        { id: 'u', z: 92, n: 1, every: 1.2e5, start: 2e4, inlet: true, why: 'fresh uranium keeps the decay chain populated' },
        { id: 'ra', z: 88, n: 1, every: 1.5e5, start: 5e4, inlet: true, why: 'radium feeds the daughter cascade' },
      ],
    },
  },
  {
    id: 'plasma', name: 'Plasma Storm', icon: '☄', tag: 'all elements · laser',
    desc: 'Crank heat past every ionization energy. Thermal motion shreds electrons off — a seething plasma of ions and light.',
    setup(ch){
      ch.reset();
      ch.setHeat(1.0, 60000);
      ch.laser = 0.85;
      ch.laserOn = true;
      ch.laserAxis = 'x';
      ch.spawnGroup(1, 12); ch.spawnGroup(2, 6); ch.spawnGroup(8, 6); ch.spawnGroup(15, 4); ch.spawnGroup(92, 4);
      ch.setRate(6e4);
    },
    steps: [
      { title: 'Cold gas', edu: 'Light elements at high pressure — barely moving.', when: ch => ch.atoms.length >= 30 },
      { title: 'Thermal ramp', edu: 'at 60,000 K the kinetic energy (kT ≈ 5 eV) rivals ionization energies — electrons start leaving home.', when: ch => ch.T_cur > 20000, max: 2e5 },
      { title: 'Shredding', edu: 'Ionization flashes: excited electrons re-emit their own wavelength. Plasma is a soup, every atom flickering.', when: ch => ch.excitedCount >= 3, max: 9e5 },
      { title: 'Storm', edu: 'The whole chamber flickers like a star’s atmosphere — you are literally watching the inside of the Sun.', when: ch => ch.excitedCount >= 10, max: 2.5e6 },
    ],
    goal: '10+ simultaneous excitations',
    pick: {
      geo: 'spire',                                     // the (3,7) weave packs ions into a thready star-core
      time: { band: 'us', rate: 6e4, why: 'microsecond cruise — ionization spreads wavefront to wavefront' },
      presets: [
        { id: 'chaos', why: 'everything everywhere — a star atmosphere at full blaze' },
        { id: 'quantumFoam', why: 'quantum jitter tears electrons loose at lower heat' },
        { id: 'neuralNet', why: 'alignment chains the flickers into aurora sheets' },
      ],
      feed: [
        { id: 'he', z: 2, n: 4, every: 2e4, start: 0, inlet: true, why: 'helium tops up the seething soup' },
        { id: 'h', z: 1, n: 4, every: 2e4, start: 0, inlet: true, why: 'hydrogen keeps the ionization storm fed' },
      ],
    },
  },
  {
    id: 'alloy', name: 'Alloy Foundry', icon: '⚒', tag: 'Cu + Sn → bronze',
    desc: 'Two metals, one furnace. Atoms interdiffuse at the grain boundary and freeze into something neither pure metal was.',
    setup(ch){
      ch.reset();
      ch.setHeat(0.85, 2300);
      const a = ch.spawnGroup(29, 16); ch.spawnGroup(50, 8); ch.spawnGroup(30, 8);
      ch.setRate(4e4);
      // separate the metals a little
      ch.atoms.forEach((p, i) => { if (i < a) p.x += 1.6; });
    },
    steps: [
      { title: 'Two ingots', edu: 'Pure copper (#29) and pure tin (#50) kept apart on the bench. Bronze is 88% Cu + 12% Sn.', when: ch => ch.atoms.length >= 30 },
      { title: 'Liquid pools', edu: 'Both pass their melt points. Grain boundaries dissolve; the pool is now two liquids touching.', when: ch => ch.T_cur > 1500, max: 4e5 },
      { title: 'Diffusion', edu: 'Tin atoms (big, sluggish) wander into the copper. Concentration gradients drive mixing — entropy at work.', when: ch => ch.bonds.some(b => (b.a.z === 29 && b.b.z === 50) || (b.a.z === 50 && b.b.z === 29)) || ch.T_cur > 1700, max: 1.4e6 },
      { title: 'Bronze melt', edu: 'Copper and tin share one melt — atoms sliding through each other’s electron sea. Mixed when hot, bronze when cold; all history was written in this alloy.', when: ch => (ch.bonds.some(b => (b.a.z === 29 && b.b.z === 50) || (b.a.z === 50 && b.b.z === 29)) && ch.t > 8e4) || (ch.T_cur > 2100 && ch.t > 9e4), max: 2.6e6 },
    ],
    goal: 'Cu–Sn interdiffusion',
    pick: {
      geo: 'cylinder',                                  // a reactor drum — the two ingots side by side
      time: { band: 'us', rate: 4e4, why: 'microsecond cruise — tin wanders through the copper pool' },
      presets: [
        { id: 'atomic', why: 'a lattice makes grain boundaries visible as they dissolve' },
        { id: 'galactic', why: 'gravity pulls the heavier copper into a bronze core' },
        { id: 'off', why: 'pure interdiffusion — entropy alone mixes the melt' },
      ],
      feed: [
        { id: 'sn', z: 50, n: 2, every: 6e4, start: 4e4, inlet: true, why: 'tin ribbons feed the bronze mix' },
        { id: 'cu', z: 29, n: 2, every: 8e4, start: 6e4, inlet: true, why: 'copper keeps the foundry melting at 88%' },
      ],
    },
  },
  {
    id: 'noble', name: 'Noble Freeze', icon: '❄', tag: 'He · Ne · Ar · Kr',
    desc: 'Cool the shyest family to near absolute zero and watch pure van der Waals attraction liquefy them — no bonds, only whispers.',
    setup(ch){
      ch.reset();
      ch.setHeat(0.6, 55);
      ch.spawnGroup(2, 8); ch.spawnGroup(10, 8); ch.spawnGroup(18, 8); ch.spawnGroup(36, 8);
      ch.setRate(2.5e4);
    },
    steps: [
      { title: 'Noble gases', edu: 'Helium, Neon, Argon, Krypton — full shells, zero appetite. They only act through fleeting induced dipoles (London forces).',
        when: ch => ch.atoms.length >= 30 },
      { title: 'Molasses', edu: 'Cooling toward 55 K: krypton (biggest, most polarizable) starts clumping first; helium barely notices.', when: ch => ch.T_cur < 120, max: 4e5 },
      { title: 'Liquefaction', edu: 'A pool forms. This is exactly how liquid helium is made — right down to ~4 K — for superconducting magnets.', when: ch => ch.atoms.some(a => a.z === 36 && a.temp > 110), max: 1.2e6 },
      { title: 'Near absolute zero', edu: 'Keep dialing down: the gas condenses into a silent droplet. Only quantum zero-point motion remains.', when: ch => ch.T_cur < 90 && ch.t > 1e4, max: 2.4e6 },
    ],
    goal: 'Liquefy noble gases',
    pick: {
      geo: 'cage',                                      // nobles condense as a droplet hugging the shell walls
      time: { band: 's', rate: 2.5e4, why: 'a slow soak lets the van der Waals pool form from all sides' },
      presets: [
        { id: 'off', why: 'pure London forces — how liquefaction really works' },
        { id: 'quantumFoam', why: 'zero-point jitter fights the freeze' },
        { id: 'atomic', why: 'a lattice pins each atom as it liquefies' },
      ],
    },
  },
  {
    id: 'chladni', name: 'Chladni Sand', icon: '♬', tag: 'sand plates · frequency',
    desc: 'Scatter sand on a vibrating plate and watch it dance into perfect geometric figures. The sand flees the moving parts and settles where the plate stands still — along the nodal lines.',
    setup(ch){
      ch.reset();
      ch.shape = 'plate';
      ch.size = 2.0;
      ch.sandMode = true;
      ch.mode = { m: 2, n: 2 };
      ch.freq = 960;
      ch.drive = 0.6;
      ch.scopeMode = 'audio';
      ch.T_target = null;
      ch.heatPower = 0;
      ch.laser = 0;
      ch.laserOn = false;
      ch.cross.enabled = false;
      ch.setRate(6e4);
      ch.sandCount = 1600;
      ch.spawnSand(ch.sandCount || 1200);
    },
    steps: [
      { title: 'Scatter the sand', edu: 'Sand grains rest on a thin metal plate. Drive (strength) and frequency (pitch) will shake them.', when: ch => ch.atoms.length >= 400 },
      { title: 'Wake the plate', edu: 'The plate vibrates in a standing-wave mode (m,n). Crazy parts shake the sand loose; still parts keep it. The grains begin sliding to the still lines.', when: ch => ch.sandOrder > 0.35 && ch.atoms.length >= 400, max: 5e17 },
      { title: 'Nodal figures', edu: 'The sand has mostly gathered where |wave| ≈ 0 — the nodal lines. Lines of nodes become the figure you drew by choosing the driving frequency.', when: ch => ch.sandOrder > 0.5, max: 2e18 },
      { title: 'Reroute modes', edu: 'Swap (m,n) or sweep the frequency: new nodes appear where old ones were. Every classic Chladni shape is hidden inside this plate.', when: ch => ch.sandOrder > 0.6 || ch.t > 1e18, max: 4e18 },
    ],
    goal: 'Sand settles on nodal lines',
    pick: {
      geo: 'plate',                                     // fixed — Chladni needs the plate
      time: { band: 'us', rate: 6e4, why: 'microseconds per step — sand migrates fast and settles slowly' },
      presets: [
        { id: 'off', why: 'pure vibration — the classic nodal-line experiment' },
        { id: 'atomic', why: 'lattice nodes pin the sand exactly on the still lines' },
        { id: 'quantumFoam', why: 'jitter shakes every grain off the peaks faster' },
      ],
    },
  },
  {
    id: 'all', name: 'The Whole Table', icon: '⬢', tag: '118 atoms · chaos',
    desc: 'Every element at once, under the Cross-Lab Chaos field. See the periodic table as a living firework of forces.',
    setup(ch){
      ch.reset();
      ch.setHeat(0.5, 2400);
      ch.spawnAll();
      ch.cross.decayBoost = 0.6;
      ch.setRate(8e4);
    },
    steps: [
      { title: '118 atoms', edu: 'All elements, one chamber: 90+ natural + 28 synthetic (Tc onward are made in reactors & cyclotrons).',
        when: ch => ch.atoms.length >= 100 },
      { title: 'Families meet', edu: 'Metals pool, halogens fizz, nobles drift. Chemistry is self-sorting — every category finds its own energy level.', when: ch => ch.t > 8000, max: 6e5 },
      { title: 'Fusion dance', edu: 'Synthetic isotopes get restless: Cf, Es, U emit decay flashes throughout the soup.', when: ch => ch.decayCount >= 3, max: 2e6 },
      { title: 'Table alive', edu: 'That is everything the periodic table contains, interacting at once. ⬢', when: ch => ch.t > 5e5, max: 4e6 },
    ],
    goal: 'Entire table under Chaos',
    pick: {
      geo: 'gyroid',                                    // the whole periodic table weaving through a cubic labyrinth
      time: { band: 'ns', rate: 8e4, why: 'nanoseconds per step — families meet while the weave stays crisp' },
      presets: [
        { id: 'chaos', why: 'Cross-Lab Chaos — the experiment’s namesake field' },
        { id: 'galactic', why: 'the table becomes a cosmos, chains orbit the weave' },
        { id: 'quantumFoam', why: 'everything entangles — 118 atoms, one superposition' },
        { id: 'neuralNet', why: 'a neural graph of the periodic table ties like elements together' },
      ],
    },
  },

  /* ---------------- Aarkanum bio division: physics-light biology ---------------- */

  {
    id: 'protein', name: 'Protein Fold', icon: '🧬', tag: 'peptide chain → globule',
    family: 'biology', desc: 'A 26-residue peptide collapses as hydrophobic side-chains seek each other in water — watch a protein fold in femtoseconds.',
    setup(ch){
      ch.reset();
      ch.size = 1.5;
      ch.setHeat(0.12, 360);
      buildPeptide.call(ch, 26, 0.16);
      ch.bio = { enabled: true, kA: 3.2e-5, kR: 1.4e-5, range: 0.55 };
      ch.bio.r0 = measureProtein(ch);
      ch.event('🧬 peptide sanitized — hydrophobic core ready to collapse', 'react');
      ch.setRate(2e4);
    },
    steps: [
      { title: 'Chain in water', edu: 'A straight peptide of alternating polar (N/O) and hydrophobic (C) residues floats in warm water. Nothing is holding its shape but the backbone bonds.',
        when: ch => ch.atoms.length >= 20 },
      { title: 'Side-chains reach', edu: 'Hydrophobic side-chains on the same side of the chain attract each other — the chain begins to kink and curl back on itself.',
        when: ch => measureProtein(ch) < proteinR0(ch) * 0.85, max: 3e6 },
      { title: 'Hydrophobic core', edu: 'Nonpolar residues bury themselves together in a dry ball; polar side-chains stay out in the water. That ball IS the folded state.',
        when: ch => measureProtein(ch) < proteinR0(ch) * 0.6, max: 6e6, },
      { title: 'Native fold', edu: 'The chain has collapsed to a compact globule — radius of gyration under 60% of the straight chain. Nature folds thousands of these every second in you.',
        when: ch => measureProtein(ch) < proteinR0(ch) * 0.5, max: 1.2e7 },
    ],
    goal: 'Peptide collapses to a globule',
    pick: {
      geo: 'sphere',                                    // the solvent globe closes around the folding chain
      time: { band: 'ns', rate: 2e4, why: 'nanoseconds per step — hydrophobicity pulls visibly' },
      presets: [
        { id: 'slimeMold', why: 'chemotaxis steers hydrophobic side-chains toward each other' },
        { id: 'quantumFoam', why: 'tunneling lets the chain self-cross past steric jams' },
        { id: 'atomic', why: 'a lattice keeps the chain from tangling itself' },
        { id: 'off', why: 'pure physics folding, nothing helping' },
      ],
      feed: [
        { id: 'c', z: 6, n: 3, every: 5e4, start: 1e4, inlet: true, why: 'carbon restocks the peptide backbone' },
        { id: 'h', z: 1, n: 3, every: 5e4, start: 1e4, inlet: true, why: 'hydrogen buffers the folding bath' },
      ],
    },
  },
  {
    id: 'dna', name: 'Double Helix', icon: 'Ｄ', tag: 'unzip · strand separation',
    family: 'biology', desc: 'A short DNA duplex held by base-pair rungs. Heat it and the rungs melt, strand by strand — a physics-only denaturation.',
    setup(ch){
      ch.reset();
      ch.size = 1.6;
      ch.setHeat(0.35, 640);
      buildDna.call(ch, 9, 0.5);
      ch.bio = { enabled: false };
      ch.bio.rungs0 = dnaRungs(ch);
      ch.event('Ｄ duplex seeded — 9 base rungs', 'react');
      ch.setRate(3e4);
    },
    steps: [
      { title: 'Duplex', edu: 'Two antiparallel backbones (N–C repeats) zipped by 9 base rungs. Rungs are weak — they melt at a lower temperature than the backbone.',
        when: ch => ch.atoms.length >= 16 },
      { title: 'Rung melting', edu: 'Heat loosens the hydrogen-like rung bonds. One or two rungs pop first — a local bubble in the double helix.',
        when: ch => dnaRungs(ch) < dnaR0(ch) * 0.8, max: 2e6 },
      { title: 'Halfway unzipped', edu: 'Half the rungs are gone. The loose ends start whipping apart under random motion.',
        when: ch => dnaRungs(ch) < dnaR0(ch) * 0.5, max: 5e6 },
      { title: 'Strand separation', edu: 'Nearly every rung is gone — two independent single strands, each a flexible polymer. That is how PCR denatures DNA.',
        when: ch => dnaRungs(ch) < dnaR0(ch) * 0.25, max: 1.2e7 },
    ],
    goal: 'Base rungs all melted',
    pick: {
      geo: 'helix',                                     // the DNA duplex rides a matching double-helix tube
      time: { band: 'ns', rate: 3e4, why: 'nanoseconds per step — rungs pop one at a time like bubbles' },
      presets: [
        { id: 'quantumFoam', why: 'tunneling lowers the energy of a popped rung' },
        { id: 'slimeMold', why: 'alignment whips the loose strands apart' },
        { id: 'off', why: 'pure thermal denaturation — PCR in a box' },
      ],
      feed: [
        { id: 'n', z: 7, n: 3, every: 4e4, start: 2e4, inlet: true, why: 'nitrogen bases restock the strands' },
        { id: 'c', z: 6, n: 3, every: 4e4, start: 2e4, inlet: true, why: 'carbon sugars bulk up the backbone' },
      ],
    },
  },
  {
    id: 'membrane', name: 'Amphiphile Lake', icon: '🫧', tag: 'polar heads · lipid tails',
    family: 'biology', desc: 'Amphiphiles with polar heads and oily tails self-assemble when shaken — a proto cell-membrane bilayer assembling itself.',
    setup(ch){
      ch.reset();
      ch.size = 1.9;
      ch.setHeat(0.3, 380);
      buildAmphiphiles.call(ch, 16, 3);
      ch.bio = { enabled: true, kA: 4e-5, kR: 2e-5, range: 0.6 };
      ch.event('🫧 amphiphile monomers dispersed', 'react');
      ch.setRate(3e4);
    },
    steps: [
      { title: 'Dispersion', edu: 'Each amphiphile is a polar cap (O) with an oily tail (C–C–C). In water the tails despise contact with the polar solvent.',
        when: ch => ch.atoms.length >= 48 },
      { title: 'Tails cluster', edu: 'Oily tails pair up into little micelle seeds. A micelle is the smallest stable way to hide tails from water.',
        when: ch => bioMaxCluster(ch) >= 8, max: 3e6 },
      { title: 'Bilayer sheets', edu: 'Taller aggregates rope into strands — two rows of tails sandwiched between polar layers. That structure is a cell membrane.',
        when: ch => bioMaxCluster(ch) >= 20, max: 7e6 },
      { title: 'Vesicle', edu: 'Sheet edges curl and zip into a closed lipid sphere — a vesicle, the proto-cell. The tail count inside decides how thick the wall is.',
        when: ch => bioMaxCluster(ch) >= 36, max: 1.5e7 },
    ],
    goal: 'Amphiphiles assemble a wall',
    pick: {
      geo: 'gyroid',                                    // real cell membranes love gyroid phases; so will this lake
      time: { band: 'ns', rate: 3e4, why: 'nanoseconds per step — micelles seed, sheets zip, vesicles close' },
      presets: [
        { id: 'slimeMold', why: 'chemotaxis alignment assembles the bilayer faster than entropy alone' },
        { id: 'galactic', why: 'weak gravity settles the lipid sheets into lamellae' },
        { id: 'off', why: 'pure self-assembly — the honest lake' },
      ],
    },
  },
  {
    id: 'chaperonin', name: 'Chaperonin Fold', icon: '⛓', tag: 'beam grip · assisted folding',
    family: 'biology', desc: 'A misfolding peptide is rescued by a chaperonin cage — a laser-trap “grip” that squeezes the chain so hydrophobic patches find each other.',
    setup(ch){
      ch.reset();
      ch.size = 1.5;
      ch.setHeat(0.28, 470);
      buildPeptide.call(ch, 22, 0.17);
      ch.bio = { enabled: true, kA: 2e-5, kR: 1.4e-5, range: 0.55 };
      ch.bio.r0 = measureProtein(ch);
      ch.beams = [ch._newBeam('trap', 'y', 1, 0.9), ch._newBeam('trap', 'z', -1, 0.6)];
      ch._beamSel = 0;
      ch.event('⛓ peptide misfolding — chaperonin grip armed', 'react');
      ch.setRate(2.5e4);
    },
    steps: [
      { title: 'Misfold', edu: 'At 470 K the chain jitters too hard to find its hydrophobic core — it flails in a molten-globule state. Cells face this constantly, especially during fever.',
        when: ch => ch.atoms.length >= 18 },
      { title: 'Grip engage', edu: 'The trap beams hold the chain’s middle. Being confined raises the chance that a hydrophobic pair survives a collision long enough to bond.',
        when: ch => useBeamsOn(ch) }, 
      { title: 'Squeeze', edu: 'Two orthogonal traps compress the chain radially, forcing distant side-chains into contact — the cage does the bumping the solvent can’t.',
        when: ch => measureProtein(ch) < proteinR0(ch) * 0.7, max: 4e6 },
      { title: 'Native rescue', edu: 'The compact conformation formed while grasped persists — the protein is now folded. Chaperonins (GroEL/GroES) do this million-fold in every cell.',
        when: ch => measureProtein(ch) < proteinR0(ch) * 0.55, max: 9e6 },
    ],
    goal: 'Grip-assisted native fold',
    pick: {
      geo: 'cage',                                      // the chaperonin trap IS a cage — the whole chamber squeezes
      time: { band: 'ns', rate: 2.5e4, why: 'nanoseconds per step — the trap compresses visibly' },
      presets: [
        { id: 'atomic', why: 'lattice grip holds the chain centered for the trap beams' },
        { id: 'neuralNet', why: 'alignment models GroEL/ES actively driving side-chains together' },
        { id: 'galactic', why: 'a gravity envelope adds the confinement that rescues the fold' },
      ],
    },
  },
  {
    id: 'rust', name: 'Iron Oxidation', icon: '⛏', tag: 'Fe + O₂ → rust',
    family: 'chemistry', desc: 'Iron and oxygen meet in humid heat and slowly trade electrons into the red-orange oxide we call rust. The furnace feeds the march, one O at a time.',
    setup(ch){
      ch.reset();
      ch.size = 1.9;
      ch.setHeat(0.45, 760);
      ch.spawnGroup(26, 14); ch.spawnGroup(8, 20);
      ch.setRate(2e4);
    },
    steps: [
      { title: 'Bare iron', edu: 'Fourteen iron atoms in a warm humid furnace, oxygen drifting by. Iron wants to give electrons away; oxygen is greedy for exactly them.', when: ch => ch.atoms.length >= 26 },
      { title: 'First oxide', edu: 'An O₂ molecule finds a metal surface and the electron trade snaps in — the first Fe–O bond carries a partial charge across it.', when: ch => oxidePairs(ch) >= 1, max: 1e6 },
      { title: 'Flaking scale', edu: 'More oxygen atoms press into the metal. The bonds chain up into a scale that flakes and exposes fresh iron beneath — the march continues.', when: ch => oxidePairs(ch) >= 8, max: 2.5e6 },
      { title: 'Rust coat', edu: 'A crust of Fe–O bonds wraps the ingot. Real rust is exactly this electron handout, just slower — over years instead of microseconds.', when: ch => oxidePairs(ch) >= 18, max: 4e6 },
    ],
    goal: 'A crust of Fe–O bonds',
    pick: {
      geo: 'rose',                                      // the (2,5) rose strands cradle O so it presses in from every angle
      time: { band: 'ns', rate: 2e4, why: 'nanoseconds per step — the oxide front crawls across the surface visibly' },
      presets: [
        { id: 'atomic', why: 'a lattice pins the oxide scale as it forms' },
        { id: 'galactic', why: 'gravity binds the heavy iron, oxygen rains in from above' },
        { id: 'off', why: 'pure redox drift — the textbook corrosion' },
      ],
      feed: [
        { id: 'o', z: 8, n: 2, every: 3e4, start: 1e4, inlet: true, why: 'oxygen feeds the corrosion front' },
        { id: 'fe', z: 26, n: 1, every: 7e4, start: 2e4, inlet: true, why: 'iron keeps the oxide scale growing' },
      ],
    },
  },
  {
    id: 'glass', name: 'Silica Glass', icon: '▣', tag: 'Si + O₂ → glass',
    family: 'materials', desc: 'Silicon and oxygen fuse into a disordered SiO₂ network. Not a crystal — a frozen maze of corner-shared tetrahedra. Melt it and pour it.',
    setup(ch){
      ch.reset();
      ch.size = 1.9;
      ch.setHeat(0.8, 2400);
      ch.spawnGroup(14, 16); ch.spawnGroup(8, 30);
      ch.setRate(2.2e4);
    },
    steps: [
      { title: 'Silica sand', edu: 'Silicon atoms around a pool of oxygen at white-heat. At 2400 K both are a dense, slow liquid.', when: ch => ch.atoms.length >= 40 },
      { title: 'Tetrahedra', edu: 'Each Si grabs four O neighbours — corner-shared SiO₄ tetrahedra. Unlike a salt, the pattern never quite repeats.', when: ch => silicaBonds(ch) >= 6, max: 8e5 },
      { title: 'The network', edu: 'The tetrahedra fuse into a continuous random network — freezing in place when it cools. That frozen randomness is glass.', when: ch => silicaBonds(ch) >= 22, max: 2e6 },
      { title: 'Clear pane', edu: 'Si–O bridges cross the whole chamber. Real glass panes are this exact network, poured flat and cooled before it can crystallize.', when: ch => silicaBonds(ch) >= 40, max: 4e6 },
    ],
    goal: 'A continuous SiO₂ network',
    pick: {
      geo: 'sphere',                                    // a molten globe — tetrahedra share corners in every direction
      time: { band: 'ns', rate: 2.2e4, why: 'nanoseconds per step — the random network knits itself visibly' },
      presets: [
        { id: 'atomic', why: 'lattice seed sites, but the network stays disordered around them' },
        { id: 'quantumFoam', why: 'electron jitter lets O hop between silicons — network mobility' },
        { id: 'off', why: 'pure thermal fusion — no field helps the tetrahedra' },
      ],
      feed: [
        { id: 'si', z: 14, n: 2, every: 7e4, start: 5e4, inlet: true, why: 'silica channels keep the glass network growing' },
        { id: 'o', z: 8, n: 2, every: 6e4, start: 5e4, inlet: true, why: 'oxygen caps the network branches closed' },
      ],
    },
  },
  {
    id: 'battery', name: 'Voltaic Cell', icon: '⚡', tag: 'Zn + Cu acid bridge',
    family: 'chemistry', desc: 'A classic galvanic cell: zinc gives electrons up the wire, copper accepts them — the spark of a battery. Two metals, one acid bridge, lots of sparks.',
    setup(ch){
      ch.reset();
      ch.size = 1.9;
      ch.setHeat(0.3, 420);
      ch.spawnGroup(30, 12); ch.spawnGroup(29, 12); ch.spawnGroup(1, 8);
      ch.setRate(1.6e4);
    },
    steps: [
      { title: 'Metals + acid', edu: 'Zinc (a soft giver of electrons) and copper (a fancy taker) sit in an acid bath of hydrogen ions.', when: ch => ch.atoms.length >= 30 },
      { title: 'Electron rush', edu: 'Zn atoms let electrons go; the acid bridge conducts them toward Cu. The first charge leaves the anode.', when: ch => ch.atoms.filter(a => a.q !== 0).length >= 1, max: 6e5 },
      { title: 'Sparks across', edu: 'Charged atoms streak through the bath — the current. In a real cell this flow lights a bulb; here it lights the tracker.', when: ch => ch.atoms.filter(a => a.q !== 0).length >= 5, max: 1.8e6 },
      { title: 'A working cell', edu: 'Zinc-rich and copper-rich patches keep the electron highway open. Battery chemistry is just this handoff, stored in a can.', when: ch => ch.atoms.filter(a => a.q !== 0).length >= 10 || ch.bonds.length >= 12, max: 3.5e6 },
    ],
    goal: 'A charge highway Zn → Cu',
    pick: {
      geo: 'cylinder',                                  // a jar — the two electrode ingots side by side in the acid
      time: { band: 'us', rate: 1.6e4, why: 'microsecond cruise — the charge highway stays readable' },
      presets: [
        { id: 'neuralNet', why: 'alignment is the wire — it chains the electron hop from Zn to Cu' },
        { id: 'quantumFoam', why: 'tunneling hands electrons across the bridge faster' },
        { id: 'off', why: 'pure electrochemistry — the voltaic pile with no assistance' },
      ],
      feed: [
        { id: 'zn', z: 30, n: 1, every: 8e4, start: 2e4, inlet: true, why: 'fresh zinc keeps the anode dissolving' },
        { id: 'cu', z: 29, n: 1, every: 9e4, start: 4e4, inlet: true, why: 'copper tops up the cathode half-cell' },
      ],
    },
  },
  {
    id: 'star', name: 'Stellar Forge', icon: '☀', tag: 'H·He fusion core',
    family: 'physics', desc: 'A million-degree hydrogen core with a laser ramping the squeeze. Watch the lightest element in the universe decide it wants to become the second.',
    setup(ch){
      ch.reset();
      ch.size = 1.7;
      ch.shape = 'sphere';
      ch.setHeat(0.85, 5200);
      ch.laser = 0.9; ch.laserOn = true; ch.laserAxis = 'x';
      ch.spawnGroup(1, 42); ch.spawnGroup(2, 8);
      ch.setRate(4e4);
    },
    steps: [
      { title: 'Protostar cloud', edu: 'Forty-two hydrogen atoms, eight already-helium ones, laser-fanned into a compressed ball. Gravity wants it tighter.', when: ch => ch.atoms.length >= 44 },
      { title: 'Core ignition', edu: 'The furnace + beamline push kinetic energy until electrons are ripped loose — a plasma where nuclei can actually touch.', when: ch => ch.atoms.filter(a => a.q > 0 || a.excited > 0).length >= 4, max: 8e5 },
      { title: 'Element factory', edu: 'Protons that collide hard enough fuse into helium — the star begins forging heavier stuff, layer by layer. Every heavy atom you own was once this.', when: ch => ch.atoms.filter(a => a.q > 0 || a.excited > 0).length >= 14, max: 2e6 },
      { title: 'Main sequence', edu: 'A sustained fusion plasma. The furnace reads as millions of K; the laser keeps the core squeezed. That is our Sun, up close.', when: ch => ch.atoms.filter(a => a.glow > 0 || (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz) > 1e-4).length >= 24, max: 4e6 },
    ],
    goal: 'Sustained fusion plasma',
    pick: {
      geo: 'sphere',                                    // gravity + beam squeeze a molten ball
      time: { band: 'us', rate: 4e4, why: 'microsecond cruise — ignition blooms wavefront to wavefront' },
      presets: [
        { id: 'galactic', why: 'the gravity web IS the star’s own pull holding the core' },
        { id: 'chaos', why: 'everything everywhere — a supernova instead of a main sequence' },
        { id: 'quantumFoam', why: 'zero-point jitter helps barrier-crossing — fusion dropped a notch easier' },
      ],
      feed: [
        { id: 'h', z: 1, n: 6, every: 8e3, start: 0, inlet: true, why: 'hydrogen pours into the fusion core' },
        { id: 'he', z: 2, n: 2, every: 2e4, start: 6e4, inlet: true, why: 'helium ash is recycled back into the burn' },
      ],
    },
  },
  {
    id: 'dew', name: 'Dew Point', icon: '☔', tag: 'vapour · cool · condense',
    family: 'physics', desc: 'Warm humid air meets a cold night and rain sneaks out of it. Watch water vapour condense onto the nearest surfaces — dew, one droplet at a time.',
    setup(ch){
      ch.reset();
      ch.size = 1.9;
      ch.setHeat(0.2, 320);
      ch.spawnGroup(8, 22); ch.spawnGroup(1, 44);
      ch.setRate(1.8e4);
    },
    steps: [
      { title: 'Saturated air', edu: 'Twenty-two water molecules worth of vapour (O + 2 H each) drifting in warm air. Nothing is condensed yet — just steam.', when: ch => ch.atoms.length >= 60 },
      { title: 'First droplet', edu: 'Cool the furnace and the vapour supersaturates; the first O–H cluster condenses into a drop. Dew has begun.', when: ch => waterBonds(ch) >= 2, max: 9e5 },
      { title: 'Beading', edu: 'Drops grow by stealing more vapour. On a cold wall they bead; on grass they bead; here they bead on the chamber.', when: ch => waterBonds(ch) >= 12, max: 2e6 },
      { title: 'Morning rain', edu: 'Half the vapour has condensed into droplets. That puddle on your doorstep is this exact phase change, done overnight.', when: ch => waterBonds(ch) >= 26, max: 4e6 },
    ],
    goal: 'Vapour condensed into droplets',
    pick: {
      geo: 'pyramid',                                   // a cool room — droplets rain onto the sloped floor
      time: { band: 'us', rate: 1.8e4, why: 'microsecond cruise — clouds clear into beads visibly' },
      presets: [
        { id: 'off', why: 'pure vapour pressure — the textbook phase change' },
        { id: 'atomic', why: 'lattice nodes are the dust motes fog condenses on' },
        { id: 'neuralNet', why: 'alignment pulls vapour into chains that rain down' },
      ],
    },
  },
  {
    id: 'gold', name: 'Gold Nanocluster', icon: '◆', tag: 'Au · cage assembly',
    family: 'materials', desc: 'Gold atoms anneal inside a fullerene cage into a gleaming nanocluster — the same self-assembly that makes ligand-protected gold clusters bobble on real benchtops.',
    setup(ch){
      ch.reset();
      ch.size = 1.7;
      ch.setHeat(0.5, 1400);
      ch.spawnGroup(79, 24);
      ch.setRate(3e4);
    },
    steps: [
      { title: 'Gold vapour', edu: 'Twenty-four gold atoms suspended in the cage at 1400 K — gold boils into vapour and stays there, jittering.', when: ch => ch.atoms.length >= 20 },
      { title: 'Nucleation', edu: 'The vapour cools slightly and gold atoms stick on first contact — tiny 2–3-atom seeds form where two solids collide.', when: ch => ch.bonds.length >= 4, max: 1e6 },
      { title: 'Cluster forms', edu: 'Seeds swallow free atoms into a wet drop of metal — the cluster flashes brighter as its lattice grows into regular faces.', when: ch => ch.bonds.length >= 14, max: 2.5e6 },
      { title: 'Bare-faced cluster', edu: 'A faceted gold nanocluster floats in the cage. Cryo-TEM pictures of real nanoclusters look exactly like this glow.', when: ch => ch.bonds.length >= 26, max: 4e6 },
    ],
    goal: 'A faceted Au nanocluster',
    pick: {
      geo: 'cage',                                      // the fullerene protects the cluster — real Au@C₆₀ chemistry
      time: { band: 'ns', rate: 3e4, why: 'nanoseconds per step — seeds nucleate and facets grow in view' },
      presets: [
        { id: 'atomic', why: 'a lattice gives every seed an exact habit to grow' },
        { id: 'quantumFoam', why: 'electron jitter makes the melt a soup — facets pull themselves flat' },
        { id: 'off', why: 'pure annealing — entropy alone finds the cluster' },
      ],
      feed: [
        { id: 'au', z: 79, n: 1, every: 9e4, start: 1e4, inlet: true, why: 'gold atoms assemble the shell' },
        { id: 'au2', z: 79, n: 3, every: 1.4e5, start: 8e4, inlet: true, why: 'a fat pulse of gold to grow the cluster fast' },
      ],
    },
  },
];

export function findExperiment(id){ return EXPERIMENTS.find(e => e.id === id); }
export function oxidePairs(ch){
  let n = 0;
  for (const bd of ch.bonds){
    const az = bd.a.el.z, bz = bd.b.el.z;
    if ((az === 26 && bz === 8) || (az === 8 && bz === 26)) n++;
  }
  return n;
}
export function silicaBonds(ch){
  let n = 0;
  for (const bd of ch.bonds){
    const az = bd.a.el.z, bz = bd.b.el.z;
    if ((az === 14 && bz === 8) || (az === 8 && bz === 14)) n++;
  }
  return n;
}
export function waterBonds(ch){
  let n = 0;
  for (const bd of ch.bonds){
    const az = bd.a.el.z, bz = bd.b.el.z;
    if ((az === 1 && bz === 8) || (az === 8 && bz === 1)) n++;
  }
  return n;
}

/* ---------------- biology helpers (protein / dna / membrane) ----------------
   Residues carry `hyd`: +1 hydrophobic (oil, wants to bury), −1 polar (water).
   The folding metric is radius of gyration of the hyd-labelled chain. */

function buildPeptide(n, spacing){
  const seq = 'HPPHPPHHPPHPPHHPPHPPHHPPHPPHH';
  let ang = this.rng() * Math.PI;
  let px = (this.rng() - 0.5) * 0.6;
  let py = -0.7;
  let pz = (this.rng() - 0.5) * 0.6;
  let prev = null;
  for (let i = 0; i < n; i++){
    const h = seq.charCodeAt(i % seq.length) === 72 ? 1 : -1;
    const z = h > 0 ? 6 : (i % 3 ? 8 : 7);
    ang += 0.45 + this.rng() * 0.55;
    py += spacing * (0.55 + this.rng() * 0.3);
    const a = this.spawn(z, {
      x: px + Math.cos(ang) * spacing * 0.8,
      y: py,
      zz: pz + Math.sin(i * 1.3) * spacing * 0.7,
      temp: 330, hyd: h, label: 'residue',
    });
    if (a){
      a.r = 0.13; a.m = 12;
      a.base = h > 0 ? '#9ad8ff' : '#ffd27f';
      a.color = a.base;
      if (prev) this.addBond(prev, a, { r0: 0.34, k: 0.09, type: 'covalent', meltT: 1400 });
      prev = a; px = a.x; py = a.y; pz = a.zz;
    }
  }
  this.bio.count = n;
}

function buildDna(n, R){
  let prevA = null, prevB = null;
  for (let i = 0; i < n; i++){
    const y = (i - (n - 1) / 2) * 0.24;
    const aA = this.spawn(7, { x: Math.cos(0) * R, y, zz: Math.sin(0) * R, temp: 300, hyd: -1 });
    const aB = this.spawn(7, { x: Math.cos(Math.PI) * R, y, zz: Math.sin(Math.PI) * R, temp: 300, hyd: -1 });
    if (aA){ aA.r = 0.13; aA.m = 14; aA.label = 'strand'; aA.base = '#8f9bff'; aA.color = aA.base; }
    if (aB){ aB.r = 0.13; aB.m = 14; aB.label = 'strand'; aB.base = '#ff8f8f'; aB.color = aB.base; }
    if (aA && prevA) this.addBond(prevA, aA, { r0: 0.3, k: 0.11, type: 'covalent', meltT: 1500 });
    if (aB && prevB) this.addBond(prevB, aB, { r0: 0.3, k: 0.11, type: 'covalent', meltT: 1500 });
    if (aA && aB) this.addBond(aA, aB, { r0: R * 2 * 0.92, k: 0.035, type: 'dna', meltT: 540 });
    prevA = aA; prevB = aB;
  }
  this.bio.rungs0 = n;
}

function buildAmphiphiles(n, tail){
  for (let i = 0; i < n; i++){
    let head = null;
    const dirx = this.rng() - 0.5, diry = this.rng() - 0.5, dirz = this.rng() - 0.5;
    const dl = Math.hypot(dirx, diry, dirz) || 1;
    let px = (this.rng() - 0.5) * 2.6, py = (this.rng() - 0.5) * 2.6, pz = (this.rng() - 0.5) * 2.6;
    const temp = 380;
    for (let t = 0; t <= tail; t++){
      const isHead = t === tail;
      const a = this.spawn(isHead ? 8 : 6, { x: px, y: py, zz: pz, temp, hyd: isHead ? -1 : 1 });
      if (a){
        a.r = 0.13; a.m = 12;
        a.base = isHead ? '#ffb020' : '#7fd8ff';
        a.color = a.base;
        a.label = isHead ? 'head' : 'tail';
        if (head) this.addBond(head, a, { r0: 0.34, k: 0.09, type: 'covalent', meltT: 1600 });
        head = a;
      }
      px += dirx / dl * 0.32; py += diry / dl * 0.32; pz += dirz / dl * 0.32;
    }
  }
}

export function proteinAtoms(ch){
  const out = [];
  for (const a of ch.atoms) if (a.hyd) out.push(a);
  return out;
}

export function measureProtein(ch){
  const list = proteinAtoms(ch);
  const n = list.length;
  if (n < 2) return 1e9;
  let cxs = 0, cys = 0, czs = 0;
  for (const p of list){ cxs += p.x; cys += p.y; czs += p.zz; }
  const inv = 1 / n;
  cxs *= inv; cys *= inv; czs *= inv;
  let s = 0;
  for (const p of list){
    const dx = p.x - cxs, dy = p.y - cys, dz = p.zz - czs;
    s += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(s / n);
}

function proteinR0(ch){ return (ch.bio && ch.bio.r0) || measureProtein(ch); }
function dnaR0(ch){ return (ch.bio && ch.bio.rungs0) || dnaRungs(ch); }
function dnaRungs(ch){
  let n = 0;
  for (const bd of ch.bonds) if (bd.type === 'dna') n++;
  return n;
}

export function bioMaxCluster(ch){
  const seen = new Set();
  let best = 0;
  for (const a of ch.atoms){
    if (!a.hyd || seen.has(a.id)) continue;
    let n = 0;
    const stack = [a];
    seen.add(a.id);
    while (stack.length){
      const p = stack.pop();
      n++;
      for (const bd of p.bonds){
        const q = bd.a === p ? bd.b : bd.a;
        if (!seen.has(q.id)){ seen.add(q.id); if (q.hyd) stack.push(q); }
      }
    }
    if (n > best) best = n;
  }
  return best;
}

function useBeamsOn(ch){
  return ch && ch.beams && ch.beams.some(b => b.on);
}

// quickly-add families for the neat multi-selector
export const FAMILIES = [
  { id: 'alkali', label: 'Alkali metals', zs: [3, 11, 19, 37, 55, 87] },
  { id: 'alkaline', label: 'Alkaline earth', zs: [4, 12, 20, 38, 56, 88] },
  { id: 'trans', label: 'Transition metals', zs: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 72, 73, 74, 75, 76, 77, 78, 79, 80, 104, 105, 106, 107, 108, 109, 110, 111, 112] },
  { id: 'halogens', label: 'Halogens', zs: [9, 17, 35, 53, 85, 117] },
  { id: 'nobles', label: 'Noble gases', zs: [2, 10, 18, 36, 54, 86, 118] },
  { id: 'nonmetals', label: 'Nonmetals', zs: [1, 5, 6, 7, 8, 14, 15, 16, 33, 34, 52] },
  { id: 'lanthanide', label: 'Lanthanides', zs: [57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71] },
  { id: 'actinide', label: 'Actinides', zs: [89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103] },
  { id: 'heavy', label: 'Superheavy (104+)', zs: [104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118] },
  { id: 'precious', label: 'Precious', zs: [44, 45, 46, 47, 76, 77, 78, 79] },
];

// spawn several of each element across the table
Chamber.prototype.spawnAll = function(){
  for (const e of this.data){
    const isRadio = e.z >= 84 || e.cat === 'Actinide';
    this.spawn(e.z, { temp: this.T_target ?? 300 });
  }
};

// quick count pickers: relative abundance illusions for multi-select spawn
export function everydayMixture(ch){
  ch.reset();
  ch.setHeat(0.45, 2200);
  ch.spawnGroup(8, 10); ch.spawnGroup(14, 11); ch.spawnGroup(26, 9); ch.spawnGroup(12, 4);
  ch.spawnGroup(20, 6); ch.spawnGroup(19, 4); ch.spawnGroup(29, 3); ch.spawnGroup(13, 5);
  ch.setRate(4e4);
}

/* ---------- MRI scanner: slice tomography ---------- */
// Samples a channel onto a virtual slice plane swept through the chamber.
//   axis 'x'|'y'|'z' — perpendicular axis of the slice plane
//   pos  [-1, 1]      — plane position along axis as fraction of chamber half-size
//   chan 'density'|'therm'|'charge'|'bonds'
//   G    grid "half" in cells → output w = h = 2*G pixels
export function scanField(ch, opts = {}){
  const axis = String(opts.axis || 'y').charAt(0);
  const pos = clamp(opts.pos ?? 0, -1, 1);
  const chan = opts.chan || 'density';
  const G = Math.max(1, Math.min(1024, (opts.G || 80) | 0));
  const lim = ch.size || 2.4;
  const plane = pos * lim;
  const w = Math.min(2048, G * 2), h = w;
  const data = new Float32Array(w * h);
  const cellSpan = (2 * lim) / G;              // world units along one in-plane cell
  const sigma = cellSpan * 0.9;
  const rad = Math.max(1, Math.ceil((sigma * 3) / cellSpan));
  const k = 2 * rad + 1;
  const s2 = sigma * sigma;
  const kernel = new Float32Array(k * k);
  for (let dy = -rad; dy <= rad; dy++){
    for (let dx = -rad; dx <= rad; dx++){
      kernel[(dy + rad) * k + (dx + rad)] = Math.exp(-(dx * dx + dy * dy) * cellSpan * cellSpan / (2 * s2));
    }
  }
  const pxOf = (c) => {
    const t = (c + lim) / (2 * lim);
    return t <= 0 ? 0 : (t >= 1 ? w - 1 : Math.round(t * (w - 1)));
  };
  const perp = axis === 'x' ? (a) => a.x : (axis === 'z' ? (a) => a.zz : (a) => a.y);
  const uOf  = axis === 'x' ? (a) => a.y : (a) => a.x;
  const vOf  = axis === 'x' ? (a) => a.zz : (axis === 'z' ? (a) => a.y : (a) => a.zz);
  const deposit = (u, v, wgt) => {
    if (!isFinite(wgt) || wgt === 0) return;
    const px = pxOf(u), py = pxOf(v);
    if (px < -k || px > w + k || py < -k || py > h + k) return;
    for (let dy = -rad; dy <= rad; dy++){
      const ny = py + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -rad; dx <= rad; dx++){
        const nx = px + dx;
        if (nx < 0 || nx >= w) continue;
        data[ny * w + nx] += wgt * kernel[(dy + rad) * k + (dx + rad)];
      }
    }
  };
  if (chan === 'bonds'){
    for (const b of ch.bonds){
      const a = b.a, bb = b.b;
      const da = perp(a) - plane, db = perp(bb) - plane;
      let t = 0.5;
      if (da !== db) t = da / (da - db);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      if (Math.abs(da + t * (db - da)) > sigma * 2) continue;
      deposit(
        uOf(a) + t * (uOf(bb) - uOf(a)),
        vOf(a) + t * (vOf(bb) - vOf(a)),
        1
      );
    }
  } else {
    for (const a of ch.atoms){
      if (a.sand) continue;
      const d = perp(a) - plane;
      if (Math.abs(d) > sigma * 3) continue;
      const g = 1 / Math.max(1e-12, 1 + (d * d) / (2 * s2));
      let wgt = g;
      if (chan === 'therm') wgt = g * (0.5 * (a.m || 1) * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz));
      else if (chan === 'charge') wgt = g * (a.q || 0);
      deposit(uOf(a), vOf(a), wgt);
    }
  }
  return { axis, pos, chan, lim, w, h, data };
}

/* ---------- orbital slice (rotated projection) ---------- */
// Samples a plane whose normal spins around the Z axis; ang=0 matches axis 'x'
// (normal +X), ang=90 matches axis 'y' (normal +Y). Plane passes through the
// container centre (pos 0) — a rotating projector, not a translator.
export function orbitField(ch, opts = {}){
  const ang = (Number(opts.ang) || 0) * Math.PI / 180;
  const chan = opts.chan || 'density';
  const G = Math.max(1, Math.min(1024, (opts.G || 80) | 0));
  const lim = ch.size || 2.4;
  const w = Math.min(2048, G * 2), h = w;
  const data = new Float32Array(w * h);
  const cellSpan = (2 * lim) / G;
  const sigma = cellSpan * 0.9;
  const rad = Math.max(1, Math.ceil((sigma * 3) / cellSpan));
  const k = 2 * rad + 1;
  const s2 = sigma * sigma;
  const kernel = new Float32Array(k * k);
  for (let dy = -rad; dy <= rad; dy++){
    for (let dx = -rad; dx <= rad; dx++){
      kernel[(dy + rad) * k + (dx + rad)] = Math.exp(-(dx * dx + dy * dy) * cellSpan * cellSpan / (2 * s2));
    }
  }
  const n  = { x: Math.sin(ang), y: Math.cos(ang), z: 0 };   // plane normal
  const e1 = { x: Math.cos(ang), y: -Math.sin(ang), z: 0 };  // in-plane "u"
  const e2 = { x: 0, y: 0, z: 1 };                            // in-plane "v"
  const pxOf = (c) => {
    const t = (c + lim) / (2 * lim);
    return t <= 0 ? 0 : (t >= 1 ? w - 1 : Math.round(t * (w - 1)));
  };
  const deposit = (u, v, wgt) => {
    if (!isFinite(wgt) || wgt === 0) return;
    const px = pxOf(u), py = pxOf(v);
    if (px < -k || px > w + k || py < -k || py > h + k) return;
    for (let dy = -rad; dy <= rad; dy++){
      const ny = py + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -rad; dx <= rad; dx++){
        const nx = px + dx;
        if (nx < 0 || nx >= w) continue;
        data[ny * w + nx] += wgt * kernel[(dy + rad) * k + (dx + rad)];
      }
    }
  };
  if (chan === 'bonds'){
    for (const b of ch.bonds){
      const a = b.a, bb = b.b;
      const dot = (p) => p.x * n.x + p.y * n.y + p.z * n.z;
      const da = dot(a), db = dot(bb);
      let t = 0.5;
      if (da !== db) t = da / (da - db);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      if (Math.abs(da + t * (db - da)) > sigma * 2) continue;
      const ax = a.x + t * (bb.x - a.x), ay = a.y + t * (bb.y - a.y), az = a.zz + t * (bb.zz - a.zz);
      deposit(ax * e1.x + ay * e1.y, az, 1);
    }
  } else {
    for (const a of ch.atoms){
      if (a.sand) continue;
      const d = a.x * n.x + a.y * n.y;
      if (Math.abs(d) > sigma * 3) continue;
      const g = 1 / Math.max(1e-12, 1 + (d * d) / (2 * s2));
      let wgt = g;
      if (chan === 'therm') wgt = g * (0.5 * (a.m || 1) * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz));
      else if (chan === 'charge') wgt = g * (a.q || 0);
      const u = a.x * e1.x + a.y * e1.y;
      deposit(u, a.zz, wgt);
    }
  }
  return { axis: 'orbit', ang: ang * 180 / Math.PI, chan, lim, w, h, data };
}

/* ---------- cross-lab stack mode ---------- */
// Merges several cross presets' field strengths into one live combo.
// The presets share the same scalar keys (applied by applyCrossFields), so
// stacking takes the max contribution for each force — a physically coherent union.
export function mergeStackFields(ids){
  const out = { enabled: Array.isArray(ids) && ids.length > 0 };
  if (!Array.isArray(ids)) return out;
  for (const id of ids){
    const p = CROSS_PRESETS.find(x => x.id === id);
    if (!p || p.id === 'off') continue;
    for (const key in p.fields){
      if (key === 'enabled') continue;
      const v = p.fields[key];
      out[key] = out[key] == null ? v : Math.max(out[key], v);
    }
  }
  return out;
}