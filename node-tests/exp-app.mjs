import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Chamber, EXPERIMENTS, ENVIRONMENTS, envDefault, CROSS_PRESETS, MACHINES, FAMILIES, SHAPES, SHAPE_IDS, CHLADNI_MODES, plateWave, shapeClampPoint, shapeInnerPoint, torusKnotPoint, torusKnotPointC, knotParams, gyroidVal, HELIX_TUBE, findExperiment, fmtFancyTime, RATE_TICKS, clamp, mix, everydayMixture, mulberry, scanField, orbitField, mergeStackFields, KNOTS, TIME_BANDS, timeBandRate, agitateSand } from './exp-core.mjs';
import { rgbaToGif } from './gif-enc.mjs';

const DATA = window.ELEMENTS_DATA || [];
const S = 1.5;
const elByZ = new Map(DATA.map(e => [e.z, e]));
const TRACK_COLORS = ['#37c8ff', '#59ff9c', '#ffb020', '#ff5b5b', '#c38bff', '#ff77d9', '#83ff5b', '#ff8f4d'];
const _projV = new THREE.Vector3();
const SUB = '₀₁₂₃₄₅₆₇₈₉';

const IS_REAL = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const LABS = {
  name: 'Aarkanum Laboratories',
  short: 'Aarkanum Labs',
  key: 'aarkanum-laboratories',
  fn: 'aar',
  format: 'aarkanum-laboratories/experiment@1',
  agent: 'unknown',
};

const app = {
  ch: null,
  running: true,
  cur: null,
  stepIdx: new Map(),
  stepShown: {},
  nodes: new Map(),
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  modal: null,
  modalNode: null,
  selZ: new Set(),
  crossLab: null,
  _modalOpen: false,
  gridOn: false,            // experiment menu (▦) is open
  _trackOn: true,           // cluster-tracking overlay
  _track: new Map(),        // tracked clusters: id → { box, ats, bonds, bondsT, n, conf, color, … }
  _trackNext: 1,
  _inFlights: new Map(),    // feeder-inlet fly-ins: atomId → { fx, fy, fz, t0 } (mesh birth animation)
  _trackPtr: null,          // pointer screen px for hover (set by pointermove)
  _trackPinned: null,       // cluster id pinned open by a tap on its tracker ring
  _lastBoxes: [],
  _hiddenEls: [],           // reusable overlay box elements (display:none pool)
};

const canvas = document.getElementById('lab');
const wrap = document.getElementById('labWrap');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x05070f, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(6.2, 4.4, 6.2);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 60;

scene.add(new THREE.AmbientLight(0x334, 0.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(5, 9, 3);
scene.add(keyLight);
const furnaceLight = new THREE.PointLight(0xff7722, 0.6, 30, 2);
furnaceLight.position.set(0, -3.4, 0);
scene.add(furnaceLight);

let chamberBox = null;
let innerCage = null;
let inletPorts = null;              // 3D feeder-inlet gate: ring + lens on the entry face
const beamMeshes = [];           // shared pool — one probe cylinder per beam bank slot
let nodesGroup = null;
let bondsMesh = null;
const bondsGeo = new THREE.BufferGeometry();
const bondPos = new Float32Array(2048 * 2 * 3);
const bondCol = new Float32Array(2048 * 2 * 3);
const bondIdx = new Uint16Array(2048 * 2);
bondsGeo.setAttribute('position', new THREE.BufferAttribute(bondPos, 3).setUsage(THREE.DynamicDrawUsage));
bondsGeo.setAttribute('color', new THREE.BufferAttribute(bondCol, 3).setUsage(THREE.DynamicDrawUsage));
bondsGeo.setIndex(new THREE.BufferAttribute(bondIdx, 1));
bondsGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
bondsMesh = new THREE.LineSegments(bondsGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
bondsMesh.frustumCulled = false;
bondsMesh.renderOrder = 2;

const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending });
const beamSourceMeshes = [];    // emitter lens mounted on the wall each beam fires from
const beamFootMeshes = [];      // bright footprint burned on the far wall each beam hits
const laserBoxMeshes = [];      // 3D wireframe laser-head casing at each emitter
const LASER_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

const sphereGeo = new THREE.SphereGeometry(1, 28, 22);
// Chladni sand: small flattened grains (like fine sand lying on a plate), warmed
// quartz tint — distinct from the element spheres so the sound-plate figure reads
// as a real sand coating instead of a bunch of element-colored beads.
const sandGeo = new THREE.SphereGeometry(1, 12, 9);
let sandMat = null;
function getSandMat(){
  if (!sandMat) sandMat = new THREE.MeshLambertMaterial({ color: 0xd8b46a, emissive: 0x8a6a2a });
  return sandMat;
}
const lineFog = new THREE.FogExp2(0x05070f, 0.035);
scene.fog = lineFog;

function resize(){
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (scanPlane) updateScanPlane();
  relayoutCrossWall();
}

let chamberFloor = null;
function buildChamber(){
  clearStrikeRings();
  if (chamberBox){ scene.remove(chamberBox); chamberBox.geometry.dispose(); chamberBox = null; }
  if (innerCage){ scene.remove(innerCage); innerCage.geometry.dispose(); innerCage = null; }
  const h = app.ch.size;
  const m = new THREE.LineSegments(
    chamberWireGeom(app.ch.shape || 'cube', h),
    new THREE.LineBasicMaterial({ color: 0x3d5bbf, transparent: true, opacity: 0.85 })
  );
  chamberBox = m;
  scene.add(chamberBox);
  const wi = app.ch.wallInset != null ? app.ch.wallInset : 0.12;
  // inner skin-shell: the boundary atom bodies can never cross (soft-wall inset)
  innerCage = new THREE.LineSegments(
    chamberWireGeom(app.ch.shape || 'cube', Math.max(0.1, h - wi)),
    new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.38 })
  );
  innerCage.userData.gutter = 'innerCage';
  scene.add(innerCage);
  const hx = h * S;
  if (chamberFloor){ scene.remove(chamberFloor); chamberFloor.geometry.dispose(); chamberFloor.material.dispose(); chamberFloor = null; }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hx * 2), new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.03 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -hx;
  floor.name = 'furnace';
  chamberBox.add(floor);
  chamberFloor = floor;
  if (beamMeshes.length){
    for (const m of beamMeshes){ scene.remove(m); m.geometry.dispose(); }
    beamMeshes.length = 0;
  }
  for (let i = 0; i < 12; i++){
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hx * 2, 10), glowMat);
    b.rotation.z = Math.PI / 2;
    b.visible = false;
    b.name = 'beam' + i;
    scene.add(b);
    beamMeshes.push(b);
  }
  while (beamSourceMeshes.length){
    const m = beamSourceMeshes.pop();
    if (m){ scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }
  }
  while (beamFootMeshes.length){
    const m = beamFootMeshes.pop();
    if (m){ scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }
  }
  while (laserBoxMeshes.length){
    const m = laserBoxMeshes.pop();
    if (m){ scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }
  }
  for (let i = 0; i < 12; i++){
    const src = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), glowMat.clone());
    src.scale.setScalar(0.1);
    src.visible = false;
    src.name = 'beamSrc' + i;
    scene.add(src);
    beamSourceMeshes.push(src);
    const foot = new THREE.Mesh(new THREE.CircleGeometry(1, 18), glowMat.clone());
    foot.scale.setScalar(0.1);
    foot.visible = false;
    foot.name = 'beamFoot' + i;
    scene.add(foot);
    beamFootMeshes.push(foot);
    const head = new THREE.LineSegments(LASER_BOX_GEO.clone(), new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.9 }));
    head.visible = false;
    head.name = 'laserHead' + i;
    scene.add(head);
    laserBoxMeshes.push(head);
  }
  if ((app.ch.shape || 'cube') === 'plate') addPlateSlab(h, hx);
}

let plateSlab = null;
function addPlateSlab(h, hx){
  if (plateSlab){ scene.remove(plateSlab); plateSlab.geometry.dispose(); plateSlab.material.dispose(); plateSlab = null; }
  const half = h * 0.22 * S;
  plateSlab = new THREE.Mesh(
    // segmented so the drive admittance can ripple the faces into the standing-wave figure
    new THREE.BoxGeometry(hx * 2, half * 2, hx * 2, 28, 2, 28),
    new THREE.MeshLambertMaterial({ color: 0x7788cc, transparent: true, opacity: 0.16, depthWrite: false, emissive: 0x10142c })
  );
  plateSlab.userData.chladni = true;
  plateSlab.userData.basePos = (plateSlab.geometry.attributes.position.array) ? new Float32Array(plateSlab.geometry.attributes.position.array) : null;
  scene.add(plateSlab);
}
function removePlateSlab(){ if (plateSlab){ scene.remove(plateSlab); plateSlab.geometry.dispose(); plateSlab = null; } }

// 3D feeder-inlet gate: the loader port the timed feeder pours new atoms
// through (a glowing ring + lens on the entry face, facing into the chamber).
function syncInletPorts(){
  const ch = app.ch;
  if (!ch) return;
  const show = !!(ch.feed && ch.feed.some(s => s.enabled && s.inlet));
  if (!show){ if (inletPorts) inletPorts.visible = false; return; }
  if (!inletPorts){
    inletPorts = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.04, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x37c8ff, transparent: true, opacity: 0.65 })
    );
    ring.name = 'feedInletRing';
    const lens = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.5, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x37c8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    lens.name = 'feedInletLens';
    inletPorts.add(ring);
    inletPorts.add(lens);
    scene.add(inletPorts);
  }
  const ring = inletPorts.children[0], lens = inletPorts.children[1];
  const h = ch.size;
  const ax = (ch.Edir || 'z') === 'x' ? 'x' : 'z';
  if (ax === 'x'){
    inletPorts.position.set(-h * 0.97, 0, 0);
    inletPorts.rotation.set(0, Math.PI / 2, 0);
  } else {
    inletPorts.position.set(0, 0, -h * 0.97);
    inletPorts.rotation.set(0, 0, 0);
  }
  ring.position.set(0, 0, 0.6);
  lens.position.set(0, 0, 0.62);
  lens.rotation.set(Math.PI / 2, 0, 0);   // point into the chamber
  inletPorts.visible = true;
}

// parametric wireframe of the chamber geometry, in three-space (x S applied later inside)
// dense surface graticule: lines along every subdivision so the boundary reads as a solid cage
function chamberWireGeom(shape, h){
  const H = h * S;
  const pts = [];
  const D = 6;                            // subdivision density (subdivided grid lines)
  const NF = 24;                          // ring / meridian resolution
  function line(a, b){ pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
  function ring(cx, r, y, n = NF){ const out = []; for (let i = 0; i < n; i++){ const t = i / n * Math.PI * 2; out.push([cx + Math.cos(t) * r, y, Math.sin(t) * r]); } return out; }
  function ell(cxr, czr, y, n = NF){ const out = []; for (let i = 0; i < n; i++){ const t = i / n * Math.PI * 2; out.push([Math.cos(t) * cxr, y, Math.sin(t) * czr]); } return out; }
  function zip(loops){ for (const ring of loops){ const n = ring.length; for (let i = 0; i < n; i++){ const a = ring[i], b = ring[(i + 1) % n]; line(a, b); } } }
  // latitude rings + meridians for the sphere family, scaled per axis
  function graticule(a, b, c){
    for (let i = 1; i < D; i++){ const col = i / D * Math.PI; const y = -b * Math.cos(col); const rr = Math.sin(col); zip([ell(a * rr, c * rr, y)]); }
    const V = 8;
    for (let i = 0; i < NF; i++){
      const th = i / NF * Math.PI * 2 + 1e-6;
      for (let j = 0; j < V; j++){
        const p0 = j / V * Math.PI - Math.PI / 2, p1 = (j + 1) / V * Math.PI - Math.PI / 2;
        line([a * Math.cos(th) * Math.cos(p0), b * Math.sin(p0), c * Math.sin(th) * Math.cos(p0)],
             [a * Math.cos(th) * Math.cos(p1), b * Math.sin(p1), c * Math.sin(th) * Math.cos(p1)]);
      }
    }
  }
  function squareRing(w, y){
    return [[-w, y, -w], [w, y, -w], [w, y, w], [-w, y, w]];
  }
  switch (shape){
    case 'cube': {
      const s = H;
      for (let i = 0; i <= D; i++){
        const u = -s + (2 * s * i) / D;
        for (let j = 0; j <= D; j++){
          const v = -s + (2 * s * j) / D;
          line([-s, u, v], [s, u, v]);
          line([u, -s, v], [u, s, v]);
          line([u, v, -s], [u, v, s]);
        }
      }
      break;
    }
    case 'cylinder': {
      for (let i = 0; i <= D; i++){ const y = -H + (2 * H * i) / D; zip([ring(0, H, y)]); }
      for (let i = 0; i < NF; i++){ const t = i / NF * Math.PI * 2; const cx = Math.cos(t) * H, cz = Math.sin(t) * H; line([cx, -H, cz], [cx, H, cz]); }
      break;
    }
    case 'sphere': graticule(H, H, H); break;
    case 'ellipsoid': graticule(H * 1.15, H * 0.8, H * 1.15); break;
    case 'cone': {
      zip([ring(0, H, -H)]);
      for (let i = 1; i <= D; i++){ const y = -H + (2 * H * i) / D; const w = Math.max(0.001, (H - y) / 2); zip([ring(0, w, y)]); }
      for (let i = 0; i < NF; i++){ const t = i / NF * Math.PI * 2; line([0, H, 0], [Math.cos(t) * H, -H, Math.sin(t) * H]); }
      break;
    }
    case 'pyramid': {
      zip([squareRing(H, -H)]);
      for (let i = 1; i <= D; i++){ const y = -H + (2 * H * i) / D; const w = Math.max(0.001, (H - y) / 2); zip([squareRing(w, y)]); }
      for (const p of squareRing(H, -H)) line([0, H, 0], p);
      break;
    }
    case 'torus': {
      const R = H * 0.72, r = H * 0.34;
      const C0 = NF, U1 = 14;
      const p0 = (th, u) => [(R + r * Math.cos(u)) * Math.cos(th), r * Math.sin(u), (R + r * Math.cos(u)) * Math.sin(th)];
      for (let ci = 0; ci < C0; ci++){
        const th = ci / C0 * Math.PI * 2, th2 = (ci + 1) % C0 / C0 * Math.PI * 2;
        for (let ui = 0; ui < U1; ui++){
          const u = ui / U1 * Math.PI * 2, u2 = (ui + 1) % U1 / U1 * Math.PI * 2;
          line(p0(th, u), p0(th2, u));
          line(p0(th, u), p0(th, u2));
        }
      }
      break;
    }
    case 'helix': {
      const C0 = NF, U1 = 12;
      const p0 = (t, u) => { const c = torusKnotPoint(t, h, u); return [c[0] * S, c[1] * S, c[2] * S]; };
      for (let ci = 0; ci < C0; ci++){
        const th = ci / C0 * Math.PI * 2, th2 = (ci + 1) % C0 / C0 * Math.PI * 2;
        for (let ui = 0; ui < U1; ui++){
          const u = ui / U1 * Math.PI * 2, u2 = (ui + 1) % U1 / U1 * Math.PI * 2;
          line(p0(th, u), p0(th2, u));
          line(p0(th, u), p0(th, u2));
        }
      }
      break;
    }
    case 'rose':
    case 'crown':
    case 'spire': {
      const kp = knotParams(shape) || { P: 2, Q: 5 };
      const C0 = NF * 2, U1 = 12;
      const p0 = (t, u) => { const c = torusKnotPointC(t, h, u, kp.P, kp.Q); return [c[0] * S, c[1] * S, c[2] * S]; };
      for (let ci = 0; ci < C0; ci++){
        const th = ci / C0 * Math.PI * 2, th2 = (ci + 1) % C0 / C0 * Math.PI * 2;
        for (let ui = 0; ui < U1; ui++){
          const u = ui / U1 * Math.PI * 2, u2 = (ui + 1) % U1 / U1 * Math.PI * 2;
          line(p0(th, u), p0(th2, u));
          line(p0(th, u), p0(th, u2));
        }
      }
      break;
    }
    case 'gyroid': {
      const N = 26, SL = 10;
      const rCap = h * 0.97;
      const okPt = (X, Y, Z) => X * X + Y * Y + Z * Z <= rCap * rCap;
      // iso-contours of G=0 woven across the three axis-plane families: the
      // cubic lattice of the gyroid mid-surface reads as a woven minimal cage.
      const drawContours = (i, j, k) => {
        for (let sl = 0; sl < SL; sl++){
          const lv = -H + (2 * H * sl) / (SL - 1);
          for (let row = 0; row <= N; row++){
            const bv = -H + (2 * H * row) / N;
            const cross = [];
            for (let a = 0; a < N; a++){
              const av = -H + (2 * H * a) / N, av2 = -H + (2 * H * (a + 1)) / N;
              const P = [0, 0, 0];
              P[k] = lv; P[j] = bv;
              P[i] = av;
              const g0 = gyroidVal(P[0] / S, P[1] / S, P[2] / S, h);
              P[i] = av2;
              const g1 = gyroidVal(P[0] / S, P[1] / S, P[2] / S, h);
              if (Math.sign(g0) !== Math.sign(g1)){
                const t = g0 / (g0 - g1);
                P[i] = av + (av2 - av) * t;
                if (okPt(P[0] / S, P[1] / S, P[2] / S)) cross.push([P[0], P[1], P[2]]);
              }
            }
            for (let m = 0; m + 1 < cross.length; m += 2) line(cross[m], cross[m + 1]);
          }
        }
      };
      drawContours(0, 1, 2);
      drawContours(1, 0, 2);
      drawContours(2, 0, 1);
      break;
    }
    case 'cage': {
      const R = h * 0.82 * S, t = Math.max(0.12, h * 0.26) * S;
      graticule(R - t, R - t, R - t);
      graticule(R + t, R + t, R + t);
      const NS = 8;
      for (let i = 0; i < NS; i++){
        const th = i / NS * Math.PI * 2;
        for (let j = 1; j < NS; j++){
          const ph = j / NS * Math.PI - Math.PI / 2;
          const dx = Math.cos(th) * Math.cos(ph), dy = Math.sin(ph), dz = Math.sin(th) * Math.cos(ph);
          line(dx * (R - t), dy * (R - t), dz * (R - t), dx * (R + t), dy * (R + t), dz * (R + t));
        }
      }
      break;
    }
    case 'plate': {
      const t = H * 0.22;
      for (const y of [-t, t]){
        for (let i = 0; i <= D; i++){
          const u = -H + (2 * H * i) / D;
          line([-H, y, u], [H, y, u]);
          line([u, y, -H], [u, y, H]);
        }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) line([sx * H, -t, sz * H], [sx * H, t, sz * H]);
      break;
    }
    case 'cube-dense':
    default: {
      const s = H;
      for (let i = 0; i <= D; i++) for (let j = 0; j <= D; j++){
        const u = -s + (2 * s * i) / D, v = -s + (2 * s * j) / D;
        line([-s, u, v], [s, u, v]); line([u, -s, v], [u, s, v]); line([u, v, -s], [u, v, s]);
      }
      break;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

const matCache = new Map();
const _matGlow = new THREE.Color();
function sharedMat(a){
  const key = a.el.cpk || a.el.s;
  if (!matCache.has(key)){
    const c = new THREE.Color(...a.base);
    _matGlow.copy(c).multiplyScalar(0.24);
    // Sphere bodies, glossy: a faint emissive lift keeps particles readable
    // against the dark chamber, and a cool specular sell the "solid droplet" look.
    matCache.set(key, new THREE.MeshPhongMaterial({
      color: c,
      specular: 0x556677,
      shininess: 34,
      emissive: _matGlow.getHex(),
    }));
  }
  return matCache.get(key);
}

function addNodeMesh(a){
  if (!nodesGroup) return null;
  const m = new THREE.Mesh(a.sand ? sandGeo : sphereGeo, a.sand ? getSandMat() : sharedMat(a));
  m.scale.setScalar(S * a.r * (a.sand ? 2.1 : 1));
  m.userData = { atomId: a.id };
  // pin the visual to the internal cage: the particle body must sit inside the
  // live geometry boundary, not just the seed position, when injected or moved
  const ch = app.ch;
  const pad = (ch.wallInset || 0.12) + a.r;
  if (ch.contains && !ch.contains(a.x, a.y, a.zz, pad)){
    const p = shapeInnerPoint(ch, a.x, a.y, a.zz, pad);
    a.x = p[0]; a.y = p[1]; a.zz = p[2];
  }
  m.position.set(a.x * S, a.y * S, a.zz * S);
  nodesGroup.add(m);
  app.nodes.set(a.id, m);
  return m;
}

function rebuildNodes(){
  if (app.ch.atoms.length === 0){ if (nodesGroup) nodesGroup.clear(); app.nodes.clear(); app._inFlights.clear(); return; }
  const live = new Set(app.ch.atoms.map(a => a.id));
  for (const id of [...app.nodes.keys()]){
    if (!live.has(id)){ const m = app.nodes.get(id); m.geometry.dispose(); m.material = undefined; nodesGroup.remove(m); app.nodes.delete(id); app._inFlights.delete(id); }
  }
  const have = new Set(app.nodes.keys());
  for (const a of app.ch.atoms){
    if (!have.has(a.id)) addNodeMesh(a);
  }
}

const baseColorCache = new Map();
const _scratchColor = new THREE.Color();
const _exciteColor = new THREE.Color(1, 0.9, 0.4);
const _reactColor = new THREE.Color(0.5, 1.0, 0.6);
function nodeColor(a){
  let base = baseColorCache.get(a.el.s);
  if (!base){ base = new THREE.Color(...a.base); baseColorCache.set(a.el.s, base); }
  const c = _scratchColor.copy(base);
  if (a.fixed){ c.multiplyScalar(0.55); }
  else {
    const s = a.stateT === 'liquid' ? 1.25 : a.stateT === 'gas' ? 1.45 : a.stateT === 'plasma' ? 1.7 : 1;
    c.multiplyScalar(s);
  }
  if (a.excited > 0 || a.glow > 0){ c.lerp(_exciteColor, 0.55); }
  if (a.reacted) c.lerp(_reactColor, 0.4);
  return c;
}

const STRIKE_RING_CAP = 28;
const strikeRings = [];
let ringGroup = null;
const _ringGeo = new THREE.RingGeometry(0.9, 1.0, 28);
const _ringFree = [];

function clearStrikeRings(){
  if (ringGroup){ scene.remove(ringGroup); ringGroup = null; }
  for (const s of strikeRings){ _ringFree.push({ mesh: s.mesh, mat: s.mesh.material }); }
  strikeRings.length = 0;
}

function spawnRing(x, y, z, r){
  let ent = _ringFree.pop();
  if (!ent){
    ent = {
      mesh: new THREE.Mesh(_ringGeo, new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
      mat: null,
    };
  }
  const mesh = ent.mesh;
  if (strikeRings.length >= STRIKE_RING_CAP){ const old = strikeRings.shift(); if (ringGroup) ringGroup.remove(old.mesh); _ringFree.push({ mesh: old.mesh, mat: old.mesh.material }); }
  if (!ringGroup){ ringGroup = new THREE.Group(); scene.add(ringGroup); }
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(Math.max(0.05, r * 1.4));
  mesh.material.opacity = 0.9;
  ringGroup.add(mesh);
  strikeRings.push({ mesh, life: 1, base: Math.max(0.05, r * 1.4) });
}

function updateStrikeRings(dt){
  if (!ringGroup) return;
  for (let i = strikeRings.length - 1; i >= 0; i--){
    const s = strikeRings[i];
    s.life -= dt * 0.0028;
    if (s.life <= 0){
      ringGroup.remove(s.mesh);
      _ringFree.push({ mesh: s.mesh, mat: s.mesh.material });
      strikeRings.splice(i, 1);
      continue;
    }
    const k = 1 - s.life;
    s.mesh.scale.setScalar(s.base * (1 + k * 10));
    s.mesh.material.opacity = Math.max(0, s.life * 0.85);
    s.mesh.lookAt(camera.position);
  }
  if (strikeRings.length === 0){
    scene.remove(ringGroup);
    ringGroup = null;
  }
}

function updateNodes(dtMs){
  if (!nodesGroup) return;
  const now = performance.now();
  let i = 0;
  for (const a of app.ch.atoms){
    let m = app.nodes.get(a.id);
    if (!m){
      m = addNodeMesh(a);                  // meshes for atoms injected mid-run (feeder, beams, decay)
      if (m) m.userData.born = now;
      if (!m) continue;
    }
    if (a._inletFrom){
      // new atoms ride in from the feeder inlet port instead of materialising inside
      let fl = app._inFlights.get(a.id);
      if (!fl){ fl = { fx: a._inletFrom.x * S, fy: a._inletFrom.y * S, fz: a._inletFrom.z * S, t0: now }; app._inFlights.set(a.id, fl); }
      const k = clamp((now - fl.t0) / 350, 0, 1);
      const kk = 1 - (1 - k) * (1 - k);
      m.position.set(fl.fx + (a.x * S - fl.fx) * kk, fl.fy + (a.y * S - fl.fy) * kk, fl.fz + (a.zz * S - fl.fz) * kk);
      if (k >= 1){ delete a._inletFrom; app._inFlights.delete(a.id); }
    } else if (a.sand && plateSlab && plateSlab.visible){
      // ride the chladni plate's rippling top face so grains track the standing wave
      const chL = Math.max(0.1, app.ch.size);
      const md = app.ch.mode || { m: 2, n: 2 };
      const wx = a.x / chL, wz = a.zz / chL;
      const wave = Math.cos(Math.PI * md.m * wx) * Math.cos(Math.PI * md.n * wz);
      const half = chL * 0.22;
      const amp = (app.ch.drive || 0) * 0.4 * half;
      const taper = Math.max(0, 1 - Math.abs(wx)) * Math.max(0, 1 - Math.abs(wz));
      m.position.set(a.x * S, (half + wave * amp * taper + a.r) * S, a.zz * S);
    } else {
      m.position.set(a.x * S, a.y * S, a.zz * S);
    }
    const hit = a.wallHit || 0;
    const born = m.userData.born || 0;
    const age = born ? now - born : 9e9;
    const pop = age < 220 ? 1 - (1 - age / 220) * (1 - age / 220) : 1;   // birth pop: fade in from a seed
    const baseScale = S * a.r * (a.sand ? 2.1 : 1) * (1 + 0.45 * hit) * Math.max(0.12, pop);
    if (Math.abs(m.scale.x - baseScale) > 1e-6) m.scale.setScalar(baseScale);
    if (a.glow > 0 || hit > 0){
      if (!m.userData.glow){
        m.material = nodesGlowMaterial(a);
        m.userData.glow = 1;
      }
      if (hit > 0 && (a._prevHit === undefined || a._prevHit <= 0)) spawnRing(a.x * S, a.y * S, a.zz * S, a.r * S);
    } else {
      if (m.userData.glow){
        m.material = a.sand ? getSandMat() : matCache.get(a.el.cpk || a.el.s);
        m.userData.glow = 0;
      }
      if (!a.sand){
        const c = nodeColor(a);
        m.material.color.copy(c);
      }
    }
    a._prevHit = hit;
    i++;
  }
}

let glowCache = new Map();
function nodesGlowMaterial(a){
  const key = a.el.s;
  if (glowCache.has(key)) return glowCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...a.base), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  m.userData.glow = 1;
  glowCache.set(key, m);
  return m;
}

function updateBonds(){
  const n = app.ch.bonds.length;
  let j = 0;
  for (let i = 0; i < n; i++){
    const bd = app.ch.bonds[i];
    if (j + 2 > bondPos.length / 3) break;
    const a = bd.a, b = bd.b;
    bondPos[j * 3] = a.x * S; bondPos[j * 3 + 1] = a.y * S; bondPos[j * 3 + 2] = a.zz * S;
    j++;
    bondPos[j * 3] = b.x * S; bondPos[j * 3 + 1] = b.y * S; bondPos[j * 3 + 2] = b.zz * S;
    j++;
  }
  const col = bdColor;
  for (let k = 0; k < n * 2; k += 2){
    bondCol[k * 3] = col[0]; bondCol[k * 3 + 1] = col[1]; bondCol[k * 3 + 2] = col[2];
    bondCol[(k + 1) * 3] = col[0]; bondCol[(k + 1) * 3 + 1] = col[1]; bondCol[(k + 1) * 3 + 2] = col[2];
  }
  bondsGeo.setDrawRange(0, j);
  bondsGeo.attributes.position.needsUpdate = true;
  bondsGeo.attributes.color.needsUpdate = true;
  bondsMesh.visible = j > 0;
}
const bdColor = [0.9, 0.7, 0.4];

function updateExtras(){
  const h = app.ch.size;
  const hs = h * S * 2.2;
  const beams = (app.ch && app.ch.beams) || [];
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  for (let i = 0; i < beamMeshes.length; i++){
    const beam = beamMeshes[i];
    let on = false;
    if (i < beams.length){
      const b = beams[i];
      if (b && b.on && b.power > 0.05){
        on = true;
        const type = b.type || 'ray';
        const spot = Math.min(0.5, Math.max(0.05, b.spot || 0.16));
        const rad = (spot / 0.16) * (type === 'flood' ? 2.4 : type === 'trap' ? 1.5 : 1);
        const t = b.power;
        // pulse: strobe the volume in time — on for the burst window, off between
        let strobe = 1;
        if (type === 'pulse'){
          const freq = Math.max(1, Math.min(12, (b.rate || 10) / 10));
          strobe = (now % (1000 / freq)) < (1000 / freq) * 0.4 ? 1 : 0.06;
        }
        const sc = (1 + t * 0.4) * strobe;
        beam.scale.set((1 + t * 0.4) * rad * (type === 'pulse' ? 1 + (strobe > 0.9 ? 0.35 : 0) : 1), hs, (1 + t * 0.4) * rad * (type === 'pulse' ? 1 + (strobe > 0.9 ? 0.35 : 0) : 1));
        const m = beam.material;
        if (type === 'pulse') m.color.setRGB(0.45 + 0.55 * t, 0.75 + 0.25 * t, 1);
        else if (type === 'trap') m.color.setRGB(0.35 + 0.5 * t, 1, 0.5);
        else if (type === 'flood') m.color.setRGB(1, 0.55 + 0.3 * t, 0.12);
        else m.color.setRGB(0.55 + 0.4 * t, 0.9 - 0.55 * t, 0.2);
        m.opacity = (type === 'pulse' ? 0.10 + 0.34 * t : type === 'flood' ? 0.05 + 0.18 * t : type === 'trap' ? 0.04 + 0.14 * t : 0.08 + 0.28 * t) * strobe;
        const ud = beamDirVec(b);
        const uv = new THREE.Vector3(ud[0], ud[1], ud[2]);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), uv);
        const o = [b.offx || 0, b.offy || 0, b.offz || 0];
        beam.position.set(o[0], o[1], o[2]);
        // emitter lens on the wall the beam leaves + footprint it burns on the far wall
        const mount = h * S * 1.05;
        const src = beamSourceMeshes[i];
        const foot = beamFootMeshes[i];
        if (src){
          src.position.set(o[0] - ud[0] * mount, o[1] - ud[1] * mount, o[2] - ud[2] * mount);
          src.scale.setScalar((0.16 + 0.3 * t) * (spot / 0.16) * (type === 'flood' ? 1.7 : 1));
          const sm = src.material;
          sm.color.copy(m.color);
          sm.opacity = 0.5 * strobe * t;
          src.visible = true;
        }
        if (foot){
          foot.position.set(o[0] + ud[0] * mount, o[1] + ud[1] * mount, o[2] + ud[2] * mount);
          foot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), uv);
          const fr = spot / 0.16;
          foot.scale.setScalar(0.5 * fr * (type === 'flood' ? 2.6 : type === 'trap' ? 0.55 : 1) * (0.6 + 0.5 * t));
          const fm = foot.material;
          fm.color.copy(m.color);
          fm.opacity = 0.32 * t * strobe;
          foot.visible = true;
        }
        // 3D laser-head wireframe casing around the emitter, gated by settings
        const head = laserBoxMeshes[i];
        if (head){
          head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), uv);
          const hw = 0.34 * (1 + 0.5 * t) * (spot / 0.16);
          head.scale.set(hw * (type === 'flood' ? 1.7 : 1), 0.5, hw * (type === 'flood' ? 1.7 : 1));
          const hlen = 0.28;
          head.position.set(o[0] - ud[0] * (mount - hlen), o[1] - ud[1] * (mount - hlen), o[2] - ud[2] * (mount - hlen));
          const hm = head.material;
          hm.color.copy(m.color);
          hm.opacity = 0.5 * strobe * (app._beamWire ? 0.95 : 0);
          head.visible = app._beamWire && on;
        }
      }
    }
    beam.visible = on;
    if (!on){
      if (beamSourceMeshes[i]) beamSourceMeshes[i].visible = false;
      if (beamFootMeshes[i]) beamFootMeshes[i].visible = false;
      if (laserBoxMeshes[i]) laserBoxMeshes[i].visible = false;
    }
  }
  furnaceLight.intensity = 0.4 + app.ch.heatPower * 2.2;
  furnaceLight.color.setHex(app.ch.heatPower < 0.4 ? 0x3366ff : 0xff7722);
  const floor = chamberBox ? chamberBox.getObjectByName('furnace') : null;
  if (floor){
    floor.material.opacity = 0.02 + app.ch.heatPower * 0.1;
    floor.material.color.setHex(app.ch.heatPower < 0.4 ? 0x3366ff : 0xff7722);
    floor.material.needsUpdate = true;
  }
}

function subnum(n){
  return n < 10 ? SUB[n] : '^' + n;
}

function elZOf(sym){
  const el = elBySym(sym);
  return el ? el.z : 1000;
}

function dist3(a, b){
  return Math.hypot(b.x - a.x, b.y - a.y, b.zz - a.zz);
}

function clusterFormula(ats, cap){
  const counts = new Map();
  for (const a of ats) counts.set(a.el.s, (counts.get(a.el.s) || 0) + 1);
  const list = [...counts.entries()].sort((x, y) => elZOf(x[0]) - elZOf(y[0]));
  let s = '';
  for (const [sym, n] of list) s += n === 1 ? sym : sym + subnum(n);
  if (s.length > cap) s = s.slice(0, cap - 1) + '…';
  return s;
}

function buildCluster(g){
  const ats = g.ats;
  const ids = new Array(ats.length);
  let sp = 0;
  for (let i = 0; i < ats.length; i++){
    ids[i] = ats[i].id;
    sp += Math.hypot(ats[i].vx, ats[i].vy, ats[i].vz);
  }
  const seen = new Map();
  for (const bd of g.bonds){
    const d = dist3(bd.a, bd.b);
    const st = seen.get(bd.type);
    const stretch = (d - bd.r0) / Math.max(1e-9, bd.r0);
    if (st){ st.count++; st.sum += d; st.stretch += stretch; }
    else seen.set(bd.type, { type: bd.type, count: 1, sum: d, stretch });
  }
  const bondStats = [];
  for (const st of seen.values()){ st.avgD = st.sum / st.count; st.stretch /= st.count; bondStats.push(st); }
  return {
    ats, ids, bonds: g.bonds, n: ats.length,
    formula: clusterFormula(ats, 12),
    bondStats,
    sp: sp / ats.length,
  };
}

function clusterCandidates(ch){
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r){ const nx = parent.get(x); parent.set(x, r); x = nx; }
    return r;
  };
  const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent.set(rx, ry); };
  for (const a of ch.atoms) parent.set(a.id, a.id);
  for (const bd of ch.bonds) union(bd.a.id, bd.b.id);
  const groups = new Map();
  for (const a of ch.atoms){
    const r = find(a.id);
    if (!groups.has(r)) groups.set(r, { ats: [], bonds: [] });
    groups.get(r).ats.push(a);
  }
  for (const bd of ch.bonds) groups.get(find(bd.a.id)).bonds.push(bd);
  const out = [];
  for (const g of groups.values()) if (g.ats.length >= 2) out.push(buildCluster(g));
  return out;
}

function jaccard(aIds, bIds){
  const sa = new Set(aIds), sb = new Set(bIds);
  let inter = 0;
  for (const id of sa) if (sb.has(id)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function projectCluster(c){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let inFront = false;
  for (const a of c.ats){
    _projV.set(a.x * S, a.y * S, a.zz * S).project(camera);
    if (_projV.z >= 1) continue;
    inFront = true;
    const x = (_projV.x * 0.5 + 0.5) * wrap.clientWidth;
    const y = (-_projV.y * 0.5 + 0.5) * wrap.clientHeight;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!inFront || !Number.isFinite(x0)) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.max(20, x1 - x0), h = Math.max(14, y1 - y0);
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

function makeTrackBox(){
  const box = document.createElement('div');
  box.className = 'tbox';
  box.style.display = 'none';
  const corners = [];
  for (const cls of ['nw', 'ne', 'se', 'sw']){
    const c = document.createElement('div');
    c.className = 'tc ' + cls;
    box.appendChild(c);
    corners.push(c);
  }
  const lab = document.createElement('span');
  lab.className = 'tlab';
  box.appendChild(lab);
  box._lab = lab;
  box._corners = corners;
  return box;
}

function createTrackEl(id, layer){
  const holder = app._hiddenEls.length ? app._hiddenEls.pop() : makeTrackBox();
  if (holder._inLayer !== layer && layer.appendChild) layer.appendChild(holder);
  holder._inLayer = layer;
  holder.style.display = 'none';
  holder.dataset.tid = String(id);
  holder.style.setProperty('--tc', TRACK_COLORS[id % TRACK_COLORS.length]);
  holder.addEventListener('click', (e) => {
    if (e){ if (e.stopPropagation) e.stopPropagation(); if (e.preventDefault) e.preventDefault(); }
    const pop = document.getElementById('trackPopup');
    const box = (app._lastBoxes || []).find(b => b.tid === id);
    const tr = app._track.get(id);
    if (!box || !tr) return;
    app._trackPinned = id;
    showTrackPopup(pop, box, tr);
  });
  const tr = { id, el: holder, lab: holder._lab, ids: [], cand: null, conf: 1 };
  app._track.set(id, tr);
  return tr;
}

function positionTrack(tr, box){
  const pad = 10;
  tr.el.style.left = (box.x0 - pad) + 'px';
  tr.el.style.top = (box.y0 - pad) + 'px';
  tr.el.style.width = (box.x1 - box.x0 + pad * 2) + 'px';
  tr.el.style.height = (box.y1 - box.y0 + pad * 2) + 'px';
  const c = tr.cand;
  tr.lab.textContent = 'C' + tr.id + (c && c.formula ? ' · ' + c.formula : '');
}

function hideTrackPopup(pop){
  if (pop && pop.classList) pop.classList.remove('show');
}

function showTrackPopup(pop, box, tr){
  if (!pop || !tr || !tr.cand) return;
  const c = tr.cand;
  let bondLine = '<span style="opacity:.7">no bonds</span>';
  if (c.bondStats && c.bondStats.length){
    bondLine = c.bondStats.map(s =>
      '<b>' + s.type + '</b> ×' + s.count + ' · d̄ ' + s.avgD.toFixed(3) + ' nm' +
      (Math.abs(s.stretch) >= 0.02 ? ' ' + (s.stretch >= 0 ? '+' : '') + (s.stretch * 100).toFixed(0) + '%' : '')
    ).join(' · ');
  }
  pop.innerHTML =
    '<b>C' + tr.id + ' · ' + (c.formula || 'C' + tr.id) + '</b>' +
    '<div class="tp-row"><b>' + c.n + '</b> atoms · <b>' + c.bonds.length + '</b> bond' +
    (c.bonds.length === 1 ? '' : 's') + ' · match <b>' + Math.round((tr.conf || 1) * 100) + '%</b></div>' +
    '<div class="tp-row">' + bondLine + '</div>' +
    '<div class="tp-row">T <b>' + (app.ch && app.ch.T_cur ? app.ch.T_cur.toFixed(0) : '—') + '</b> K · <b>v̄</b> ' +
    c.sp.toExponential(1) + ' nm/fs</div>';
  pop.classList.add('show');
  const w = 240, hh = 120, pad = 10;
  const x = clamp(box.x1 + 10, pad + w / 2, wrap.clientWidth - pad - w / 2);
  const y = clamp(box.y0 - 6, pad + hh / 2, wrap.clientHeight - pad - hh / 2);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
}

function updateTracking(){
  const layer = document.getElementById('trackOverlay');
  if (!layer) return;
  const pop = document.getElementById('trackPopup');
  if (crossWallState.on){
    layer.style.display = 'none';
    hideTrackPopup(pop);
    app._trackPinned = null;
    return;
  }
  if (!app._trackOn){
    layer.style.display = 'none';
    hideTrackPopup(pop);
    app._trackPinned = null;
    return;
  }
  layer.style.display = 'block';
  const ch = app.ch;
  if (!ch || !ch.atoms || ch.atoms.length === 0){
    for (const tr of app._track.values()){ tr.el.style.display = 'none'; app._hiddenEls.push(tr.el); }
    app._track.clear();
    app._trackPinned = null;
    app._lastBoxes = [];
    return;
  }
  const cands = clusterCandidates(ch);
  const prev = [...app._track.entries()];
  const assignedId = new Map();
  const usedTr = new Set();
  const usedC = new Set();
  for (let i = 0; i < cands.length; i++){
    let bestTr = null, bestJ = 0.4;
    for (const [id, tr] of prev){
      if (usedTr.has(tr)) continue;
      const j = jaccard(tr.ids || [], cands[i].ids);
      if (j > bestJ){ bestJ = j; bestTr = tr; }
    }
    if (bestTr){ usedTr.add(bestTr); usedC.add(i); assignedId.set(bestTr.id, cands[i]); bestTr.conf = bestJ; }
  }
  for (let i = 0; i < cands.length; i++){
    if (usedC.has(i)) continue;
    const id = app._trackNext++;
    assignedId.set(id, cands[i]);
  }
  const boxes = [];
  for (const [cId, c] of assignedId){
    const box = projectCluster(c);
    let tr = app._track.get(cId);
    if (!tr) tr = createTrackEl(cId, layer);
    tr.ids = c.ids;
    tr.cand = c;
    if (!box){ tr.el.style.display = 'none'; continue; }
    tr.el.style.display = 'block';
    positionTrack(tr, box);
    box.tid = cId;
    boxes.push(box);
  }
  for (const [tId, tr] of [...app._track]){
    if (assignedId.has(tId)) continue;
    tr.el.style.display = 'none';
    app._hiddenEls.push(tr.el);
    app._track.delete(tId);
  }
  hideTrackPopup(pop);
  const pinnedBox = app._trackPinned != null ? boxes.find(b => b.tid === app._trackPinned) : null;
  if (pinnedBox){
    showTrackPopup(pop, pinnedBox, app._track.get(pinnedBox.tid));
  } else if (app._trackPtr){
    const p = app._trackPtr, pad = 18;
    for (const b of boxes){
      if (p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad){
        showTrackPopup(pop, b, app._track.get(b.tid));
        break;
      }
    }
  }
  app._lastBoxes = boxes;
}

function wireTrack(){
  const btn = $('btnTrack');
  if (!btn) return;
  if (btn.classList) btn.classList.add('active');
  btn.addEventListener('click', () => {
    app._trackOn = !app._trackOn;
    app._trackPinned = null;
    if (btn.classList) btn.classList.toggle('active', app._trackOn);
  });
}

/* ========== MRI SCANNER — slice tomography ========== */
const scanRes = { live: 96, snap: 256, hi: 512, clip: 64 };
const scanState = { on: false, chan: 'density', color: 'hot', axis: 'all', pos: 0, clip: false, clipT: 0, clipAng: 0, clipRing: [] };
let scanCanvas = null, scanCtx = null, scanImg = null;
let scanBig = null, scanTex = null, scanPlane = null;

function ensureScanCanvas(w, h){
  w = w | 0; h = h | 0;
  if (!scanCanvas) scanCanvas = document.createElement('canvas');
  if (scanCanvas.width !== w || scanCanvas.height !== h){
    scanCanvas.width = w; scanCanvas.height = h;
    scanCtx = scanCanvas.getContext ? scanCanvas.getContext('2d') : null;
    scanImg = (scanCtx && typeof scanCtx.createImageData === 'function') ? scanCtx.createImageData(w, h) : null;
  }
}

function scanPalette(t, mode){
  t = Math.max(0, Math.min(1, t));
  if (mode !== 'hot'){
    const g = Math.round(t * 255);
    return [g, g, Math.min(255, g + 16)];
  }
  if (t < 0.5){
    const u = t / 0.5;
    return [Math.round(36 * u), Math.round(10 + 82 * u), Math.round(122 + 122 * u)];
  }
  const u = (t - 0.5) / 0.5;
  return [Math.round(36 + 219 * u), Math.round(92 + 163 * u), Math.round(244 - 128 * u)];
}

// Shared painter: Float32 field → normalized RGBA pixels (sqrt gamma, signed-safe).
function fieldToRGBA(fld, chan, color){
  const d = fld.data, n = fld.w * fld.h;
  let mx = 0;
  for (let i = 0; i < n; i++){ const v = d[i]; if (v > mx) mx = v; }
  if (!(mx > 0)) mx = 1;
  const signed = chan === 'charge';
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4){
    let t = d[i] / mx;
    if (signed) t = t * 0.5 + 0.5;
    if (!(t >= 0) || !isFinite(t)) t = 0;
    t = Math.sqrt(Math.min(1, Math.max(0, t)));
    const c = scanPalette(t, color);
    px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
  }
  return px;
}

// Three stacked cross-sections (X / Y / Z) composed into a single map frame.
function renderMapComposite(ch, pos, chan, G){
  const axes = ['x', 'y', 'z'];
  const tiles = axes.map(a => scanField(ch, { axis: a, pos, chan, G }));
  const w = tiles[0].w, h = tiles[0].h;
  const pad = Math.max(1, Math.round(w * 0.04));
  const cw = w * 3 + pad * 2;
  const data = new Float32Array(cw * h);
  for (let i = 0; i < 3; i++){
    const t = tiles[i], src = t.data, ox = i * (w + pad);
    for (let y = 0; y < h; y++) data.set(src.subarray(y * w, y * w + w), y * cw + ox);
  }
  return { axis: 'all', pos, chan, lim: tiles[0].lim, w: cw, h, data };
}

function renderScanFrame(G = scanState.live){
  const ch = app.ch;
  if (!ch || !ch.atoms || !ch.atoms.length) return null;
  let fld;
  if (scanState.clip && scanState.clipAng > 0){
    fld = orbitField(ch, { ang: scanState.clipAng, chan: scanState.chan, G });
  } else if (scanState.axis === 'all'){
    fld = renderMapComposite(ch, scanState.pos, scanState.chan, G);
  } else {
    fld = scanField(ch, { axis: scanState.axis, pos: scanState.pos, chan: scanState.chan, G });
  }
  ensureScanCanvas(fld.w, fld.h);
  const px = fieldToRGBA(fld, scanState.chan, scanState.color);
  const w = fld.w, h = fld.h;
  if (scanImg){
    scanImg.data.set(px);
    if (scanCtx && typeof scanCtx.putImageData === 'function') scanCtx.putImageData(scanImg, 0, 0);
  }
  if (scanTex){ scanTex.image = scanCanvas; scanTex.needsUpdate = true; }
  const vis = document.getElementById('scanCanvas');
  if (vis){
    if (vis.width !== w || vis.height !== h){ vis.width = w; vis.height = h; }
    if (typeof vis.getContext === 'function'){
      const c = vis.getContext('2d');
      if (c && typeof c.drawImage === 'function') c.drawImage(scanCanvas, 0, 0, vis.width, vis.height);
    }
  }
  const rd = $('scanRead');
  if (rd){
    if (scanState.clip) rd.textContent = `clip ${w}×${h} · ${scanState.clipRing.length} frames · ${scanState.chan}`;
    else if (scanState.axis === 'all') rd.textContent = `map x·y·z @ ${(scanState.pos * 100).toFixed(0)}% · ${scanState.chan}`;
    else rd.textContent = `slice ${scanState.axis} @ ${(scanState.pos * 100).toFixed(0)}% · ${scanState.chan}`;
  }
  const st = $('scanStats');
  if (st) st.textContent = `${npx(w, h)} px · ${ch.atoms.length} atoms · t ${fmtFancyTime(ch.t)}`;
  return fld;
}

function ensureScanPlane(){
  if (scanPlane) return;
  if (!scanCanvas) ensureScanCanvas(scanState.live * 2, scanState.live * 2);
  scanTex = new THREE.CanvasTexture(scanCanvas);
  const mat = new THREE.MeshBasicMaterial({ map: scanTex, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  scanPlane.renderOrder = 6;
  scene.add(scanPlane);
}

function updateScanPlane(){
  if (!scanPlane) return;
  const ch = app.ch;
  const ar = scanState.on && ch && ch.atoms && ch.atoms.length > 0;
  if (scanState.axis === 'all'){ scanPlane.visible = false; return; }
  scanPlane.visible = ar;
  if (!ar) return;
  const h = ch.size || 2;
  const hx = h * S;
  const u = scanState.pos * h * S;
  scanPlane.scale.set(hx * 2, hx * 2, 1);
  if (scanState.axis === 'x'){ scanPlane.rotation.set(0, Math.PI / 2, 0); scanPlane.position.set(u, 0, 0); }
  else if (scanState.axis === 'z'){ scanPlane.rotation.set(0, 0, 0); scanPlane.position.set(0, 0, u); }
  else { scanPlane.rotation.set(Math.PI / 2, 0, 0); scanPlane.position.set(0, u, 0); }
}

function updateScan(){
  ensureScanPlane();
  updateScanPlane();
  if (!(app.ch && app.ch.atoms && app.ch.atoms.length)) return;
  if (!scanState._auto){
    scanState._auto = true;
    scanState.on = true;
    const arm = $('scanArm');
    if (arm && arm.classList) arm.classList.add('active');
    if (arm && scanState.on) arm.textContent = '◧ MRI · live';
    const tip = $('scanTip');
    if (tip) tip.textContent = '◉ live — sweep the slice, hop axes';
  }
  if (!scanState.on) return;
  if (scanState.clip) advanceClipFrame();
  else renderScanFrame(scanState.live);
}

const npx = (w, h) => (w * h).toLocaleString();

function advanceClipFrame(){
  scanState.clipT += 1;
  const G = scanRes.clip;
  const sweep = Math.sin(scanState.clipT * 0.16);
  // A slice stack (translate z) with a slow rotating projector mixed in:
  scanState.pos = sweep;
  if ((scanState.clipT % 12) === 0) scanState.clipAng = ((scanState.clipT / 12) % 36) * 10;
  const fld = renderScanFrame(G);
  if (fld){
    scanState.clipRing.push({ ang: scanState.clipAng, pos: scanState.pos, data: fld.data.slice(), w: fld.w, h: fld.h });
    if (scanState.clipRing.length > 16) scanState.clipRing.shift();
    const mont = $('scanRead');
    if (mont && scanState.clip) mont.textContent = 'clip · ' + scanState.clipRing.length + ' frames · ' + fld.w + '×' + fld.h;
  }
}

function updateScanPosRead(){
  const rd = $('scanPosRead');
  if (rd) rd.textContent = (scanState.pos * 100).toFixed(0) + '%';
}

function sheetToPNG(sheet, name, what, silent){
  // sheet: { canvas, w, h } → dataURL PNG → download + (if workspace) binary write
  // silent=true: build the binary only; the caller owns any download/UI (used by clip export)
  let url = null, bin = null;
  const cv = sheet.canvas;
  if (typeof cv.toDataURL === 'function'){
    try { url = cv.toDataURL('image/png'); } catch (err){ url = null; }
  }
  if (url && !silent){
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    if (a.click) a.click();
    sparkMsg('exported ' + what + ' · ' + cv.width + '×' + cv.height);
  } else if (!url && !silent) {
    sparkMsg(what + ' · ' + cv.width + '×' + cv.height + ' (download blocked — enable FS access for files)');
  }
  if (typeof atob === 'function' && typeof Uint8Array === 'function'){
    const b64 = url ? url.split(',')[1] : null;
    if (b64){
      const raw = atob(b64);
      bin = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    }
  }
  return bin;
}

// Compose many small fields into a labelled contact sheet (grid of tiles).
function composeSheet(tiles, cols, labelFn){
  const rows = Math.ceil(tiles.length / cols);
  const cw = tiles[0].w, chh = tiles[0].h;
  const pad = 2, labH = 12;
  const canvas = document.createElement('canvas');
  canvas.width = cols * (cw + pad) + pad;
  canvas.height = rows * (chh + pad + labH) + pad;
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx || typeof ctx.createImageData !== 'function' || typeof ctx.putImageData !== 'function' ||
      typeof ctx.fillRect !== 'function' || typeof ctx.fillText !== 'function'){
    sparkMsg('sheet export would need a full 2D context');
    return null;
  }
  ctx.fillStyle = '#04060e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#7c8db3';
  ctx.font = '10px monospace';
  tiles.forEach((t, i) => {
    const cx = pad + (i % cols) * (cw + pad);
    const cy = pad + Math.floor(i / cols) * (chh + pad + labH);
    if (labelFn){ ctx.fillStyle = '#7c8db3'; ctx.fillText(labelFn(t), cx, cy + labH - 2); }
    const img = ctx.createImageData(cw, chh);
    img.data.set(t.rgba);
    ctx.putImageData(img, cx, cy + labH);
    ctx.strokeStyle = '#223052';
    ctx.strokeRect(cx - 0.5, cy + labH - 0.5, cw + 1, chh + 1);
  });
  return canvas;
}

function scanExport(){
  const ch = app.ch;
  if (!ch || !ch.atoms || !ch.atoms.length){ sparkMsg('add atoms before scanning'); return; }
  const fld = renderScanFrame(scanRes.hi);
  if (!fld) return;
  const canvas = document.createElement('canvas');
  canvas.width = fld.w; canvas.height = fld.h;
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (ctx && typeof ctx.putImageData === 'function' && typeof ctx.createImageData === 'function'){
    const img = ctx.createImageData(fld.w, fld.h);
    img.data.set(fieldToRGBA(fld, scanState.chan, scanState.color));
    ctx.putImageData(img, 0, 0);
  }
  const name = LABS.fn + '-scan-' + (scanState.clip ? 'clip' : scanState.axis) + '-' + scanState.chan + '.png';
  const bin = sheetToPNG({ canvas, w: fld.w, h: fld.h }, name, 'scan ' + fld.w + '×' + fld.h);
  pushScanFiles([{ name, binary: bin, meta: 'single slice' }]);
}

// Square screenshots for the infocard's 2×2 visual grid: one frame straight
// out of the chamber's WebGL renderer (the whole 3D environment, downscaled —
// not centre-cropped — so it reads zoomed-out) and one from the CHAMBER SCAN
// minimap tile. Both stay ≤512px so the exported infocard stays light;
// failures degrade to null (the card shows n/a).
function captureChamberShots(){
  const out = { env: null, scan: null };
  try {
    const r = renderer && renderer.domElement;
    if (r && typeof r.toDataURL === 'function' && r.width > 0 && r.height > 0 && document.createElement){
      const scale = Math.min(512 / Math.max(r.width, r.height), 1);
      const w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext && c.getContext('2d');
      if (cx){ cx.drawImage(r, 0, 0, w, h); out.env = c.toDataURL('image/png'); }
    }
  } catch (err){ out.env = null; }
  try {
    const mm = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('minimap') : null;
    if (mm && typeof mm.toDataURL === 'function') out.scan = mm.toDataURL('image/png');
  } catch (err){ out.scan = null; }
  return out;
}

// The axis-sweep and orbital scanners rendered as labelled contact sheets for
// the infocard: each produced in BOTH the gray and hot colormaps so the
// technical document shows both reads. Capped at ~940px wide so the exported
// card stays light; any failure degrades to null and the card omits the sheet.
function sheetFigureURL(mode){
  try {
    const ch = app.ch;
    if (!ch || !ch.atoms || !ch.atoms.length) return null;
    const fields = [];
    if (mode === 'axes'){
      const G = 160, cols = 8, posOf = (i) => -0.9 + (i / (cols - 1)) * 1.8;
      for (const axis of ['x', 'y', 'z'])
        for (let i = 0; i < cols; i++){
          const fld = scanField(ch, { axis, pos: posOf(i), chan: scanState.chan, G });
          fields.push({ w: fld.w, h: fld.h, fld, label: axis + ' ' + Math.round(posOf(i) * 100) + '%' });
        }
    } else {
      const G = 112, steps = 36, cols = 6;
      for (let i = 0; i < steps; i++){
        const ang = (360 / steps) * i;
        const fld = orbitField(ch, { ang, chan: scanState.chan, G });
        fields.push({ w: fld.w, h: fld.h, fld, label: ang + '°' });
      }
    }
    const cols = mode === 'axes' ? 8 : 6;
    const shrunk = (canvas) => {
      let out = canvas;
      if (canvas.width > 940){
        out = document.createElement('canvas');
        const s = 940 / canvas.width;
        out.width = Math.round(canvas.width * s); out.height = Math.round(canvas.height * s);
        const cx = out.getContext && out.getContext('2d');
        if (!cx) return null;
        cx.drawImage(canvas, 0, 0, out.width, out.height);
      }
      return out.toDataURL('image/png');
    };
    const sheet = (color) => {
      const tiles = fields.map(t => ({ w: t.w, h: t.h, rgba: fieldToRGBA(t.fld, scanState.chan, color), label: t.label }));
      const canvas = composeSheet(tiles, cols, (t) => t.label);
      return canvas ? shrunk(canvas) : null;
    };
    return { gray: sheet('gray'), hot: sheet('hot') };
  } catch (err){ return null; }
}

// Chart recorder + mass spec are live <canvas> instruments — a straight pixel
// capture. The manometer is plain HTML in #pressRead, so its outerHTML is
// embedded and re-styled by the card. Any capture that fails degrades to null.
function captureInstruments(){
  const out = { chart: null, spec: null, press: null };
  const snapId = (id) => {
    try {
      const c = document.getElementById(id);
      return (c && typeof c.toDataURL === 'function' && c.width > 0) ? c.toDataURL('image/png') : null;
    } catch (err){ return null; }
  };
  out.chart = snapId('chartCanvas');
  out.spec = snapId('specCanvas');
  try {
    const p = document.getElementById('pressRead');
    if (p && typeof p.outerHTML === 'string') out.press = p.outerHTML;
  } catch (err){ out.press = null; }
  return out;
}

const MRI_CHANNELS = ['density', 'therm', 'charge', 'bonds'];

// The recorded clip only ever carries the one channel the scanner was tuned
// to, so this renders the SAME slice position on every MRI channel (density,
// therm, charge, bonds) — each as a gray + hot pair — for the export. Null on
// any failure; the card then omits the channel gallery.
function captureChannelGallery(){
  try {
    const ch = app.ch;
    if (!ch || !ch.atoms || !ch.atoms.length) return null;
    const G = 96;
    const out = [];
    for (const name of MRI_CHANNELS){
      const fld = renderMapComposite(ch, scanState.pos, name, G);
      if (!fld || !fld.data) continue;
      const pair = { gray: null, hot: null };
      for (const color of ['gray', 'hot']){
        try {
          const cv = document.createElement('canvas');
          cv.width = fld.w; cv.height = fld.h;
          const cx = cv.getContext && cv.getContext('2d');
          if (!cx || typeof cx.createImageData !== 'function' || typeof cx.putImageData !== 'function') continue;
          const imgd = cx.createImageData(fld.w, fld.h);
          imgd.data.set(fieldToRGBA(fld, name, color));
          cx.putImageData(imgd, 0, 0);
          if (typeof cv.toDataURL === 'function') pair[color] = cv.toDataURL('image/png');
        } catch (err){ pair[color] = null; }
      }
      out.push({ n: name, gray: pair.gray, hot: pair.hot });
    }
    return out.some((c) => c.gray || c.hot) ? out : null;
  } catch (err){ return null; }
}

function exportClipFilm(){
  const ring = scanState.clipRing;
  if (!ring.length || !ring[0] || !ring[0].data){ sparkMsg('no clip recorded yet — press the ◉ clip button once to record, again to save'); return; }
  const cw = ring[0].w, chh = ring[0].h;
  const canvas = document.createElement('canvas');
  canvas.width = ring.length * cw;
  canvas.height = chh;
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx || typeof ctx.createImageData !== 'function'){ sparkMsg('filmstrip canvas unavailable'); return; }
  const blocks = [];
  ring.forEach((f, i) => {
    const img = ctx.createImageData(cw, chh);
    img.data.set(fieldToRGBA(f, scanState.chan, scanState.color));
    ctx.putImageData(img, i * cw, 0);
  });
  const base = LABS.fn + '-clip-' + scanState.chan + '-' + ring.length + 'f';
  const name = base + '.png';
  const bin = sheetToPNG({ canvas, w: canvas.width, h: canvas.height }, name, 'clip filmstrip', true);
  const shots = captureChamberShots();
  const figs = { axes: sheetFigureURL('axes'), orbit: sheetFigureURL('orbit'), ...captureInstruments(), chans: captureChannelGallery() };
  const anim = buildClipPlayerHtml(ring, { chan: scanState.chan, color: 'hot', data: exportExperimentData(), env: shots.env, scan: shots.scan, figs });
  const frames = ring.map(f => fieldToRGBA(f, scanState.chan, scanState.color));
  let gif = null, gifErr = null;
  try { gif = rgbaToGif(frames, { w: cw, h: chh, delay: 80 }); }
  catch (err){ gifErr = (err && err.message) || String(err); }
  let manifest = null;
  try {
    manifest = JSON.stringify({ w: cw, h: chh, chan: scanState.chan, color: scanState.color, delayMs: 80,
      frames: frames.map(fr => ({ w: cw, h: chh, data: Array.from(fr) })) });
  } catch (err){ manifest = null; }
  // ONE automatic download only: Chromium/Brave gate several programmatic
  // downloads from a single gesture and silently drop the extras — that's how
  // only the PNG used to land. So the GIF (the deliverable that's asked for)
  // is the sole auto-download; everything else arrives via the explicitly
  // user-clicked re-download chips + the File System workspace.
  if (gif) downloadBytes(base + '.gif', gif, 'image/gif');
  else if (canvas && typeof canvas.toDataURL === 'function'){
    try {
      let url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      if (a.click) a.click();
    } catch (err){ /* keep going to the workspace path */ }
  }
  showScanChips([{ label: 'gif', name: base + '.gif', mime: 'image/gif', bytes: gif },
    { label: 'png', name: name, mime: 'image/png', bytes: bin },
    { label: 'json', name: base + '-frames.json', mime: 'application/json', text: manifest },
    { label: 'player', name: base + '-anim.html', mime: 'text/html', text: anim }].filter(c => c.bytes || c.text));
  const files = [
    { name, binary: bin, meta: 'clip filmstrip' },
    { name: base + '-anim.html', text: anim, meta: 'clip player (open in any browser)' },
  ];
  if (gif) files.splice(1, 0, { name: base + '.gif', binary: gif, meta: 'clip animation (GIF89a)' });
  if (manifest) files.push({ name: base + '-frames.json', text: manifest, meta: 'raw frames (node mri2gif.mjs → GIF)' });
  pushScanFiles(files);
  sparkMsg('clip saved: ' + base + (gif ? '.gif' : '.png') + (gif ? ' — animated GIF downloaded (tap gif/png/json chips to re-download)' : (gifErr ? ' — gif encode failed: ' + gifErr + ', PNG downloaded instead' : ' — PNG downloaded')));
}

// Self-contained run infocard for a clip ring: embeds each frame as a PNG
// data-url and loops them. One card, pinned to the top of the screen with a
// 2×2 visual grid up front: the hot MRI clip, a chamber-scan frame and a
// square screenshot of the 3D environment, plus a run plate — the export data
// flows below (no separate floating player, no by-frame scrubber). Readable,
// zero dependencies.
function buildClipPlayerHtml(ring, o){
  const toURLs = (color) => ring.map((f) => {
    const cv = document.createElement('canvas');
    cv.width = f.w; cv.height = f.h;
    const cx = (cv.getContext && cv.getContext('2d')) || null;
    if (cx && typeof cx.createImageData === 'function' && typeof cx.putImageData === 'function'){
      const img = cx.createImageData(f.w, f.h);
      img.data.set(fieldToRGBA(f, o.chan, color));
      cx.putImageData(img, 0, 0);
    }
    let url = 'data:image/png;base64,';
    if (typeof cv.toDataURL === 'function'){ try { url = cv.toDataURL('image/png'); } catch (err){ url = 'data:image/png;base64,'; } }
    return url;
  });
  const listG = JSON.stringify(toURLs('gray')).replace(/</g, '\\u003c');
  const listH = JSON.stringify(toURLs('hot')).replace(/</g, '\\u003c');
  const data = o.data || null;
  const dataStr = data && JSON.stringify(data) !== undefined ? JSON.stringify(data).replace(/</g, '\\u003c') : 'null';
  const envStr = o.env ? JSON.stringify(o.env) : 'null';
  const scanStr = o.scan ? JSON.stringify(o.scan) : 'null';
  const figStr = o.figs ? JSON.stringify(o.figs).replace(/</g, '\\u003c') : 'null';
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MRI clip · ${o.chan}</title>
<style>
:root{--bg:#05070f;--panel:#0b1120;--line:#223052;--txt:#dbe6ff;--dim:#7c8db3;--amber:#ffb020;--cyan:#37c8ff;--good:#59ff9c;}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{height:100%;margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;}
#card{position:fixed;left:50%;top:14px;transform:translateX(-50%);width:min(94vw,960px);max-height:calc(100vh - 28px);
  overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--panel);
  border:1px solid var(--line);border-radius:14px;padding:16px 20px 22px;box-shadow:0 24px 70px #000d;}
#mhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border-bottom:1px solid #1d2c4e;padding-bottom:10px;margin-bottom:12px;}
#mhead>div{min-width:0;}
#mhead h1{margin:0 0 2px;font-size:17px;color:var(--amber);letter-spacing:.5px;word-break:break-word;overflow-wrap:anywhere;line-height:1.35;}
#mhead .sub{color:var(--dim);font-size:11px;overflow-wrap:anywhere;}
#mhead button{background:#0a0f1f;color:var(--cyan);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font:12px system-ui;cursor:pointer;flex:none;}
/* 2×2 visual grid: GRAY MRI clip · chamber-scan frame · 3D env screenshot · HOT MRI clip.
   Compact and centered (≤440px wide) so the run data stays visible right below. */
#shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:min(100%,440px);margin:0 auto 14px;}
.shot{position:relative;aspect-ratio:1/1;border:1px solid #1d2c4e;background:#070b16;border-radius:10px;overflow:hidden;}
.shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;background:#04060e;padding:2px;}
.shot .lb{position:absolute;left:0;right:0;bottom:0;padding:4px 9px 5px;font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:var(--dim);
  background:linear-gradient(transparent,rgba(5,8,16,.92));}
.shot .naLbl{position:absolute;top:50%;left:0;right:0;transform:translateY(-60%);text-align:center;color:#1b3053;font-size:20px;letter-spacing:2px;}
.shot .ctl{position:absolute;right:6px;bottom:20px;display:flex;gap:4px;z-index:2;}
.shot .ctl button{background:#0a0f1fdd;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:4px 9px;font:11px system-ui;cursor:pointer;opacity:.9;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:12px 0;}
.cell{border:1px solid #1d2c4e;background:#0a0f1fcc;border-radius:8px;padding:9px 11px;font-size:12px;}
.cell h4{margin:0 0 5px;color:var(--cyan);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;}
.kv b{color:var(--txt);font-weight:600;} .kv span{color:var(--dim);text-align:right;font-variant-numeric:tabular-nums;word-break:break-all;}
table.beams{border-collapse:collapse;width:100%;font-size:11px;}
table.beams th,table.beams td{text-align:left;padding:4px 6px;border-bottom:1px solid #16233f;}
table.beams th{color:var(--dim);font-weight:600;}
h3.sec{color:var(--amber);font-size:12px;letter-spacing:1px;margin:16px 0 6px;text-transform:uppercase;}
.figs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0 4px;}
.figs figure{margin:0;border:1px solid #1d2c4e;background:#070b16;border-radius:10px;overflow:hidden;}
.figs img{width:100%;height:auto;display:block;image-rendering:pixelated;}
.figs .duo{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;}
.figs figure.press{display:flex;flex-direction:column;justify-content:center;}
.figs figcaption{padding:6px 9px;font-size:10px;color:var(--dim);letter-spacing:.3px;}
.pressbox{border:1px solid #1d2c4e;border-radius:8px;background:#070b16;padding:10px 12px;margin:8px;font-size:12px;font-variant-numeric:tabular-nums;}
.pressbox .pgrid{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:3px 0;}
.pressbox .pgrid b{color:var(--amber);}
.pressbox .pgrid .small{border-top:1px solid #16233f;margin-top:6px;padding-top:6px;color:var(--dim);font-size:10px;}
p.prose{font-size:13px;line-height:1.58;color:var(--txt);margin:0 0 9px;}
p.prose b{color:var(--amber);}
ul.facts{list-style:none;margin:8px 0 2px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;}
ul.facts li{background:#0a0f1fcc;border:1px solid #1d2c4e;border-radius:8px;padding:8px 11px;font-size:12px;color:var(--txt);}
ul.facts li b{color:var(--cyan);display:block;font-size:9px;letter-spacing:1.1px;text-transform:uppercase;margin-bottom:2px;}
.evts div{padding:3px 9px;border-left:2px solid var(--line);margin:4px 0;background:#0a0f1f88;border-radius:0 6px 6px 0;font-size:11px;}
pre.raw{white-space:pre-wrap;word-break:break-all;font:10px/1.5 ui-monospace,monospace;color:#9fb4dd;background:#070b16;
  border:1px solid #1d2c4e;border-radius:8px;padding:10px;max-height:30vh;overflow:auto;}
summary{cursor:pointer;color:var(--cyan);font-size:12px;padding:4px 0;}
.off{color:#7c8db3;}
@media (max-width:760px){
  #card{left:auto;right:0;bottom:0;top:auto;transform:none;width:100%;max-height:95vh;border-radius:16px 16px 0 0;}
  #shots{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
  .grid{grid-template-columns:1fr;}
  .figs{grid-template-columns:1fr;}
  ul.facts{grid-template-columns:1fr;}
}
@media print{ #card{max-height:none;height:auto;position:static;transform:none;width:100%;} body{overflow:auto;background:#fff;}
  *{color:#000!important;background:transparent!important;border-color:#999!important;} }
</style>
<div id="card">
  <div id="mhead"><div><h1 id="mt"></h1><div id="ms" class="sub"></div></div><button id="pr">🖨 save / print</button></div>
  <div id="shots">
    <div class="shot" id="cClip"><img id="vf" alt="MRI clip (gray)" style="display:none"><div class="naLbl">CLIP</div>
      <span class="ctl"><button id="pb">⏸</button><button id="st">⏭</button></span>
      <div class="lb">MRI clip · gray · ${o.chan}</div></div>
    <div class="shot" id="cScan"><img id="scan" alt="chamber scan frame" style="display:none"><div class="naLbl">n/a</div><div class="lb">Chamber scan</div></div>
    <div class="shot" id="cEnv"><img id="env" alt="3D environment" style="display:none"><div class="naLbl">n/a</div><div class="lb">3D environment</div></div>
    <div class="shot" id="cClip2"><img id="vf2" alt="MRI clip (hot)" style="display:none"><div class="naLbl">CLIP</div>
      <div class="lb">MRI clip · hot · ${ring.length}f sweep</div></div>
  </div>
  <div id="sec"></div>
</div>
<script>
var F=${listG};var i=0,on=true;var F2=${listH};
var E=${envStr},S=${scanStr};
var G2=${figStr},NF=${ring.length};
var clipLbl=document.getElementById("cClip").querySelector(".naLbl");
var clipLbl2=document.getElementById("cClip2").querySelector(".naLbl");
function show(k){i=k;vf.src=F[i];if(vf.style.display==="none")vf.style.display="block";if(clipLbl)clipLbl.style.display="none";if(vf2)vf2.src=F2[i];if(vf2&&vf2.style.display==="none")vf2.style.display="block";if(clipLbl2)clipLbl2.style.display="none";}
setInterval(function(){if(on)show((i+1)%F.length);},80);
pb.onclick=function(){on=!on;this.textContent=on?"⏸":"▶";};
st.onclick=function(){show((i+1)%F.length);};
pr.onclick=function(){window.print();};
show(0);
if(E){var ei=document.getElementById("env");ei.src=E;ei.style.display="block";ei.parentNode.querySelector(".naLbl").style.display="none";}
if(S){var si=document.getElementById("scan");si.src=S;si.style.display="block";si.parentNode.querySelector(".naLbl").style.display="none";}
var D=${dataStr};
function Fn(n){if(n==null)return"—";n=+n;if(!isFinite(n))return String(n);
  var a=Math.abs(n);if(a>=1e15)return(n/1e15).toFixed(2)+" P";if(a>=1e12)return(n/1e12).toFixed(2)+" T";
  if(a>=1e9)return(n/1e9).toFixed(2)+" G";if(a>=1e6)return(n/1e6).toFixed(2)+" M";if(a>=1e3)return(n/1e3).toFixed(2)+" k";
  return a<1?n.toFixed(4):n.toFixed(1);}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}
function cell(t,kvs){var r='<div class="cell"><h4>'+esc(t)+'</h4><div class="kv">';
  for(var x=0;x<kvs.length;x+=2)r+="<b>"+esc(kvs[x])+"</b><span>"+esc(kvs[x+1])+"</span>";
  return r+"</div></div>";}
function modeStr(o){if(o==null)return"—";if(typeof o==="object"){var m=o.m!=null?o.m:"",n=o.n!=null?o.n:"",c=o.c!=null?o.c:"";return (m||n?m+(m&&n?"×":"")+n+"":"")+(c?" c"+c:"");}return String(o);}
function report(ch){
  var p=[];
  var run2=D.run||{},expn=D.experiment||{},labn=D.lab||{};
  var name=expn.name||labn.name||"experiment";
  var comp={};(D.atoms||[]).forEach(function(a){var k=a.sym||a.state||a.z;comp[k]=(comp[k]||0)+1;});
  var cs=Object.keys(comp).sort().map(function(k){return esc(k)+" ×"+comp[k];}).join(", ")||"—";
  var nA=(D.atoms||[]).length;
  p.push('<p class="prose"><b>Summary.</b> '+(expn.goal?esc(name)+" — "+esc(expn.goal):esc(name)+" — no run goal was recorded")+'. '
    +'The chamber was a '+esc(run2.shape||"box")+' volume ('+esc(run2.size||"?")+') holding '+nA+' atoms — '+cs+' — at t='+Fn(run2.t)+' fs and '+Fn(run2.T_cur)+' K'
    +(run2.T_target!=null?' against a '+Fn(run2.T_target)+' K set-point':'')+'. '
    +'An axial magnetic field of '+Fn(run2.B)+' T'+(run2.Baxis?' along '+esc(run2.Baxis):'')+' and a '+Fn(run2.E)+' V/m electric drive'
    +(run2.Edir?' along '+esc(run2.Edir):' ')+' ('+esc(modeStr(run2.mode))+') were applied to the sample'+(run2.power?', pumping '+Fn(run2.power)+' W at '+Fn(run2.freq)+' Hz':'')+'.</p>');
  var lf=[];
  if(run2.laserOn)lf.push('a '+esc(run2.laserType||"ray")+' laser delivered '+Fn(run2.laserPower)+' W along '+esc(run2.laserAxis||"—")+' (spot '+Fn(run2.laserSpot)+', rate '+Fn(run2.laserRate)+'/fs)');
  if(run2.feederOn){var feeds=(D.feed||[]).filter(function(s){return s.enabled;});
    lf.push('the timed feeder injected '+Fn(run2.feedTotal)+' atoms total'+(feeds.length?' — '+feeds.map(function(s){return 'Z='+esc(s.z)+' every '+Fn(s.every)+' fs';}).join(', '):''));}
  if(lf.length)p.push('<p class="prose"><b>Interventions.</b> During the run '+lf.join('; ')+'. '
    +Fn(run2.reactionCount)+' reactions and '+Fn(run2.decayCount)+' decays were logged across the timeline.</p>');
  p.push('<p class="prose"><b>Imaging.</b> The sample was swept with the chamber MRI scanner on the '+esc(ch)+' channel, rendered in both the gray and hot colormaps.'
    +(G2&&G2.axes?' Three orthogonal passes — X, Y and Z at 8 slices each — were recorded in both colormaps as the <i>axis sweep</i> sheet below.':'')
    +(G2&&G2.orbit?' A full 360° orbital projection (36 angles) shows how the '+esc(ch)+' field redistributes around the axis in the <i>orbital</i> sheet below.':'')
    +(G2&&G2.chans&&G2.chans.length?' The same slice is also resolved on every MRI channel — '+(G2.chans.map(function(c){return esc(c.n);}).join(', '))+' — each in gray and hot, in the channel gallery below.':'')
    +' The animated clips replay the last '+NF+' frames of the live sweep — the top-left in gray, the bottom-right in hot — and a chamber-scan minimap frame plus a 3D render of the environment accompany the grid.');
  p.push('<p class="prose"><b>Results.</b> The exported state resolves the field geometry of a predominantly '+(cs==="—"?'unknown':'<b>'+esc(Object.keys(comp)[0])+'</b> ('+comp[Object.keys(comp)[0]]+' atoms)')+' sample on the '+esc(ch)+' channel, with the strongest signal where density concentrates. '
    +(nA?nA+' atoms were present at export':'No atoms were present at export')
    +' and the system had evolved through '+Fn(run2.t)+' fs ('+esc(run2.shape||"box")+', '+esc(run2.size||"?")+')'
    +(run2.T_target!=null?' at '+(run2.T_cur>run2.T_target?'above':'below')+' its '+Fn(run2.T_target)+' K target':'')+'. '
    +'Run integrity is covered by signature <span class="off">sig '+esc(D.sig||"—")+'</span>; the raw JSON appendix below carries every recorded atom, bond and event.</p>');
  return p.join("");
}
function facts(ch){
  var r=[];var run2=D.run||{},expn=D.experiment||{},labn=D.lab||{};
  var comp={};(D.atoms||[]).forEach(function(a){var k=a.sym||a.state||a.z;comp[k]=(comp[k]||0)+1;});
  var cs=Object.keys(comp).sort().map(function(k){return esc(k)+" ×"+comp[k];}).join(", ")||"—";
  r.push("<li><b>sample</b>"+(D.atoms||[]).length+" atoms · "+cs+"</li>");
  r.push("<li><b>thermal</b>"+Fn(run2.T_cur)+" K → "+Fn(run2.T_target||run2.T_cur)+" K"+(run2.heatPower?" · "+Fn(run2.heatPower)+" W":"")+"</li>");
  r.push("<li><b>fields</b>"+Fn(run2.B)+" T ("+esc(run2.Baxis||"—")+") · "+Fn(run2.E)+" V/m ("+esc(run2.Edir||"—")+")</li>");
  r.push("<li><b>drive</b>"+esc(modeStr(run2.mode))+(run2.power?" · "+Fn(run2.power)+" W":"")+(run2.freq?" · "+Fn(run2.freq)+" Hz":"")+"</li>");
  r.push("<li><b>laser</b>"+(run2.laserOn?"ON · "+Fn(run2.laserPower)+" W":"off")+"</li>");
  r.push("<li><b>feeder</b>"+(run2.feederOn?"ON · fed "+Fn(run2.feedTotal):"off")+"</li>");
  r.push("<li><b>reactions / decays</b>"+Fn(run2.reactionCount)+" / "+Fn(run2.decayCount)+"</li>");
  r.push("<li><b>beams on</b>"+(run2.beams||[]).filter(function(b){return b.on;}).length+"</li>");
  r.push("<li><b>chamber</b>"+esc(run2.shape||"box")+" · "+esc(run2.size||"?")+(run2.sandMode?" · sand":"")+"</li>");
  r.push("<li><b>export</b>"+esc(D.exported||"—")+(labn.name?" · "+esc(labn.name):"")+"</li>");
  return r.join("");
}
(function(){
  var sec=document.getElementById("sec"),mt=document.getElementById("mt"),ms=document.getElementById("ms");
  if(!D){mt.textContent="MRI clip";ms.textContent="run data unavailable — open from the lab export";sec.textContent="No run data was embedded with this clip — export it from the live lab to get the full card.";return;}
  var run=D.run||{},exp=D.experiment||{},lab=D.lab||{},ch=D.chan||"${o.chan}";
  mt.textContent=(exp.name||lab.name||"experiment")+(exp.id?" · "+exp.id:"");
  var g=exp.goal||"";
  ms.textContent=(g?g+" · ":"")+"channel "+ch+" · "+(D.frames?D.frames.length:NF)+" frames · exported "+esc(D.exported||"");
  var h="";
  try{
  h+='<h3 class="sec">scan figures · other instruments</h3><div class="figs">';
  if(G2&&G2.chart)h+='<figure><img alt="chart recorder" src="'+G2.chart+'"><figcaption>chart recorder · temp · heat · B · E · power · atoms</figcaption></figure>';
  if(G2&&G2.spec)h+='<figure><img alt="mass spectrum" src="'+G2.spec+'"><figcaption>mass spectrum · species · '+esc(ch)+'</figcaption></figure>';
  if(G2&&G2.press)h+='<figure class="press"><figcaption>chamber pressure · manometer</figcaption><div class="pressbox">'+G2.press+'</div></figure>';
  if(!(G2&&(G2.chart||G2.spec||G2.press)))h+='<div class="cell"><h4>instruments</h4><div class="kv"><b>note</b><span>instrument captures were unavailable for this export</span></div></div>';
  h+='</div>';
  h+='<h3 class="sec">imaging sheets · gray + hot</h3><div class="figs">';
  if(G2&&G2.axes)h+='<figure><div class="duo"><img alt="axis sweep gray" src="'+G2.axes.gray+'"><img alt="axis sweep hot" src="'+G2.axes.hot+'"></div><figcaption>axis sweep · X / Y / Z · 8 slices · gray → hot · '+esc(ch)+'</figcaption></figure>';
  if(G2&&G2.orbit)h+='<figure><div class="duo"><img alt="orbital gray" src="'+G2.orbit.gray+'"><img alt="orbital hot" src="'+G2.orbit.hot+'"></div><figcaption>orbital 360° · 36 angles · gray → hot · '+esc(ch)+'</figcaption></figure>';
  if(!(G2&&(G2.axes||G2.orbit)))h+='<div class="cell"><h4>imaging sheets</h4><div class="kv"><b>note</b><span>axis sweep + orbital sheets were not captured for this export</span></div></div>';
  h+='</div>';
  var chans=(G2&&G2.chans)||[];
  h+='<h3 class="sec">MRI channels · all four</h3><div class="figs">';
  if(chans.length)chans.forEach(function(c){h+='<figure><div class="duo">'+(c.gray?'<img alt="'+esc(c.n)+' gray" src="'+c.gray+'">':'')+(c.hot?'<img alt="'+esc(c.n)+' hot" src="'+c.hot+'">':'')+'</div><figcaption>channel · '+esc(c.n)+' · gray → hot</figcaption></figure>';});
  else h+='<div class="cell"><h4>MRI channels</h4><div class="kv"><b>note</b><span>channel gallery was not captured for this export</span></div></div>';
  h+='</div>';
  h+='<h3 class="sec">experiment report</h3>'+report(ch);
  h+='<h3 class="sec">results at a glance</h3><ul class="facts">'+facts(ch)+'</ul>';
  h+='<div class="grid">';
  h+=cell("RUN",["time",Fn(run.t)+" fs","step",Fn(run.dt)+" fs","substeps",run.substeps,"temp",Fn(run.T_cur)+" K → "+Fn(run.T_target)+" K","heat",Fn(run.heatPower)+" W","shape",run.shape,"size",run.size,"sand mode",run.sandMode,"decays",Fn(run.decayCount),"reactions",Fn(run.reactionCount)]);
  h+=cell("FIELDS",["B",Fn(run.B)+" T ("+(run.Baxis||"—")+")","E",Fn(run.E)+" V/m ("+(run.Edir||"—")+")","power",Fn(run.power)+" W","freq",Fn(run.freq)+" Hz","mode",esc(run.mode),"drive",esc(run.drive),"scope",esc(run.scopeMode)]);
  h+=cell("LASER / FEED",["laser",run.laserOn?"ON":"off","power",Fn(run.laserPower)+" W","axis",esc(run.laserAxis),"type",esc(run.laserType),"spot",Fn(run.laserSpot),"rate",Fn(run.laserRate),"feeder",run.feederOn?"ON":"off","fed total",Fn(run.feedTotal)]);
  h+=cell("SYSTEM",["atoms",(D.atoms||[]).length,"bonds",(D.bonds||[]).length,"feed inlets",(D.feed||[]).length]);
  var comp={};(D.atoms||[]).forEach(function(a){var k=a.sym||a.state||a.z;comp[k]=(comp[k]||0)+1;});
  var cs=Object.keys(comp).sort().map(function(k){return esc(k)+" ×"+comp[k];}).join(" · ");
  h+=cell("COMPOSITION",["sample",cs||"—"]);
  h+='</div>';
  var beams=(run.beams||[]).filter(function(b){return b.on;});
  if(beams.length){h+='<h3 class="sec">active beams · '+beams.length+'</h3><div class="cell"><table class="beams"><tr><th>type</th><th>axis</th><th>dir</th><th>power</th><th>spot</th></tr>';
    beams.forEach(function(b){h+='<tr><td>'+esc(b.type)+'</td><td>'+esc(b.axis)+'</td><td>'+Fn(b.dir)+'</td><td>'+Fn(b.power)+'</td><td>'+Fn(b.spot)+'</td></tr>';});
    h+='</table></div>';}
  if((run.feederOn)&&(D.feed||[]).length){h+='<h3 class="sec">feed inlets</h3><div class="cell">';
    h+=D.feed.filter(function(s){return s.enabled;}).map(function(s){return esc(s.z)+" @ "+Fn(s.every)+" fs ×"+s.n+" ("+(s.start||0)+"→)";}).join(" · ");
    h+="</div>";}
  if(D.events&&D.events.length){h+='<h3 class="sec">events · last '+D.events.length+'</h3><div class="evts">';
    D.events.forEach(function(e){h+='<div><b style="color:var(--cyan)">t='+Fn(e.t)+'</b> · '+esc(e.msg)+'</div>';});
    h+="</div>";}
  h+='<details><summary>raw JSON · sig '+esc(D.sig||"—")+'</summary><pre class="raw">'+esc(JSON.stringify(D,null,2))+'</pre></details>';
  }catch(err){h+='<div class="cell"><h4>render note</h4><div class="kv"><b>partial data</b><span>'+esc(String((err&&err.message)||err))+'</span></div></div>';}
  sec.innerHTML=h;
})();
<\/script>`;
}

// Multi-axis stack: three parameter rows (X / Y / Z) of sweeping slices.
function exportMultiAxis(){
  const ch = app.ch;
  if (!ch || !ch.atoms || !ch.atoms.length){ sparkMsg('add atoms before scanning'); return; }
  const G = 160, cols = 8, posOf = (i) => -0.9 + (i / (cols - 1)) * 1.8;
  const tiles = [];
  for (const axis of ['x', 'y', 'z']){
    for (let i = 0; i < cols; i++){
      const fld = scanField(ch, { axis, pos: posOf(i), chan: scanState.chan, G });
      tiles.push({ w: fld.w, h: fld.h, rgba: fieldToRGBA(fld, scanState.chan, scanState.color), label: axis + ' ' + Math.round(posOf(i) * 100) + '%' });
    }
  }
  const canvas = composeSheet(tiles, cols, (t) => t.label);
  if (!canvas){ sparkMsg('multi-axis sheet skipped — canvas 2D unavailable'); return; }
  const name = LABS.fn + '-scan3axis-' + scanState.chan + '.png';
  const bin = sheetToPNG({ canvas, w: canvas.width, h: canvas.height }, name, 'multi-axis scan');
  pushScanFiles([{ name, binary: bin, meta: 'multi-axis sheet' }]);
}

// Orbital: a full 360° rotating projector (plane normal spins around Z).
function exportOrbital(){
  const ch = app.ch;
  if (!ch || !ch.atoms || !ch.atoms.length){ sparkMsg('add atoms before scanning'); return; }
  const G = 112, steps = 36, cols = 6;
  const tiles = [];
  for (let i = 0; i < steps; i++){
    const ang = (360 / steps) * i;
    const fld = orbitField(ch, { ang, chan: scanState.chan, G });
    tiles.push({ w: fld.w, h: fld.h, rgba: fieldToRGBA(fld, scanState.chan, scanState.color), label: ang + '°' });
  }
  const canvas = composeSheet(tiles, cols, (t) => t.label);
  if (!canvas){ sparkMsg('orbital sheet skipped — canvas 2D unavailable'); return; }
  const name = LABS.fn + '-orbit-' + scanState.chan + '-360.png';
  const bin = sheetToPNG({ canvas, w: canvas.width, h: canvas.height }, name, 'orbital scan');
  pushScanFiles([{ name, binary: bin, meta: 'orbital 360° sheet' }]);
}

// Route scan artefacts into the agent workspace as well as the download.
async function pushScanFiles(files){
  const mf = buildManifest(files, 'scans');
  return saveToWorkspace('scans', files.map(f => ({ name: f.name, binary: f.binary, text: f.text }))
    .concat([{ name: 'manifest.json', text: JSON.stringify(mf, null, 2) }]));
}

function wireScan(){
  const arm = $('scanArm');
  if (!arm) return;
  arm.addEventListener('click', () => {
    scanState.on = !scanState.on;
    if (arm.classList) arm.classList.toggle('active', scanState.on);
    arm.textContent = scanState.on ? '◧ MRI · live' : '◧ MRI';
    arm.title = scanState.on ? 'stop the scanner' : 'start / stop the scanner';
    const tip = $('scanTip');
    if (tip) tip.textContent = scanState.on ? '◉ live — sweep the slice, hop axes' : 'scanner idle — MRI runs it';
  });
  const ax = $('scanAxis');
  if (ax) for (const b of [...ax.querySelectorAll('button')]){
    b.addEventListener('click', () => {
      setActiveChips(ax, b);
      scanState.axis = (b.dataset && b.dataset.a) || 'y';
      updateScanPosRead();
    });
  }
  const pos = $('scanPos');
  if (pos) pos.addEventListener('input', (e) => {
    scanState.pos = clamp(((parseFloat(((e.target && e.target.value) || '0')) || 0) / 100), -1, 1);
    updateScanPosRead();
  });
  const chan = $('scanChan');
  if (chan) chan.addEventListener('change', (e) => { const v = e.target.value; if (v) scanState.chan = v; });
  const col = $('scanColor');
  if (col) col.addEventListener('change', (e) => { const v = e.target.value; if (v) scanState.color = v; });
  const snap = $('scanSnap');
  if (snap) snap.addEventListener('click', () => { if (app.ch && app.ch.atoms && app.ch.atoms.length) renderScanFrame(scanRes.snap); });
  const exp = $('scanExport');
  if (exp) exp.addEventListener('click', () => {
    if (scanState.clip && scanState.clipRing && scanState.clipRing.length) exportClipFilm();
    else scanExport();
  });
  const clipBtn = $('mriClip');
  if (clipBtn) clipBtn.addEventListener('click', () => {
    if (!app.ch || !app.ch.atoms || !app.ch.atoms.length){ sparkMsg('add atoms before the MRI can record'); return; }
    if (scanState.clip){
      // second press → save the clip and stop recording
      scanState.clip = false;
      if (clipBtn.classList) clipBtn.classList.remove('active');
      clipBtn.textContent = '◉ clip';
      clipBtn.title = 'record an MRI clip — press once to start, press again to save';
      const tip = $('scanTip');
      if (tip) tip.textContent = scanState.on ? 'scanner armed — sweeps the slice, hop axes' : 'scanner idle — MRI runs it';
      exportClipFilm();
      scanState.clipRing.length = 0;
      return;
    }
    // first press → start recording (auto-arms the scanner so frames accrue)
    scanState.on = true;
    const a2 = $('scanArm');
    if (a2 && a2.classList) a2.classList.add('active');
    if (a2) a2.textContent = '◧ MRI · live';
    scanState.clip = true;
    if (clipBtn.classList) clipBtn.classList.add('active');
    clipBtn.textContent = '◈ recording…';
    clipBtn.title = 'recording — press again to save the clip file';
    const tip2 = $('scanTip');
    if (tip2) tip2.textContent = '◈ recording clip — slice stack + rotating projector · press again to save';
    advanceClipFrame();
  });
  const multiBtn = $('multiBtn');
  if (multiBtn) multiBtn.addEventListener('click', exportMultiAxis);
  const orbitBtn = $('orbitBtn');
  if (orbitBtn) orbitBtn.addEventListener('click', exportOrbital);
  const sfHead = document.querySelector('#scanFooter .sf-head');
  if (sfHead) sfHead.addEventListener('pointerdown', (e) => {
    if (!e || !e.target || typeof e.target.closest !== 'function') return;
    if (e.target.closest('button, select, input, label, .chip, .chipWrap, .sf-slice, .ui-grip')) return;
    moduleDragStart('scanFooter', e.clientX, e.clientY, e);
  });
}

/* ========== CROSS WALL — tiled side-by-side ========== */
const crossWallState = { on: false, tiles: [], cols: 2, rows: 1, focus: null };
const wallFocusState = { t: null };
const wallPickState = { sel: new Set(), filter: '' };
const stackState = { mode: 'single', sel: new Set() };

/* ========== custom experiments — save the live chamber to the lab ==========
   A save captures the chamber snapshot (atoms, bonds, fields, cross preset +
   knobs, feeder, geometry) into a mission that joins the command centre and the
   cross-wall picker, persisted per-device under CUSTOM_EXP_KEY. Stored defs are
   pure JSON; the runnable def (the setup() closure + steps) is materialized on
   load so findExperiment()/wall tiles/menu all see it as a normal experiment. */
const CUSTOM_EXP_KEY = 'aark.custom.v1';
let CUSTOM_EXPS = [];

function captureRunSnapshot(ch){
  if (!ch) return null;
  const idx = new Map(ch.atoms.map((a, i) => [a, i]));
  const atoms = ch.atoms.map(a => ({
    z: a.z, q: Math.round((a.q || 0) * 1e3) / 1e3,
    x: r3(a.x), y: r3(a.y), zz: r3(a.zz),
    vx: r3(a.vx), vy: r3(a.vy), vz: r3(a.vz),
    m: a.m, r: a.r, fixed: !!(a.fixed), label: a.label || '',
    temp: Math.round(a.temp || 0), cap: a.cap,
  }));
  const bonds = ch.bonds.map(b => ({
    a: idx.get(b.a), b: idx.get(b.b), type: b.type || 'covalent', r0: b.r0, k: b.k, dis: b.dis,
  })).filter(b => b.a != null && b.b != null);
  const run = {
    t: Math.round(ch.t || 0), dt: ch.dt, substeps: ch.substeps,
    T_cur: Math.round(ch.T_cur || 0),
    T_target: Number.isFinite(ch.T_target) ? ch.T_target : 300,
    heatPower: ch.heatPower || 0, B: ch.B || 0, E: ch.E || 0,
    power: ch.power || 0, Baxis: ch.Baxis || 'y', Edir: ch.Edir || 'x',
    shape: ch.shape, size: ch.size, sandMode: !!ch.sandMode,
    freq: ch.freq || 0, drive: ch.drive || 0, sandOrder: ch.sandOrder || 0,
    mode: ch.mode ? { m: ch.mode.m || 2, n: ch.mode.n || 2 } : { m: 2, n: 2 },
    decayCount: ch.decayCount || 0, reactionCount: ch.reactionCount || 0,
    feedTotal: ch.feedTotal || 0, feederOn: !!ch.feederOn,
    beams: (ch.beams || []).map(b => ({
      type: b.type, axis: b.axis, dir: b.dir, power: b.power, spot: b.spot,
      rate: b.rate, grip: b.grip, on: !!b.on, wav: b.wav || 532, delay: b.delay || 0,
    })),
    cross: ch.cross && ch.cross.preset ? Object.assign({}, ch.cross) : { preset: null },
  };
  return {
    version: 1,
    run,
    rate: ch._rate && ch._rate > 0 ? ch._rate : (ch.dt * ch.substeps),
    feed: ch.feed.map(s => ({
      z: s.z, n: s.n, every: s.every, start: s.start, inlet: s.inlet,
      q: s.q || 0, enabled: !!(s.enabled ?? true), label: s.label || '',
    })),
    env: { g: (ch.env && ch.env.g) || 0, atm: (ch.env && ch.env.atm) || 0, gasMix: (ch.env && ch.env.gasMix) || [] },
    atoms, bonds,
  };
}

function restoreChamber(ch, snap){
  const r = (snap && snap.run) || {};
  ch.reset();
  ch.shape = r.shape || 'cube';
  ch.size = Number.isFinite(r.size) ? r.size : 2.4;
  ch.t = r.t || 0;
  if (Number.isFinite(snap.rate) && snap.rate > 0) ch.setRate(snap.rate);
  else if (Number.isFinite(r.dt) && r.dt > 0) ch.dt = r.dt;
  ch.substeps = r.substeps || 1;
  const restored = [];
  for (const at of snap.atoms || []){
    const a = ch.spawn(at.z, {
      x: at.x, y: at.y, zz: at.zz ?? 0, vx: at.vx ?? 0, vy: at.vy ?? 0, vz: at.vz ?? 0,
      q: at.q || 0, temp: at.temp || r.T_cur || 300, m: at.m, r: at.r,
      fixed: at.fixed, label: at.label || '', cap: at.cap,
    });
    if (a) restored.push(a);
  }
  for (const bt of snap.bonds || []){
    const a = restored[bt.a], b = restored[bt.b];
    if (a && b) ch.addBond(a, b, { type: bt.type || 'covalent', r0: bt.r0, k: bt.k, dis: bt.dis });
  }
  Object.assign(ch, {
    B: r.B || 0, E: r.E || 0, power: r.power || 0, Baxis: r.Baxis || 'y', Edir: r.Edir || 'x',
    T_target: Number.isFinite(r.T_target) ? r.T_target : 300,
    T_cur: Number.isFinite(r.T_cur) ? r.T_cur : (Number.isFinite(r.T_target) ? r.T_target : 300),
    heatPower: r.heatPower || 0, freq: r.freq || 0, drive: r.drive || 0,
    sandMode: !!r.sandMode, sandOrder: r.sandOrder || 0,
    mode: r.mode ? { m: r.mode.m || 2, n: r.mode.n || 2 } : { m: 2, n: 2 },
    decayCount: r.decayCount || 0, reactionCount: r.reactionCount || 0, feedTotal: r.feedTotal || 0,
  });
  ch.cross = r.cross && r.cross.preset ? Object.assign({ preset: r.cross.preset }, r.cross) : { preset: null };
  ch.feed = (snap.feed || []).map(s => ({
    z: s.z, n: s.n, every: s.every, start: s.start || 0, next: s.start || 0,
    inlet: s.inlet || 'top', q: s.q || 0, label: s.label || '', enabled: s.enabled !== false,
  }));
  ch.feederOn = !!r.feederOn;
  if (r.beams && r.beams.length){
    ch.beams = r.beams.map(b => {
      const nb = ch._newBeam(b.type || 'ray', b.axis || 'y', b.dir ?? 1, b.power ?? 0);
      nb.spot = b.spot || 0.16; nb.rate = b.rate || 10; nb.grip = b.grip || 0.5;
      nb.on = !!b.on; nb.wav = b.wav || 532; nb.delay = b.delay || 0;
      return nb;
    });
  }
  const en = snap.env || {};
  ch.env = { g: en.g || 0, atm: en.atm || 0, gasMix: en.gasMix || [] };
  return ch;
}

function materializeCustomExp(stored){
  const snap = stored.snapshot;
  const exp = {
    id: stored.id, name: stored.name || 'Custom Experiment', icon: stored.icon || '★',
    tag: stored.tag || 'custom · saved',
    desc: stored.desc || 'A chamber you saved to the lab — atoms, bonds, fields, cross-lab preset and feeder are restored exactly as you left them.',
    goal: stored.goal || 'run your saved setup', family: 'custom', custom: true,
    savedAt: stored.savedAt || 0, snapshot: snap, pick: stored.pick || {},
  };
  exp.setup = function(ch){ restoreChamber(ch, snap); };
  exp.steps = [
    { title: 'Your saved chamber', edu: 'This experiment is a snapshot of a setup you built in the lab — atoms, bonds, fields, cross-lab preset and feeder are restored exactly as you left them.', when: () => true, max: 1e30 },
    { title: 'Keep tuning', edu: 'Add heat, beams or elements, then save again to update the snapshot — or run the cross wall to watch your setup evolve beside others.', when: () => false },
  ];
  return exp;
}

function pickForSnapshot(ch, snap, cp){
  const feed = (snap.feed || []).map((f, i) => ({
    id: 'f' + i, z: f.z, n: f.n || 1, every: f.every || 4e4, start: f.start || 0,
    inlet: f.inlet !== false, why: 'saved feeder slot — every ' + fmtRate(f.every || 4e4) + ' fs',
  }));
  return {
    geo: ch.shape || 'cube',
    time: { band: 'ns', rate: snap.rate > 0 ? snap.rate : 2e4, why: 'your saved speed dial' },
    presets: [{ id: cp, why: 'saved cross-lab fields' }],
    feed,
  };
}

function customStorageGet(){
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(CUSTOM_EXP_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch (err){ return []; }
}

function persistCustomExps(){
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_EXP_KEY, JSON.stringify(CUSTOM_EXPS));
  } catch (err){ /* storage blocked or full — the session still keeps them */ }
}

function loadCustomExpsFromStorage(){
  const stored = customStorageGet();
  if (!Array.isArray(stored)) return;
  CUSTOM_EXPS = stored.filter(s => s && s.id && s.snapshot);
  refreshCustomExperiments();
}

function escHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function refreshCustomExperiments(){
  for (const st of CUSTOM_EXPS){
    const mat = materializeCustomExp(st);
    const i = EXPERIMENTS.findIndex(e => e.id === st.id);
    if (i >= 0) EXPERIMENTS[i] = mat;
    else EXPERIMENTS.push(mat);
  }
  for (let i = EXPERIMENTS.length - 1; i >= 0; i--){
    const e = EXPERIMENTS[i];
    if (e.custom && !CUSTOM_EXPS.some(st => st.id === e.id)) EXPERIMENTS.splice(i, 1);
  }
  renderWallPicker();
  renderCustomList();
  if (app.gridOn) renderMenu();
}

function saveCustomExperiment(name){
  const ch = app.ch;
  if (!ch){ sparkMsg('deploy an experiment before saving'); return null; }
  const snap = captureRunSnapshot(ch);
  if (!snap){ sparkMsg('nothing to save yet'); return null; }
  const cp = (ch.cross && ch.cross.preset && CROSS_PRESETS.find(x => x.id === ch.cross.preset)) ? ch.cross.preset : 'off';
  const now = Date.now();
  const name0 = String(name || '').trim() || 'Custom Experiment';
  const prev = CUSTOM_EXPS.find(st => st.name === name0);
  let stored;
  if (prev){
    prev.snapshot = snap; prev.pick = pickForSnapshot(ch, snap, cp);
    prev.savedAt = now; prev.name = name0;
    stored = prev;
  } else {
    stored = {
      id: 'custom-' + now.toString(36) + '-' + Math.floor(Math.random() * 1296).toString(36),
      name: name0, icon: '★', tag: 'custom · saved',
      desc: 'A chamber you saved to the lab — atoms, bonds, fields, cross-lab preset and feeder are restored exactly as you left them.',
      goal: 'run your saved setup', savedAt: now,
      snapshot: snap, pick: pickForSnapshot(ch, snap, cp),
    };
    CUSTOM_EXPS.push(stored);
  }
  refreshCustomExperiments();
  persistCustomExps();
  sparkMsg('★ saved "' + stored.name + '" — in the command centre + cross-wall picker' + (prev ? ' · updated' : ''));
  return stored;
}

function deleteCustomExperiment(id){
  const i = CUSTOM_EXPS.findIndex(st => st.id === id);
  if (i < 0) return false;
  CUSTOM_EXPS.splice(i, 1);
  refreshCustomExperiments();
  persistCustomExps();
  sparkMsg('deleted custom experiment');
  return true;
}

function renderCustomList(){
  const wrap = document.getElementById('saveList');
  if (!wrap) return;
  if (!CUSTOM_EXPS.length){
    wrap.innerHTML = '<div class="save-head" style="color:var(--dim)">no saved experiments yet — deploy one and hit ★ save custom</div>';
    return;
  }
  let html = '<div class="save-list">';
  for (const st of CUSTOM_EXPS){
    const live = app.cur && app.cur.id === st.id;
    html += '<div class="save-item" data-id="' + escHtml(st.id) + '">'
      + '<span class="wi">★</span><b>' + escHtml(st.name) + '</b>'
      + '<span class="si-tag">' + escHtml(st.tag || '') + '</span>'
      + (live ? '<span class="glive">● live</span>' : '<span class="ggo">→</span>')
      + '<button class="si-x" data-del="' + escHtml(st.id) + '" title="delete this custom experiment">✕</button>'
      + '</div>';
  }
  html += '</div>';
  wrap.innerHTML = html;
}

function openSaveDlg(){
  if (!app.ch){ sparkMsg('deploy an experiment before saving'); return; }
  const nm = document.getElementById('saveName');
  if (nm) nm.value = (app.cur && app.cur.name) || 'Custom Experiment';
  renderCustomList();
  const ov = document.getElementById('saveDlg');
  if (ov && ov.classList) ov.classList.add('on');
}

function closeSaveDlg(){
  const ov = document.getElementById('saveDlg');
  if (ov && ov.classList) ov.classList.remove('on');
}

function wireSaveDlg(){
  const sb = document.getElementById('saveBtn');
  if (sb) sb.addEventListener('click', openSaveDlg);
  const cf = document.getElementById('saveConfirm');
  if (cf) cf.addEventListener('click', () => { try { commitSaveDlg(); } catch (e){ sparkMsg('save failed: ' + e.message); } });
  const cs = document.getElementById('saveClose');
  if (cs) cs.addEventListener('click', closeSaveDlg);
  const nm = document.getElementById('saveName');
  if (nm) nm.addEventListener('keydown', (e) => { if (e && e.key === 'Enter') commitSaveDlg(); });
  const lst = document.getElementById('saveList');
  if (lst) lst.addEventListener('click', (e) => {
    if (!e || !e.target || !e.target.dataset) return;
    const id = e.target.dataset.del;
    if (id) deleteCustomExperiment(id);
  });
}

function commitSaveDlg(){
  const nm = document.getElementById('saveName');
  const name = (nm && nm.value || '').trim();
  if (saveCustomExperiment(name)) closeSaveDlg();
}
const _wallCageMats = {};
const WALL_CAM = new THREE.Vector3(7.6, 5.2, 7.6);
function wallCageMat(i){
  return _wallCageMats[i] || (_wallCageMats[i] = new THREE.LineBasicMaterial({ color: i % 2 ? 0x3d5bbf : 0x4a6fd8, transparent: true, opacity: 0.7 }));
}

function setCssVar(el, key, val){
  if (!el) return;
  if (el.style && typeof el.style.setProperty === 'function') el.style.setProperty(key, String(val));
  else if (el.style) el.style[key] = String(val);
}

function makeWallScene(sim, i){
  const sc = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  cam.position.copy(WALL_CAM);
  cam.lookAt(0, 0, 0);
  sc.add(new THREE.AmbientLight(0x334, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(5, 9, 3);
  sc.add(key);
  const cageGeo = chamberWireGeom(sim.shape || 'cube', sim.size);
  sc.add(new THREE.LineSegments(cageGeo, wallCageMat(i)));
  let wallPlate = null;
  if ((sim.shape || 'cube') === 'plate'){
    const half = Math.max(0.1, sim.size) * 0.22 * S;
    wallPlate = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.1, sim.size) * S * 2, half * 2, Math.max(0.1, sim.size) * S * 2, 10, 1, 10),
      new THREE.MeshLambertMaterial({ color: 0x6677aa, transparent: true, opacity: 0.14, depthWrite: false })
    );
    sc.add(wallPlate);
  }
  const nodes = new Map();
  for (const a of sim.atoms){
    const m = new THREE.Mesh(a.sand ? sandGeo : sphereGeo, a.sand ? getSandMat() : sharedMat(a));
    m.scale.setScalar(S * a.r * (a.sand ? 2.1 : 1));
    m.position.set(a.x * S, a.y * S, a.zz * S);
    sc.add(m);
    nodes.set(a.id, m);
  }
  const bGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array(512 * 2 * 3);
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
  bGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
  const bMesh = new THREE.LineSegments(bGeo, new THREE.LineBasicMaterial({ color: 0x8f6fff, transparent: true, opacity: 0.7 }));
  bMesh.frustumCulled = false;
  bMesh.renderOrder = 2;
  sc.add(bMesh);
  const t0 = { sim, scene: sc, camera: cam, nodes, cageGeo, bondGeo: bGeo, bondPos: bPos, bondMesh: bMesh, plate: wallPlate, el: null };
  fitWallTile(t0);
  return t0;
}

function buildExpTile(exp, env, i){
  const sim = new Chamber(DATA, { size: env.size, T: env.T });
  if (typeof exp.setup === 'function') exp.setup(sim);
  sim.size = env.size;
  const pick = exp.pick || {};
  if (!exp.custom){
    // built-in missions re-derive cross fields + feeder from their pick; a custom
    // experiment's setup() already restored the exact saved snapshot, so forcing
    // the preset defaults here would clobber its tuned fields.
    const p0 = (pick.presets || []).find(p => p && p.id && p.id !== 'off');
    if (p0){
      const cp = CROSS_PRESETS.find(x => x.id === p0.id);
      if (cp) Object.assign(sim.cross, { preset: cp.id, enabled: true, ...cp.fields });
    }
    const f0 = (pick.feed || []).find(f => f && f.z != null);
    if (f0) sim.addFeed({ z: f0.z, n: f0.n || 1, every: f0.every || 4e4, start: f0.start || 0, inlet: f0.inlet !== false });
    sim.feederOn = !!f0;
  }
  sim.env = Object.assign({ g: env.g || 0, atm: env.atm || 0 }, sim.env);
  const t = makeWallScene(sim, i);
  t.exp = exp;
  return t;
}

function openWallPicker(){
  const ch = app.ch;
  if (!ch){ sparkMsg('start an experiment before running the cross wall'); return; }
  const ov = document.getElementById('wallPick');
  if (!ov) return;
  const ids = EXPERIMENTS.filter(e => e && e.id).map(e => e.id);
  wallPickState.sel.clear();
  const cur = app.cur && app.cur.id;
  const ci = ids.indexOf(cur);
  if (ci >= 0 && ids.length >= 2){
    wallPickState.sel.add(ids[ci]);
    wallPickState.sel.add(ids[(ci + 1) % ids.length]);
  } else if (ids.length >= 2){
    wallPickState.sel.add(ids[0]);
    wallPickState.sel.add(ids[1]);
  }
  wallPickState.filter = '';
  const f = document.getElementById('wpFam');
  if (f) f.value = '';
  renderWallPicker();
  ov.classList.add('on');
}

function renderWallPicker(){
  const grid = document.getElementById('wpGrid');
  if (!grid) return;
  const f = (wallPickState.filter || '').toLowerCase().trim();
  grid.innerHTML = '';
  for (const e of EXPERIMENTS){
    if (!e || !e.id) continue;
    if (f && ((e.name || '') + ' ' + (e.tag || '') + ' ' + e.id).toLowerCase().indexOf(f) < 0) continue;
    const b = document.createElement('button');
    b.className = 'wcard' + (wallPickState.sel.has(e.id) ? ' on' : '');
    b.dataset.id = e.id;
    b.innerHTML = '<span class="wi">' + (e.icon || '⬡') + '</span><b>' + (e.name || e.id) + '</b><i>' + (e.tag || e.goal || '') + '</i>';
    b.addEventListener('click', () => {
      if (wallPickState.sel.has(e.id)) wallPickState.sel.delete(e.id);
      else wallPickState.sel.add(e.id);
      b.classList.toggle('on', wallPickState.sel.has(e.id));
      syncWallPickBar();
    });
    grid.appendChild(b);
  }
  syncWallPickBar();
}

function syncWallPickBar(){
  const n = wallPickState.sel.size;
  const read = document.getElementById('wpRead');
  if (read) read.textContent = n >= 2
    ? n + ' experiments · side-by-side at the main rate'
    : 'pick at least 2 experiments, then run the cross wall';
  const run = document.getElementById('wpRun');
  if (run){ run.disabled = n < 2; run.textContent = '◧ run cross wall (' + n + ')'; }
}

function closeStrayOverlays(){
  try {
    const keep = new Set(['wallPick', 'wallFocus']);
    if (document && document.querySelectorAll){
      const list = document.querySelectorAll('.oc');
      for (const o of list || []){
        if (keep.has(o.id)) continue;
        if (o.classList && o.classList.remove) o.classList.remove('on');
      }
    }
    if (app && app.gridOn) closeMenu();
    if (app && app._detailId) closeExpDetail();
  } catch (e){ /* overlay sweep is best-effort */ }
}

function runCrossWall(){
  if (crossWallState.on) closeCrossWall();
  const ids = [...wallPickState.sel];
  if (ids.length < 2){ sparkMsg('pick at least 2 experiments to run the cross wall'); return; }
  const ch = app.ch;
  if (!ch){ sparkMsg('start an experiment before running the cross wall'); return; }
  closeStrayOverlays();
  const env = {
    size: ch.size, T: ch.T_target != null ? ch.T_target : 300, heat: ch.heatPower || 0,
    g: ch.env ? ch.env.g : 0, atm: ch.env ? ch.env.atm : 0,
  };
  crossWallState.tiles = ids.map((id, i) => {
    const exp = findExperiment(id);
    return exp ? buildExpTile(exp, env, i) : null;
  }).filter(Boolean);
  syncWallRate(crossWallState.tiles);
  const n = crossWallState.tiles.length;
  const cols = pickWallCols(n, wrap.clientWidth || 800, wrap.clientHeight || 600);
  crossWallState.cols = cols;
  crossWallState.rows = Math.ceil(n / cols);
  crossWallState.on = true;
  if (document.body.classList) document.body.classList.add('crossWallMode');
  buildWallOverlay();
  const wb = $('crossWallBtn');
  if (wb){ if (wb.classList) wb.classList.add('active'); wb.textContent = '◧ close cross wall'; }
  const wp = document.getElementById('wallPick');
  if (wp) wp.classList.remove('on');
  sparkMsg(n + ' experiments tiled · shared chamber geometry, locked to the main rate');
}

function openCrossWall(){
  if (crossWallState.on) return;
  openWallPicker();
}

function wireWallPicker(){
  const run = document.getElementById('wpRun');
  if (run) run.addEventListener('click', runCrossWall);
  const cls = document.getElementById('wpClose');
  if (cls) cls.addEventListener('click', () => { const ov = document.getElementById('wallPick'); if (ov) ov.classList.remove('on'); });
  const clr = document.getElementById('wpClear');
  if (clr) clr.addEventListener('click', () => { wallPickState.sel.clear(); renderWallPicker(); });
  const flt = document.getElementById('wpFam');
  if (flt) flt.addEventListener('input', () => { wallPickState.filter = flt.value; renderWallPicker(); });
}

function syncWallRate(tiles){
  const ch = app.ch;
  if (!ch) return;
  for (const t of tiles){
    t.sim.dt = ch.dt;
    t.sim.substeps = ch.substeps;
    t.sim._frameConfig = { steps: ch.substeps, dt: ch.dt };
  }
}

const WALL_PAD = 8, WALL_HEAD = 52, WALL_GAP = 6, WALL_MIN_CELL = 52;
function pickWallCols(n, w, h){
  // width-driven packing: as many columns as the viewing width holds at the
  // minimum comfortable tile width, so the grid fills the whole available area
  // edge to edge — 2 experiments in one wide row, 8 spanning ~7 across, 40 in
  // denser rows. The final partial row then stretches to cover the full width.
  if (n < 2) return 1;
  const byWidth = Math.max(1, Math.floor((w - WALL_PAD * 2) / WALL_MIN_CELL));
  return Math.max(1, Math.min(n, byWidth));
}
function relayoutCrossWall(){
  if (!crossWallState.on || !crossWallState.tiles.length) return;
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
  const n = crossWallState.tiles.length;
  const cols = pickWallCols(n, w, h);
  crossWallState.cols = cols;
  crossWallState.rows = Math.ceil(n / cols);
  const rects = wallRects(w, h, cols, crossWallState.rows, n);
  for (let i = 0; i < n; i++){
    const t = crossWallState.tiles[i], r = rects[i];
    if (!t.el) continue;
    t.el.style.left = r.x + 'px';
    t.el.style.top = r.y + 'px';
    t.el.style.width = r.w + 'px';
    t.el.style.height = r.h + 'px';
  }
}
function wallRects(w, h, cols, rows, n){
  const ch = Math.max(8, Math.floor((h - WALL_HEAD - WALL_PAD - WALL_GAP * (rows - 1)) / rows));
  const cwFull = Math.max(2, Math.floor((w - WALL_PAD * 2 - WALL_GAP * (cols - 1)) / cols));
  const rects = [];
  for (let r = 0; r < rows; r++){
    const inRow = Math.min(cols, n - r * cols);
    if (inRow <= 0) break;
    const last = inRow < cols;
    const cw = last ? Math.max(2, Math.floor((w - WALL_PAD * 2 - WALL_GAP * (inRow - 1)) / inRow)) : cwFull;
    const y = Math.round(WALL_HEAD + r * (ch + WALL_GAP));
    for (let c = 0; c < inRow; c++){
      rects.push({ x: Math.round(WALL_PAD + c * (cw + WALL_GAP)), y, w: cw, h: ch });
    }
  }
  return rects;
}
function wallSimCentroid(sim, lim){
  const ats = sim.atoms;
  const n = Math.min(ats.length || 0, 400);
  if (!n) return { x: 0, y: 0, z: 0 };
  const st = (ats.length || 1) / n;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < n; i++){
    const a = ats[Math.floor(i * st)];
    sx += a.x; sy += a.y; sz += a.zz;
  }
  const L = Math.max(0.1, sim.size || 5);
  const m = lim == null ? 0.7 : lim;
  return {
    x: clamp(sx / n, -L * m, L * m),
    y: clamp(sy / n, -L * m * 0.85, L * m),
    z: clamp(sz / n, -L * m, L * m),
  };
}
function fitWallTile(t){
  const ats = t.sim.atoms;
  const c = wallSimCentroid(t.sim, 0.7);
  let R = 0;
  const nmax = Math.min(ats.length || 0, 300);
  if (nmax){
    const st = (ats.length || 1) / nmax;
    for (let i = 0; i < nmax; i++){
      const a = ats[Math.floor(i * st)];
      const dx = a.x - c.x, dy = a.y - c.y, dz = a.zz - c.z;
      R = Math.max(R, dx * dx + dy * dy + dz * dz);
    }
    R = (Math.sqrt(R) + 0.8) * S;
  } else {
    R = Math.max(0.1, t.sim.size || 5) * S;
  }
  t.frameR = clamp(R, 1.6, 12);
  t.frameDir = WALL_CAM.clone().normalize();
  t.frameCenter = c;
}
function frameWallTile(t){
  const c = wallSimCentroid(t.sim, 0.7);
  const R = t.frameR || 6;
  const fv = 55 * Math.PI / 360;
  const a = Math.max(0.18, t.camera.aspect || 1);
  const fh = Math.atan(Math.tan(fv) * a);
  const d = Math.max(R / Math.tan(fv), R / Math.tan(fh)) * 1.16;
  const dir = t.frameDir || WALL_CAM.clone().normalize();
  t.camera.position.set(c.x + dir.x * d, c.y + dir.y * d, c.z + dir.z * d);
  t.camera.lookAt(c.x, c.y, c.z);
}

function buildWallOverlay(){
  const ov = $('crossWall');
  if (!ov) return;
  ov.innerHTML = '';
  const top = document.createElement('div');
  top.className = 'cw-top';
  const tt = document.createElement('div');
  tt.className = 'cw-title';
  tt.innerHTML = '<b>⬬ cross wall</b><small>' + crossWallState.tiles.length + ' experiments · same chamber, same rate · tap a tile to focus it</small>';
  const x = document.createElement('button');
  x.className = 'cw-x';
  x.id = 'cwClose';
  x.title = 'close the cross wall';
  x.textContent = '✕';
  x.addEventListener('click', closeCrossWall);
  top.appendChild(tt);
  top.appendChild(x);
  ov.appendChild(top);
  const grid = document.createElement('div');
  grid.className = 'cw-grid';
  ov.appendChild(grid);
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
  const rects = wallRects(w, h, crossWallState.cols, crossWallState.rows, crossWallState.tiles.length);
  for (let i = 0; i < crossWallState.tiles.length; i++){
    const t = crossWallState.tiles[i];
    const r = rects[i];
    const d = document.createElement('div');
    d.className = 'cw-tile';
    d.style.left = r.x + 'px';
    d.style.top = r.y + 'px';
    d.style.width = r.w + 'px';
    d.style.height = r.h + 'px';
    d.innerHTML = '<div class="cw-name"><span>' + (t.exp.icon || '⬡') + '</span>' + (t.exp.name || t.exp.id || '?') + '</div><div class="cw-stat"></div>';
    const cv = document.createElement('canvas');
    cv.className = 'cw-canvas';
    d.appendChild(cv);
    t.canvas = cv;
    const focusIt = () => { if (crossWallState.on) openWallFocus(t); };
    d.addEventListener('click', focusIt);
    d.addEventListener('pointerup', focusIt);
    grid.appendChild(d);
    t.el = d;
  }
}

function updateCrossWallBonds(t){
  const n = Math.min(t.sim.bonds.length, 512);
  const bPos = t.bondPos;
  for (let i = 0, q = 0; i < n; i++, q += 6){
    const bd = t.sim.bonds[i];
    bPos[q] = bd.a.x * S; bPos[q + 1] = bd.a.y * S; bPos[q + 2] = bd.a.zz * S;
    bPos[q + 3] = bd.b.x * S; bPos[q + 4] = bd.b.y * S; bPos[q + 5] = bd.b.zz * S;
  }
  t.bondGeo.setDrawRange(0, n * 2);
  const posAttr = t.bondGeo.getAttribute('position');
  if (posAttr) posAttr.needsUpdate = true;
}

function updateCrossWallState(dt){
  syncWallRate(crossWallState.tiles);
  for (const t of crossWallState.tiles){
    t.sim.advance(dt);
    for (const a of t.sim.atoms){
      const m = t.nodes.get(a.id);
      if (m) m.position.set(a.x * S, a.y * S, a.zz * S);
    }
    updateCrossWallBonds(t);
    if (t.el){
      const st = t.el.querySelector('.cw-stat');
      if (st) st.textContent = t.sim.atoms.length + ' at · ' + (t.sim.T_cur || 0).toFixed(0) + ' K';
    }
  }
  if (crossWallState.focus){
    const ft = crossWallState.focus;
    const st = document.getElementById('wfStat');
    if (st) st.textContent = ft.sim.atoms.length + ' atoms · ' + (ft.sim.T_cur || 0).toFixed(0) + ' K · ' + ft.sim.t.toExponential(1) + ' fs';
  }
}

function renderCrossWall(){
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
  const dpr = (typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1) || 1;
  renderer.setClearColor(0x04060d, 1);
  if (typeof renderer.clear === 'function') renderer.clear(true, true, true);
  const rects = wallRects(w, h, crossWallState.cols, crossWallState.rows, crossWallState.tiles.length);
  const blits = [];
  for (let i = 0; i < crossWallState.tiles.length; i++){
    const t = crossWallState.tiles[i];
    const rect = rects[i];
    const x = rect.x, y = rect.y, ww = rect.w, hh = rect.h;
    if (ww < 4 || hh < 4) continue;
    t.camera.aspect = ww / hh;
    t.camera.updateProjectionMatrix();
    frameWallTile(t);                        // keep the experiment centered in this tile's frame
    // three's setViewport/setScissor take CSS pixels and scale by the pixel ratio
    // internally; pass CSS px so each tile paints exactly its own cell (passing
    // device px double-scaled the region on high-dpr panels and spilled tiles).
    const cssY = h - y - hh;
    renderer.setViewport(x, cssY, ww, hh);
    if (typeof renderer.setScissor === 'function') renderer.setScissor(x, cssY, ww, hh);
    if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(true);
    renderer.render(t.scene, t.camera);
    const dx = Math.floor(x * dpr), dy = Math.floor(cssY * dpr), dw = Math.floor(ww * dpr), dh = Math.floor(hh * dpr);
    if (t.canvas) blits.push({ t, cv: t.canvas, dx, dy, dw, dh });
  }
  const f = crossWallState.focus;
  if (f && f.scene && f.camera){
    const fc = document.getElementById('wfCanvas');
    if (fc){
      const rect0 = (typeof fc.getBoundingClientRect === 'function') ? fc.getBoundingClientRect() : null;
      const fx = rect0 && typeof rect0.left === 'number' ? Math.round(rect0.left) : Math.round(w * 0.08);
      const fy = rect0 && typeof rect0.top === 'number' ? Math.round(rect0.top) : Math.round(h * 0.08);
      const fw = rect0 && typeof rect0.width === 'number' ? Math.round(rect0.width) : Math.round(w * 0.84);
      const fh = rect0 && typeof rect0.height === 'number' ? Math.round(rect0.height) : Math.round(h * 0.7);
      if (fw >= 8 && fh >= 8){
        f.camera.aspect = fw / fh;
        f.camera.updateProjectionMatrix();
        frameWallTile(f);
        const fcssY = h - fy - fh;
        renderer.setViewport(fx, fcssY, fw, fh);
        if (typeof renderer.setScissor === 'function') renderer.setScissor(fx, fcssY, fw, fh);
        if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(true);
        renderer.render(f.scene, f.camera);
        const fdx = Math.floor(fx * dpr), fdy = Math.floor(fcssY * dpr), fdw = Math.floor(fw * dpr), fdh = Math.floor(fh * dpr);
        blits.push({ t: f, cv: fc, dx: fdx, dy: fdy, dw: fdw, dh: fdh });
      }
    }
  }
  if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(false);
  // back to the full drawing buffer so the next (non-wall) render isn't clipped
  if (typeof renderer.setViewport === 'function') renderer.setViewport(0, 0, w, h);
  if (typeof renderer.setScissor === 'function') renderer.setScissor(0, 0, w, h);
  for (const b of blits){
    const cv = b.cv;
    if (!cv) continue;
    if (cv.width !== b.dw) cv.width = b.dw;
    if (cv.height !== b.dh) cv.height = b.dh;
    const c2d = cv.getContext && cv.getContext('2d');
    if (c2d && typeof c2d.drawImage === 'function'){
      const srcTop = renderer.domElement.height - b.dy - b.dh;
      c2d.clearRect(0, 0, cv.width, cv.height);
      // one crisp copy of THIS tile's own viewport region — no CSS re-scale (that
      // stage re-drew the image into a sub-rect and ghosted a second copy)
      c2d.drawImage(renderer.domElement, b.dx, srcTop, Math.min(b.dw, 4096), b.dh, 0, 0, cv.width, cv.height);
    }
  }
}

function closeCrossWall(){
  if (!crossWallState.on) return;
  if (document.body.classList) document.body.classList.remove('crossWallMode');
  const ov = $('crossWall');
  if (ov) ov.innerHTML = '';
  closeWallFocus();
  for (const t of crossWallState.tiles){
    t.bondGeo.dispose();
    t.bondMesh.material.dispose();
    t.cageGeo.dispose();
    if (t.plate){ t.plate.geometry.dispose(); t.plate.material.dispose(); }
    for (const m of t.nodes.values()) t.scene.remove(m);
  }
  crossWallState.tiles = [];
  crossWallState.focus = null;
  crossWallState.on = false;
  const wb = $('crossWallBtn');
  if (wb){ if (wb.classList) wb.classList.remove('active'); wb.textContent = '⬛ run cross wall'; }
  renderer.setClearColor(0x05070f, 1);
}

function openWallFocus(t){
  if (!t || !crossWallState.on) return;
  crossWallState.focus = t;
  wallFocusState.t = t;
  const ov = document.getElementById('wallFocus');
  if (!ov) return;
  const exp = t.exp || {};
  const el = (id, txt) => { const e = document.getElementById(id); if (e && txt !== undefined) e.textContent = txt; return e; };
  el('wfIco', exp.icon || '⬡');
  el('wfName', exp.name || t.sim.size || 'cross-wall tile');
  el('wfTag', exp.tag || '');
  el('wfGoal', exp.goal ? 'Goal: ' + exp.goal : '');
  el('wfDesc', exp.desc || '');
  if (ov.classList) ov.classList.add('on');
  sparkMsg('focused ' + (exp.name || '') + ' — return to the wall anytime');
}

function closeWallFocus(){
  crossWallState.focus = null;
  wallFocusState.t = null;
  const ov = document.getElementById('wallFocus');
  if (ov && ov.classList) ov.classList.remove('on');
}

function deployWallFocus(){
  const t = crossWallState.focus || wallFocusState.t;
  if (!t || !t.exp){ closeWallFocus(); return; }
  const exp = t.exp;
  const wasOn = crossWallState.on;
  closeWallFocus();
  if (wasOn) closeCrossWall();
  sparkMsg('deployed ' + (exp.name || exp.id) + ' → main chamber');
  loadExperiment(exp);
}

function focusCrossTile(t){
  if (!t || !crossWallState.on) return;
  openWallFocus(t);
}

function wireWallFocus(){
  const back = document.getElementById('wfBack');
  if (back) back.addEventListener('click', () => { closeWallFocus(); sparkMsg('back to the cross wall'); });
  const dep = document.getElementById('wfDeploy');
  if (dep) dep.addEventListener('click', deployWallFocus);
  const clos = document.getElementById('wfClose');
  if (clos) clos.addEventListener('click', () => { closeWallFocus(); sparkMsg('back to the cross wall'); });
}

function wireCrossStack(){
  const modeEl = $('crossModeChips');
  if (modeEl) for (const b of [...modeEl.querySelectorAll('button')]){
    b.addEventListener('click', () => {
      setActiveChips(modeEl, b);
      setCrossMode(b.dataset && b.dataset.m ? b.dataset.m : 'single');
    });
  }
  rebuildStackChips();
  const wb = $('crossWallBtn');
  if (wb) wb.addEventListener('click', () => { if (crossWallState.on) closeCrossWall(); else openCrossWall(); });
  wireWallPicker();
}

function rebuildStackChips(){
  const wrapEl = $('crossStack');
  if (!wrapEl) return;
  wrapEl.innerHTML = '';
  for (const p of CROSS_PRESETS){
    if (p.id === 'off') continue;
    const b = document.createElement('button');
    b.className = 'chip crosschip';
    b.innerHTML = '<span>' + p.icon + '</span>' + p.label;
    b.addEventListener('click', () => {
      if (stackState.sel.has(p.id)){ stackState.sel.delete(p.id); if (b.classList) b.classList.remove('on'); }
      else { stackState.sel.add(p.id); if (b.classList) b.classList.add('on'); }
      applyStack();
    });
    wrapEl.appendChild(b);
  }
}

function applyStack(){
  const ch = app.ch;
  if (!ch){ return; }
  const ids = [...stackState.sel];
  const merged = mergeStackFields(ids);
  ch.cross.preset = ids.length ? 'stack' : 'off';
  for (const k in ch.cross){
    if (k === 'preset' || k === 'enabled') continue;
    if (typeof ch.cross[k] === 'number') ch.cross[k] = 0;   // neutralise every field, then re-apply the selected union
  }
  for (const k in merged){ if (k !== 'enabled') ch.cross[k] = merged[k]; }
  ch.cross.enabled = ids.length > 0;
  const rd = $('crossStackRead');
  if (rd) rd.textContent = ids.length
    ? 'stack: ' + ids.map(id => { const p = CROSS_PRESETS.find(x => x.id === id); return p ? p.label : id; }).join(' + ')
    : 'stack off';
  const knobs = $('crossKnobs');
  if (knobs) knobs.innerHTML = '';
  const desc = $('crossDesc');
  if (desc) desc.textContent = ids.length
    ? 'Combined field stack — max contribution per force across ' + ids.length + ' presets.'
    : 'No cross fields active.';
}

function setCrossMode(m){
  stackState.mode = m;
  const knobs = $('crossKnobs'); if (knobs && knobs.style) knobs.style.display = m === 'stack' ? 'none' : '';
  const listEl = $('crossList'); if (listEl && listEl.style) listEl.style.display = m === 'stack' ? 'none' : '';
  const st = $('crossStackWrap'); if (st && st.style) st.style.display = m === 'stack' ? 'block' : 'none';
  if (m === 'stack' && !stackState.sel.size) applyStack();
}

function applyCrossPresetReal(p, afterKnob){
  const ch = app.ch;
  if (!ch) return;
  ch.cross.preset = p.id;
  Object.assign(ch.cross, p.fields);
  const knobs = $('crossKnobs');
  if (knobs) knobs.innerHTML = '';
  for (const k of p.knobs){
    const row = document.createElement('label');
    row.className = 'krow';
    row.innerHTML = '<span>' + k.label + '</span><input type="range" min="' + k.min + '" max="' + k.max + '" step="' + k.d + '" value="' + (ch.cross[k.k] ?? k.min) + '">';
    const inp = row.querySelector('input');
    if (inp) inp.oninput = (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) ch.cross[k.k] = v;
      if (afterKnob) afterKnob();
    };
    knobs.appendChild(row);
  }
  const desc = $('crossDesc');
  if (desc) desc.textContent = p.desc;
}

app.scanField = scanField;
app.mergeStackFields = mergeStackFields;
app.scanState = scanState;
app.crossWall = crossWallState;
app.wallPick = wallPickState;
app.renderer = renderer;
app.stackState = stackState;
app.saveCustomExperiment = saveCustomExperiment;
app.deleteCustomExperiment = deleteCustomExperiment;
app.captureRunSnapshot = captureRunSnapshot;
app.restoreChamber = restoreChamber;
app.customExps = () => CUSTOM_EXPS.slice();
app.loadExperiment = loadExperiment;
app.buildExpTile = buildExpTile;
app.deployExperiment = deployExperiment;
app.findExpById = (id) => EXPERIMENTS.find(e => e.id === id);
app.scanRender = renderScanFrame;
app.exportClipFilm = exportClipFilm;
app.updateScan = updateScan;
app.syncLaser = syncLaser;
app.openCrossWall = openCrossWall;
app.closeCrossWall = closeCrossWall;
app.openWallPicker = openWallPicker;
app.runCrossWall = runCrossWall;
app.focusCrossTile = focusCrossTile;
app.openWallFocus = openWallFocus;
app.closeWallFocus = closeWallFocus;
app.deployWallFocus = deployWallFocus;
app.agitateSand = agitateSand;
app.refreshAppUi = refreshAppUi;
app.camera = camera;
app.applyStack = applyStack;
app.closeMenu = closeMenu;
app.closeExpDetail = closeExpDetail;
app.openPartModal = openPartModal;
app.closeModal = closeModal;
app.setCrossMode = setCrossMode;
app.renderScanFrame = renderScanFrame;
app.buildClipPlayerHtml = buildClipPlayerHtml;
app.updateExtras = updateExtras;
app.laserBoxes = laserBoxMeshes;
app.rebuildNodes = rebuildNodes;

function projectNodePos(a){
  const v = new THREE.Vector3(a.x * S, a.y * S, a.zz * S).project(camera);
  const x = (v.x * 0.5 + 0.5) * wrap.clientWidth;
  const y = (-v.y * 0.5 + 0.5) * wrap.clientHeight;
  return { x, y, inFront: v.z < 1 };
}function openModal(a){
  closeModal();
  const el = document.getElementById('atomModal');
  const fact = a.el;
  el.querySelector('[data-f="z"]').textContent = fact.z;
  el.querySelector('[data-f="name"]').textContent = `${fact.name} (${fact.s})`;
  el.querySelector('[data-f="grp"]').textContent = `${fact.grp} · ${fact.cat || '—'}`;
  el.querySelector('[data-f="melt"]').textContent = fact.melt ? `${fact.melt} K` : '—';
  el.querySelector('[data-f="boil"]').textContent = fact.boil ? `${fact.boil} K` : '—';
  el.querySelector('[data-f="en"]').textContent = fact.en ? fact.en.toFixed(2) : '—';
  el.querySelector('[data-f="vals"]').textContent = valenceLabel(fact);
  el.querySelector('[data-f="state"]').textContent = a.stateT || '—';
  el.querySelector('[data-f="bonds"]').textContent = `${a.bonds.length}/${a.cap}`;
  el.querySelector('[data-f="cfg"]').textContent = fact.cfg || '—';
  el.querySelector('[data-f="shells"]').textContent = fact.shells ? `${fact.shells} shells` : '—';
  el.querySelector('[data-f="year"]').textContent = fact.year || '—';
  el.querySelector('[data-f="era"]').textContent = fact.era || '—';
  el.querySelector('[data-f="pos"]').textContent = `${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.zz.toFixed(2)} nm`;

  const inp = {
    mass: el.querySelector('#mMass'),
    radius: el.querySelector('#mRadius'),
    charge: el.querySelector('#mCharge'),
    cap: el.querySelector('#mCap'),
    fixed: el.querySelector('#mFixed'),
    label: el.querySelector('#mLabel'),
  };
  inp.mass.value = a.m.toFixed(2);
  inp.radius.value = (a.r * 1000).toFixed(1);
  inp.charge.value = a.q.toFixed(0);
  inp.cap.value = a.cap;
  inp.fixed.checked = !!a.fixed;
  inp.label.value = a.label || '';

  inp.mass.oninput = () => { a.m = parseFloat(inp.mass.value) || 1; };
  inp.radius.oninput = () => { a.r = clamp(parseFloat(inp.radius.value) / 1000, 0.06, 0.4); };
  inp.charge.oninput = () => { a.q = parseInt(inp.charge.value, 10) || 0; a.color = nodeColor(a); };
  inp.cap.oninput = () => { a.cap = Math.max(0, parseInt(inp.cap.value, 10) || 0); };
  inp.fixed.onchange = () => { a.fixed = inp.fixed.checked; };
  inp.label.oninput = () => { a.label = inp.label.value.trim(); };

  const bl = el.querySelector('#mBonds');
  bl.innerHTML = '';
  for (const bd of a.bonds){
    const row = document.createElement('div');
    row.className = 'mbond';
    const other = bd.a === a ? bd.b : bd.a;
    row.innerHTML = `<span>${bd.type} · ${other.el.s} (${other.el.name})</span>`;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.onclick = () => { app.ch.removeBond(bd); openModal(a); };
    row.appendChild(x);
    bl.appendChild(row);
  }
  if (a.bonds.length === 0) bl.innerHTML = '<span style="opacity:.5">no bonds</span>';

  inp.label.onchange = () => { el.querySelector('[data-f="name"]').textContent = `${fact.name}${a.label ? ' "' + a.label + '"' : ''} (${fact.s})`; };

  el.classList.add('open');
  app.modal = el;
  app.modalNode = a;
  app._modalOpen = true;
  const p = projectNodePos(a);
  placeModal(p.x, p.y);
}

function placeModal(x, y){
  if (!app.modal) return;
  const el = app.modal;
  const w = el.offsetWidth || 250, hh = el.offsetHeight || 300;
  const pad = 14;
  x = clamp(x, pad + w / 2, wrap.clientWidth - pad - w / 2);
  y = clamp(y, pad + hh / 2, wrap.clientHeight - pad - hh / 2);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function closeModal(){
  if (app.modal){ app.modal.classList.remove('open'); }
  app.modal = null;
  app.modalNode = null;
  app._modalOpen = false;
}

/* ---- generic stats modal for non-atom experiment parts ---- */
function plateStats(){
  const ch = app.ch;
  const mm = (ch.mode && typeof ch.mode.m === 'number') ? ch.mode.m : 0;
  const nn = (ch.mode && typeof ch.mode.n === 'number') ? ch.mode.n : 0;
  return [
    ['mode', (mm + ',' + nn)],
    ['drive', Math.round((ch.drive || 0) * 100) + '%'],
    ['slab', ch.sandMode ? 'sand-coated' : 'clear'],
    ['atoms', (ch.shape === 'plate' ? ch.atoms.length : 0)],
  ];
}

function scanStatsData(){
  const ch = app.ch;
  const fld = (scanState.on && ch && ch.atoms && ch.atoms.length) ? renderScanFrame(scanRes.live) : null;
  let peak = 0, finite = true;
  if (fld){ for (const v of fld.data){ if (!Number.isFinite(v)) finite = false; if (v > peak) peak = v; } }
  return [
    ['state', scanState.on ? 'armed · ' + (scanState.clip ? 'clipping' : (scanState.axis === 'all' ? 'map' : scanState.axis)) : 'idle'],
    ['signal', scanState.chan],
    ['plane', scanState.axis === 'all'
      ? ('x·y·z map @ ' + Math.round(scanState.pos * 100) + '%')
      : (scanState.clip ? (scanState.clipAng | 0) + '° rotate' : (scanState.axis + ' @ ' + Math.round(scanState.pos * 100) + '%'))],
    ['peak', (fld ? peak.toExponential(2) : '—')],
    ['finite', String(finite)],
  ];
}

function beamStats(i){
  const b = app.ch && app.ch.beams && app.ch.beams[i];
  if (!b) return [['beam', '#pl'], ['state', 'off']];
  const ax = b.axis ? String(b.axis) : '—';
  const type = b.type || 'ray';
  const spec = type === 'pulse' ? 'bursts at its rate — photon kicks ablate'
    : type === 'trap' ? 'gradient force — grips in-beam atoms on the line'
    : type === 'flood' ? 'wide soft illumination — broad gentle heat'
    : 'collimated ray — steady heat · excite · ionize';
  return [
    ['beam', '#' + (i + 1) + ' · ' + type],
    ['state', b.on ? 'firing' : 'idle'],
    ['axis', ax + ' ' + (b.dir || 1)],
    ['power', Math.round((b.power || 0) * 100) + '%'],
    ['spot', Math.round((b.spot || 0) * 100) + '% width'],
    ['rate', (b.rate) + '/s'],
    ['type', spec],
  ];
}

function openPartModal(title, rows){
  const el = document.getElementById('atomModal') || document.createElement('div');
  el.className = 'panel open partModal';
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'm-head';
  head.innerHTML = '<span class="mz">◇</span><div><div class="mn">' + title + '</div><div class="ms">instrument stats</div></div>';
  const facts = document.createElement('div');
  facts.className = 'm-facts';
  for (const [k, v] of rows){
    const d = document.createElement('div');
    d.innerHTML = k + ' <b>' + v + '</b>';
    facts.appendChild(d);
  }
  const close = document.createElement('button');
  close.className = 'mini';
  close.textContent = 'done';
  close.style.flex = '1';
  const rowc = document.createElement('div');
  rowc.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  rowc.appendChild(close);
  el.appendChild(head); el.appendChild(facts); el.appendChild(rowc);
  close.addEventListener('click', closeModal);
  if (!document.getElementById('atomModal')){
    const wrap = document.getElementById('labWrap') || document.body;
    wrap.appendChild(el);
  }
  app.modal = el;
  app.modalNode = null;
  app._modalOpen = true;
  el.style.left = '50%';
  el.style.top = '50%';
  el.style.transform = 'translate(-50%,-50%)';
  el.style.position = 'fixed';
  el.style.width = 'min(260px, 86vw)';
}

function valenceLabel(f){
  if (f.grp === 18 || f.cat === 'Noble gas') return '0';
  if (f.shells) { const s = f.shells; const n = s[s.length - 1]; return String(n); }
  return (f.per || f.grp) ? String(f.grp) : '—';
}

function bindRaycasts(){
  let downX = 0, downY = 0, downT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; downT = performance.now();
    app.pointer.x = (e.clientX / wrap.clientWidth) * 2 - 1;
    app.pointer.y = -(e.clientY / wrap.clientHeight) * 2 + 1;
  });
  canvas.addEventListener('pointermove', (e) => {
    app._trackPtr = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (app.gridOn) return;
    app._trackPinned = null;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (Math.hypot(dx, dy) > 10) return;
    if (!app._tapInspect){ return; }
    app.raycaster.setFromCamera(app.pointer, camera);
    // 1) atoms (the fine nodes) first
    const nodeHits = app.raycaster.intersectObjects(nodesGroup ? nodesGroup.children : [], false);
    for (const h of nodeHits){
      const a = app.ch.atoms.find(x => x.id === h.object.userData.atomId);
      if (a){ openModal(a); return; }
    }
    // 2) coarser experiment parts — plate, scan projection, beam probes
    const parts = [];
    if (plateSlab && plateSlab.visible) parts.push(plateSlab);
    if (scanPlane && scanPlane.visible) parts.push(scanPlane);
    for (const bm of beamMeshes) if (bm && bm.visible) parts.push(bm);
    for (const sm of beamSourceMeshes) if (sm && sm.visible) parts.push(sm);
    for (const fm of beamFootMeshes) if (fm && fm.visible) parts.push(fm);
    if (parts.length){
      const partHits = app.raycaster.intersectObjects(parts, false);
      if (partHits.length){
        const o = partHits[0].object;
        if (o === plateSlab){ openPartModal('Chladni Plate', plateStats()); return; }
        if (o === scanPlane){ openPartModal('MRI Slice Projection', scanStatsData()); return; }
        const bi = beamMeshes.indexOf(o) >= 0 ? beamMeshes.indexOf(o) : (beamSourceMeshes.indexOf(o) >= 0 ? beamSourceMeshes.indexOf(o) : beamFootMeshes.indexOf(o));
        openPartModal('Beam ' + (bi + 1), beamStats(bi));
        return;
      }
    }
    closeModal();
  });
}

function checkSteps(){
  const exp = app.cur;
  if (!exp) return;
  const ch = app.ch;
  const idx = app.stepIdx.get(exp.id) || 0;
  const t = ch.t;
  for (let i = idx; i < exp.steps.length; i++){
    const st = exp.steps[i];
    if (st.max && t > st.max) continue;
    let on = false;
    try { on = st.when && st.when(ch); } catch { on = false; }
    if (!on) break;
    app.stepIdx.set(exp.id, i + 1);
    if (!app.stepShown[exp.id + ':' + i]){
      app.stepShown[exp.id + ':' + i] = true;
      showEduCard(st);
    }
  }
}

function showEduCard(step){
  const el = document.getElementById('eduCard');
  el.querySelector('.educ-title').textContent = step.title;
  el.querySelector('.educ-body').textContent = step.edu;
  el.classList.add('show');
  clearTimeout(app._eduT);
  app._eduT = setTimeout(() => el.classList.remove('show'), 9000);
}

function pushEvents(){
  const ch = app.ch;
  if (!ch || !ch.events.length) return;
  const cap = 7;
  const el = document.getElementById('eventFeed');
  if (!el) return;
  // Render straight from the (deterministic) event log — a persistent mirror
  // buffer rotated once it outgrew its window: events that fell off the front
  // were seen as "new" again, re-appended, trimmed, and re-appended, flipping
  // the signature every ~90 ms long after pause. Only rebuild when the visible
  // content really changed; otherwise the feed would keep "ticking" post-pause.
  const tail = ch.events[ch.events.length - 1];
  const sig = (tail.t + '|' + tail.msg + '|' + ch.events.length);
  if (el._evSig === sig) return;
  el._evSig = sig;
  el.innerHTML = '';
  for (const ev of ch.events.slice(-cap).reverse()){
    const row = document.createElement('div');
    row.className = 'evt evt-' + ev.kind;
    row.innerHTML = `<span class="evt-t">${fmtFancyTime(ev.t)}</span><span>${ev.msg}</span>`;
    el.appendChild(row);
  }
  // innerHTML wiped the drag grip along with the old rows — re-hook it so the
  // event feed stays moveable, then keep the lone-grip shell hidden while the
  // feed is empty.
  initModuleGrip('eventFeed');
  syncModuleShell('eventFeed');
}

/* ---------- UI wiring ---------- */

function $(id){ return document.getElementById(id); }

function toggleTools(){
  const t = $('toolsPanel');
  if (!t) return;
  const open = t.classList.toggle('open');
  const btn = $('btnToolsToggle');
  if (btn) btn.classList.toggle('active', open);
  if (open){
    renderFeedSlots();
    syncLaser();
    syncMachUi();
  }
  return open;
}

function wireControls(){
  $('mClose').addEventListener('click', closeModal);
  $('btnRun').addEventListener('click', () => {
    app.running = !app.running;
    $('btnRun').classList.toggle('active', app.running);
    $('btnRun').textContent = app.running ? '⏸' : '▶';
  });
  $('btnReset').addEventListener('click', () => {
    loadExperiment(app.cur);
  });
  $('btnRefresh').addEventListener('click', refreshAppUi);
  $('btnToolsToggle').addEventListener('click', toggleTools);
  $('scopeMode').addEventListener('change', () => {
    app.ch.scopeMode = $('scopeMode').value;
    syncScopeUi();
  });

  $('rateMinus').addEventListener('click', () => { if (app.ch) rateStep(-1); });
  $('ratePlus').addEventListener('click', () => { if (app.ch) rateStep(1); });

  $('heat').addEventListener('input', () => {
    applyHeat();
  });
  $('temp').addEventListener('input', applyHeat);
  function applyHeat(){
    const k = parseFloat($('heat').value) || 0;
    const raw = parseFloat($('temp').value);
    const t = Math.exp(Number.isFinite(raw) ? raw : 6.0);
    app.ch.setHeat(k, t);
    $('heatRead').textContent = (k * 100).toFixed(0) + '%';
    $('tempRead').textContent = t.toFixed(0) + ' K';
  }

  wireElements();
  wireCross();
  wireShapes();
  wireChladni();
  wireScope();
  wireGrid();
  wireExport();
  wireMachines();
  wireLaser();
  syncLaser();
  wireInstruments();
  wireMethodsApp();
  syncMachUi();

  window.addEventListener('resize', resize);
}

function refreshAppUi(){
  const w = wrap.clientWidth || window.innerWidth || 800;
  const h = wrap.clientHeight || window.innerHeight || 600;
  if (renderer && renderer.setPixelRatio) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if (renderer && renderer.setSize) renderer.setSize(w, h, false);
  if (renderer && renderer.setClearColor) renderer.setClearColor(0x05070f, 1);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (crossWallState.on){
    const fid = crossWallState.focus && crossWallState.focus.exp ? crossWallState.focus.exp.id : null;
    const old = crossWallState.tiles;
    crossWallState.tiles = old.map((t, i) => {
      const nt = makeWallScene(t.sim, i);
      nt.exp = t.exp;
      t.bondGeo.dispose();
      t.bondMesh.material.dispose();
      t.cageGeo.dispose();
      if (t.plate){ t.plate.geometry.dispose(); t.plate.material.dispose(); }
      for (const m of t.nodes.values()) t.scene.remove(m);
      return nt;
    });
    crossWallState.focus = fid ? crossWallState.tiles.find(t => t.exp && t.exp.id === fid) || null : null;
    wallFocusState.t = crossWallState.focus;
    buildWallOverlay();
    renderCrossWall();
    sparkMsg('refresh · cross wall rebuilt');
    return;
  }
  const ch = app.ch;
  if (ch){
    rebuildNodes();
    removePlateSlab();
    buildChamber();
    refreshShapeUi();
    syncChladniUi();
    syncLaser();
  }
  if (renderer && typeof renderer.clear === 'function') renderer.clear(true, true, true);
  if (typeof renderer.render === 'function') renderer.render(scene, camera);
  sparkMsg('refresh · 3D view rebuilt, atoms untouched');
}

function wireShapes(){
  const wrap = $('shapeList');
  for (const s of SHAPES){
    const b = document.createElement('button');
    b.className = 'chip shapechip';
    b.innerHTML = `<span>${s.icon}</span>${s.label}`;
    b.dataset.shape = s.id;
    b.title = s.help;
    b.onclick = () => setShape(s.id);
    wrap.appendChild(b);
  }
}
function refreshShapeUi(){
  const wrap = $('shapeList');
  const src = app.ch;
  const cur = src ? src.shape : 'cube';
  for (const b of wrap.children){
    if (!b.classList.contains('chip')) continue;
    b.classList.toggle('on', b.dataset.shape === cur);
  }
  $('shapeDesc').textContent = (SHAPES.find(s => s.id === cur) || SHAPES[0]).help;
  const lock = app.cur && app.cur.id === 'chladni';
  $('shapeLock').style.display = lock ? 'block' : 'none';
}

function wireChladni(){
  const wrap = $('modeList');
  for (const md of CHLADNI_MODES){
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = md.name;
    b.dataset.mode = md.m + 'x' + md.n;
    b.onclick = () => {
      app.ch.mode = { m: md.m, n: md.n };
      setActiveChips(wrap, b);
      agitateSand(app.ch, 0.5);
      sparkMsg(`mode ${md.m}×${md.n} — sand re-figures`);
    };
    wrap.appendChild(b);
  }
  $('freqIn').addEventListener('input', () => {
    app.ch.freq = parseFloat($('freqIn').value) || 0;
    $('freqRead').textContent = app.ch.freq.toFixed(0) + ' Hz';
    agitateSand(app.ch, 0.3);
  });
  $('driveIn').addEventListener('input', () => {
    app.ch.drive = parseFloat($('driveIn').value) || 0;
    $('driveRead').textContent = (app.ch.drive * 100).toFixed(0) + '%';
    agitateSand(app.ch, 0.12);
  });
  $('sandReset').addEventListener('click', () => {
    if (app.cur && app.cur.id === 'chladni'){
      app.ch.reset();
      app.ch.spawnSand(app.ch.sandCount || 1600);
      rebuildNodes();
      sparkMsg('sand respread');
    } else sparkMsg('open the Chladni experiment');
  });
}
function syncChladniUi(){
  const isCh = app.cur && app.cur.id === 'chladni';
  $('chladniPanel').classList.toggle('disabled', !isCh);
  if (!app.ch) return;
  const wrap = $('modeList');
  const m = app.ch.mode || { m: 2, n: 2 };
  for (const b of wrap.children){
    if (!b.classList.contains('chip')) continue;
    b.classList.toggle('on', b.dataset.mode === `${m.m}x${m.n}`);
  }
  if ($('freqIn').value != app.ch.freq) $('freqIn').value = app.ch.freq || 0;
  $('freqRead').textContent = (app.ch.freq || 0).toFixed(0) + ' Hz';
  if ($('driveIn').value != app.ch.drive) $('driveIn').value = app.ch.drive || 0;
  $('driveRead').textContent = ((app.ch.drive || 0) * 100).toFixed(0) + '%';
  $('scopeMode').value = app.ch.scopeMode || 'temp';
}

const SCOPE_SOURCES = [
  { id: 'temp', label: 'temperature' },
  { id: 'atom0x', label: 'atom #1 x' },
  { id: 'energy', label: 'peak energy' },
  { id: 'audio', label: 'drive waveform' },
];
function wireScope(){
  const sel = $('scopeMode');
  sel.innerHTML = '';
  for (const s of SCOPE_SOURCES){
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.label;
    sel.appendChild(o);
  }
  sel.value = app.ch && app.ch.scopeMode ? app.ch.scopeMode : 'temp';
}
function syncScopeUi(){
  const el = $('scopeMode');
  if (el && app.ch) el.value = app.ch.scopeMode || 'temp';
}

let scopeLastId = 0;
function drawScope(){
  const cvs = $('scopeCanvas');
  if (!cvs || !app.ch) return;
  const w = cvs.width, h2 = cvs.height;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, w, h2);
  ctx.strokeStyle = 'rgba(90,120,200,0.28)';
  ctx.beginPath();
  ctx.moveTo(0, h2 / 2); ctx.lineTo(w, h2 / 2);
  ctx.stroke();
  const B = app.ch.scopeBuf;
  if (!B) return;
  const n = Math.min(B.length, app.ch.scopeN);
  if (n < 2) return;
  const trail = Math.min(n, 360);
  const off = n % B.length;
  const mid = h2 / 2;
  const yScale = h2 * 0.46;
  ctx.strokeStyle = '#55e08b';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < trail; i++){
    const idx = (off + i) % B.length;
    const x = (i / (trail - 1)) * w;
    const y = mid - clamp(B[idx] || 0, -1.2, 1.2) / 1.2 * yScale;
    if (!started){ ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const freqTxt = app.ch.scopeMode === 'audio' ? ' · ' + (app.ch.freq || 0).toFixed(0) + ' Hz drive' : '';
  ctx.fillStyle = 'rgba(85,224,139,0.7)';
  ctx.font = '12px ui-monospace,monospace';
  ctx.fillText((SCOPE_SOURCES.find(s => s.id === app.ch.scopeMode) || { label: '—' }).label + freqTxt, 8, 14);
}

function setActiveChips(parent, target){
  for (const c of parent.children){
    if (c.classList.contains('chip')) c.classList.toggle('on', c === target);
  }
}

/* fresh experiments load paused at the slowest rate so the opening activity is never missed */
function pauseAtSlowest(fs = RATE_TICKS[0].fs){
  app.running = false;
  const run = $('btnRun');
  if (run){ run.classList.remove('active'); run.textContent = '▶'; }
  if (app.ch){ app.ch._rate = fs; app.ch.setRate(fs); }
  syncRatePill();
}

function indexOfClosest(arr, fs){
  let best = 0, bestD = Infinity;
  for (let i = 0; i < arr.length; i++){
    const d = Math.abs(arr[i].fs - fs);
    if (d < bestD){ bestD = d; best = i; }
  }
  return best;
}

function rateStep(d){
  if (!app.ch) return;
  const i = clamp(indexOfClosest(RATE_TICKS, app.ch.substeps * app.ch.dt) + d, 0, RATE_TICKS.length - 1);
  app.ch.setRate(RATE_TICKS[i].fs);
  syncRatePill();
}

function syncRatePill(){
  const pill = $('ratePill');
  if (!pill || !app.ch) return;
  const fs = app.ch.substeps * app.ch.dt;
  const r = RATE_TICKS[indexOfClosest(RATE_TICKS, fs)];
  pill.textContent = r.label + ' · ' + fmtFancyTime(app.ch.dt) + '/step';
}

function wireElements(){
  const panel = $('elementsPanel');
  const famWrap = $('famList');
  for (const f of FAMILIES){
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = f.label;
    b.onclick = () => {
      const on = b.classList.toggle('on');
      for (const z of f.zs) on ? app.selZ.add(z) : app.selZ.delete(z);
      syncSelUi();
    };
    famWrap.appendChild(b);
  }
  buildPerioGrid();
  function buildPerioGrid(){
    const grid = $('perioGrid');
    for (const e of DATA){
      const b = document.createElement('button');
      b.className = 'cell';
      b.dataset.z = e.z;
      b.textContent = e.s;
      b.style.setProperty('--cpk', e.cpk || '#888');
      b.onclick = () => {
        const on = !app.selZ.has(e.z);
        on ? app.selZ.add(e.z) : app.selZ.delete(e.z);
        b.classList.toggle('on', on);
      };
      grid.appendChild(b);
    }
  }
  function syncSelUi(){
    for (const b of $('perioGrid').children){
      b.classList.toggle('on', app.selZ.has(parseInt(b.dataset.z, 10)));
    }
  }
  app.syncSelUi = syncSelUi;
  $('btnAddSel').addEventListener('click', () => {
    if (!app.selZ.size){ sparkMsg('pick elements first'); return; }
    let n = 0;
    for (const z of app.selZ){
      const el = elByZ.get(z);
      const cnt = z === 1 ? 2 : 1;
      for (let i = 0; i < cnt; i++){ app.ch.spawn(z, { temp: app.ch.T_target ?? 300 }); n++; }
      if (el && (el.cat === 'Noble gas' || el.z === 2)) { }
      if (el && el.z >= 92) app.ch.cross.decayBoost = app.ch.cross.decayBoost || 0.6;
    }
    app.ch.setRate(app.ch._rate || 2e4);
    rebuildNodes();
    sparkMsg(`+${n} atoms`);
  });
  $('btnAddAll').addEventListener('click', () => {
    app.ch.spawnAll();
    app.ch.setRate(app.ch._rate || 2e4);
    rebuildNodes();
    sparkMsg('whole table spawned');
  });
  $('btnEveryday').addEventListener('click', () => {
    everydayMixture(app.ch);
    rebuildNodes();
    sparkMsg('everyday mixture');
  });
  $('btnClear').addEventListener('click', () => {
    app.ch.reset();
    rebuildNodes();
  });
  $('btnElemToggle').addEventListener('click', () => {
    const on = !panel.classList.contains('open');
    panel.classList.toggle('open', on);
    $('btnElemToggle').classList.toggle('active', on);
    if (on && !modHasSavedPos('elementsPanel')){
      const moved = panel.style.left || panel.style.top;
      if (!moved) centerMod('elementsPanel');
    }
  });
}

function wireCross(){
  const wrapEl = $('crossList');
  for (const p of CROSS_PRESETS){
    const b = document.createElement('button');
    b.className = 'chip crosschip';
    b.innerHTML = `<span>${p.icon}</span>${p.label}`;
    b.onclick = () => {
      setActiveChips(wrapEl, b);
      applyCross(p);
    };
    wrapEl.appendChild(b);
  }
  function applyCross(p){
    applyCrossPresetReal(p, syncCrossLab);
    syncCrossLab();
  }
  function syncCrossLab(){
    const frame = $('crosslabFrame');
    if (!frame) return;
    const p = CROSS_PRESETS.find(x => x.id === app.ch.cross.preset);
    if (p && p.id !== 'off'){
      const url = `crosslab/physics_simulator.html?ui=0&preset=${p.id}`;
      if (frame.dataset.src !== url){ frame.dataset.src = url; frame.src = url; }
      frame.style.display = 'block';
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'set', cfg: snapshotCross() }, '*');
    } else {
      frame.dataset.src = '';
      frame.style.display = 'none';
    }
  }
  window.addEventListener('message', (e) => {
    if (e.source !== frameSrc()) return;
    const d = e.data;
    if (d && d.type === 'sample'){
      updateCrossReadout(d);
    }
  });
}
function frameSrc(){
  const f = $('crosslabFrame');
  return f && f.contentWindow;
}
function snapshotCross(){
  const p = CROSS_PRESETS.find(x => x.id === app.ch.cross.preset) || { fields: {} };
  const out = {};
  for (const k in p.fields) out[k] = app.ch.cross[k];
  return out;
}
function updateCrossReadout(d){
  const el = $('crossReadout');
  if (!el || !d) return;
  el.textContent = `${d.preset || ''} · bodies ${d.bodies ?? '—'} · τ ${d.time ?? '—'}`;
}

/* ---------- machine presets + timed feeder ---------- */

function elBySym(sym){
  const s = String(sym || '').trim().toLowerCase();
  if (!s) return null;
  for (const e of DATA) if (e.s && e.s.toLowerCase() === s) return e;
  return null;
}

const MACH_SLIDERS = [
  ['machB', 'machBRead', 'B'],
  ['machE', 'machERead', 'E'],
  ['machP', 'machPRead', 'power'],
];

function buildMachChips(wrapId){
  const wrapEl = $(wrapId);
  if (!wrapEl) return;
  for (const m of MACHINES){
    const b = document.createElement('button');
    b.className = 'chip machchip';
    b.innerHTML = `<span>${m.icon}</span>${m.label}`;
    b.dataset.mach = m.id;
    b.onclick = () => {
      setActiveChips(wrapEl, b);
      applyMachine(m);
    };
    wrapEl.appendChild(b);
  }
}

function bindMachSlider(id, read, k){
  $(id).addEventListener('input', () => {
    if (!app.ch) return;
    const v = parseFloat($(id).value) || 0;
    app.ch[k] = k === 'power' ? clamp(v, 0, 1) : v;
    syncMachFields();
    syncMachRead();
  });
}

function syncMachFields(){
  if (!app.ch) return;
  for (const [id, read, k] of MACH_SLIDERS){
    const el = $(id);
    if (el && Math.abs((el.value || 0) - (app.ch[k] || 0)) > 1e-9) el.value = app.ch[k] || 0;
    const rd = $(read);
    if (rd) rd.textContent = formatField(k, app.ch[k] || 0);
  }
}

function armFeed(){
  if (!app.ch) return;
  app.ch.feederOn = !app.ch.feederOn;
  syncFeedArm();
  sparkMsg(app.ch.feederOn ? 'auto mode on — slots fire on schedule' : 'auto mode off — only ⇢ now fires');
}

function feedNow(){
  if (!app.ch) return;
  let n = 0;
  for (const s of app.ch.feed){ if (s.enabled && s.z != null) n += app.ch.feedNow(s.z, s.n, s.inlet); }
  if (n){ rebuildNodes(); sparkMsg('⇢ injected ' + n + ' atoms'); }
  else sparkMsg('no armed feed slots — add one first');
  syncMachUi();
}

function addFeed(){
  if (!app.ch) return;
  app.ch.addFeed({ z: 1, n: 1, every: 5e4, start: 0 });
  renderFeedSlots();
  syncMachRead();
}

function wireSlotRows(slots){
  if (!slots) return;
  slots.addEventListener('input', (e) => {
    const t = e.target || e.srcElement;
    if (!t || !t.classList) return;
    const row = t.closest && t.closest('.frow');
    if (!row) return;
    const i = parseInt(row.dataset.i, 10);
    const s = app.ch && app.ch.feed[i];
    if (!s) return;
    if (t.classList.contains('fsym')){
      const el = elBySym(t.value);
      row.classList.toggle('bad', !el);
      s.z = el ? el.z : null;
      if (el) row.title = '#' + el.z + ' ' + el.name;
    } else if (t.classList.contains('fn')) s.n = Math.max(1, Math.min(500, parseInt(t.value, 10) || 1));
    else if (t.classList.contains('fev')) s.every = Math.max(1, parseFloat(t.value) || 1);
    else if (t.classList.contains('fst')) s.start = Math.max(0, parseFloat(t.value) || 0);
  });
  slots.addEventListener('click', (e) => {
    const t = e.target || e.srcElement;
    if (!t || !t.classList) return;
    const act = t.classList.contains('on') || t.classList.contains('del') ? t : null;
    if (!act) return;
    const row = t.closest && t.closest('.frow');
    const i = row ? parseInt(row.dataset.i, 10) : -1;
    const s = app.ch && app.ch.feed[i];
    if (!s) return;
    if (act.classList.contains('on')){
      s.enabled = !s.enabled;
      act.classList.toggle('on', s.enabled);
      act.textContent = s.enabled ? '●' : '○';
    } else if (act.classList.contains('del')){
      app.ch.feed.splice(i, 1);
      renderFeedSlots();
    }
    syncMachRead();
  });
}

function wireMachines(){
  buildMachChips('machList');
  for (const [id, read, k] of MACH_SLIDERS) bindMachSlider(id, read, k);
  for (const id of ['feedArmToggle']) $(id).addEventListener('click', armFeed);
  for (const id of ['feedNowBtn']) $(id).addEventListener('click', feedNow);
  for (const id of ['feedAdd']) $(id).addEventListener('click', addFeed);
  wireSlotRows($('feedSlots'));
}

function formatField(k, v){
  if (k === 'B') return v.toFixed(2) + ' T';
  if (k === 'E') return v.toFixed(2) + ' MV/m';
  return (v * 100).toFixed(0) + '%';
}

const LASER_TYPES = [
  { t: 'ray', icon: '─', label: 'ray', help: 'Continuous collimated ray — steady heating, excitation, photo-ionization above 75% power along a thin line.' },
  { t: 'pulse', icon: '⋮', label: 'pulse', help: 'Bursts at up to 1 kHz — each photon lands as a hard kick, great for ablation and unzipping bonds.' },
  { t: 'trap', icon: '◎', label: 'trap', help: 'Optical tweezers — a gradient force holds atoms on the beam line. Crank "grip" to grab them.' },
  { t: 'flood', icon: '▦', label: 'flood', help: 'Wide soft illumination — spreads a few times the spot width for broad, gentle heating with no ionization.' },
];
const BEAM_AXES = ['x', '-x', 'y', '-y', 'z', '-z'];
const AXIS_LABEL = { 'x': '+X', '-x': '−X', 'y': '+Y', '-y': '−Y', 'z': '+Z', '-z': '−Z' };

/* Source mounts: every emitter direction the beam bank can face. Axes keep the
   crisp axis-aligned physics path; diagonals/corners use the generic unit vector. */
const BEAM_AXIS_DIRS  = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const BEAM_DIAG_DIRS  = [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]];
const BEAM_CORNER_DIRS= [[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]];
const BEAM_DIRS = BEAM_AXIS_DIRS.concat(BEAM_DIAG_DIRS, BEAM_CORNER_DIRS);   // 26 mounts = every angle
const RIGS = {
  octa: BEAM_AXIS_DIRS,         // 6 axis emitters
  ring18: BEAM_AXIS_DIRS.concat(BEAM_DIAG_DIRS),  // 18 = axes + face diagonals
  full26: BEAM_DIRS,            // 26 = everything, corners included
};
const dirLabel = (d) => {
  const L = ['X','Y','Z'];
  let s = '';
  for (let i = 0; i < 3; i++){
    if (d[i] > 0) s += '+' + L[i];
    else if (d[i] < 0) s += '−' + L[i];
  }
  return s || '·';
};
const beamDirVec = (b) => {
  if (b.d && (b.d[0] || b.d[1] || b.d[2])){
    const il = 1 / Math.hypot(b.d[0], b.d[1], b.d[2] || 0);
    return [b.d[0] * il, b.d[1] * il, (b.d[2] || 0) * il];
  }
  const ax = b.axis || 'y';
  const dd = b.dir >= 0 ? 1 : -1;
  return [ax === 'x' ? dd : 0, ax === 'y' ? dd : 0, ax === 'z' ? dd : 0];
};
const dirsEqual = (u, v) => Math.abs(u[0] - v[0]) < 0.05 && Math.abs(u[1] - v[1]) < 0.05 && Math.abs(u[2] - v[2]) < 0.05;
/* Traverse basis: two unit vectors spanning the plane perpendicular to a beam's
   aim, so the "off U / off V" sliders can slide its line sideways. */
const beamTraverse = (ud) => {
  const b0 = ud[0], b1 = ud[1], b2 = ud[2];
  const vv = Math.abs(b2) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = [b1 * vv[2] - b2 * vv[1], b2 * vv[0] - b0 * vv[2], b0 * vv[1] - b1 * vv[0]];
  const v = [b1 * u[2] - b2 * u[1], b2 * u[0] - b0 * u[2], b0 * u[1] - b1 * u[0]];
  const nu = Math.hypot(u[0], u[1], u[2]) || 1;
  const nv = Math.hypot(v[0], v[1], v[2]) || 1;
  return [[u[0] / nu, u[1] / nu, u[2] / nu], [v[0] / nv, v[1] / nv, v[2] / nv]];
};
const beamOffMax = () => (app.ch && app.ch.size ? app.ch.size * S : 1.5);
const beamIsOffCenter = (b) => !!b && !!(b.offx || b.offy || b.offz);

function selBeam(ch){
  // selected beam tuple: battery of controls edit one beam at a time
  const beams = (ch && ch.beams) || [];
  if (!beams.length) return null;
  return beams[Math.min(ch._beamSel || 0, beams.length - 1)];
}
function beamLabel(b, i){
  const t = LASER_TYPES.find(x => x.t === (b.type || 'ray'));
  return `${t ? t.icon : '·'}${i + 1} ${dirLabel(beamDirVec(b))}${beamIsOffCenter(b) ? ' ⊞' : ''}${b.on ? ' ●' : ''}`;
}

function wireLaser(){
  const tlw = $('laserTypeList');
  if (tlw){
    tlw.innerHTML = '';
    for (const k of LASER_TYPES){
      const b = document.createElement('button');
      b.className = 'chip ltype';
      b.dataset.t = k.t;
      b.innerHTML = `<span>${k.icon}</span>${k.label}`;
      b.addEventListener('click', () => {
        if (!app.ch) return;
        const t = selBeam(app.ch);
        if (t){ t.type = k.t; }
        syncLaser();
        sparkMsg(`${k.label} beam armed`);
      });
      tlw.appendChild(b);
    }
  }
  const beamList = $('beamList');
  if (beamList) beamList.addEventListener('click', (e) => {
    if (!app.ch || !e || !e.target) return;
    const c = e.target.closest ? e.target.closest('.bchip') : null;
    if (!c || !c.dataset || c.dataset.i === undefined) return;
    app.ch._beamSel = clamp(parseInt(c.dataset.i, 10) || 0, 0, app.ch.beams.length - 1);
    syncLaser();
  });
  const badd = $('beamAddBtn');
  if (badd) badd.addEventListener('click', () => {
    if (!app.ch) return;
    app.ch.beamAdd('ray');
    app.ch._beamSel = app.ch.beams.length - 1;
    syncLaser();
    sparkMsg('beam added — pick an axis and type');
  });
  const brem = $('beamRemoveBtn');
  if (brem) brem.addEventListener('click', () => {
    if (!app.ch) return;
    const sel = Math.min(app.ch._beamSel || 0, app.ch.beams.length - 1);
    if (app.ch.beamRemove(sel)) app.ch._beamSel = Math.min(sel, app.ch.beams.length - 1);
    syncLaser();
  });
  const t = $('laserArm');
  if (t) t.addEventListener('click', () => {
    if (!app.ch) return;
    const b = selBeam(app.ch);
    if (b) b.on = !b.on;
    syncLaser();
    sparkMsg(b && b.on ? '⦿ beam on' : 'beam off');
  });
  const pw = $('laserPower');
  if (pw) pw.addEventListener('input', () => {
    if (!app.ch) return;
    const b = selBeam(app.ch);
    if (b){ b.power = clamp(parseFloat(pw.value) || 0, 0, 1); b.on = b.power > 0.01; }
    syncLaser();
  });
  const sp = $('laserSpotIn');
  if (sp) sp.addEventListener('input', () => {
    if (!app.ch) return;
    const b = selBeam(app.ch);
    if (b) b.spot = clamp((parseFloat(sp.value) || 16) / 100, 0.05, 0.5);
    syncLaser();
  });
  const rt = $('laserRateIn');
  if (rt) rt.addEventListener('input', () => {
    if (!app.ch) return;
    const b = selBeam(app.ch);
    if (b) b.rate = Math.max(0.1, parseFloat(rt.value) || 10);
    syncLaser();
  });
  const gr = $('laserGripIn');
  if (gr) gr.addEventListener('input', () => {
    if (!app.ch) return;
    const b = selBeam(app.ch);
    if (b) b.grip = clamp(parseFloat(gr.value) || 0.5, 0, 1);
    syncLaser();
  });
  const axw = $('laserAxisChips');
  if (axw) axw.addEventListener('click', (e) => {
    if (!app.ch || !e || !e.target) return;
    const c = e.target.closest ? e.target.closest('.laxis') : null;
    if (!c || !c.dataset || !c.dataset.a) return;
    const b = selBeam(app.ch);
    if (!b) return;
    const a = c.dataset.a;
    b.axis = a.replace(/^[-+]/, '') || 'y';
    b.dir = /^-/.test(a) ? -1 : 1;
    b.d = null;   // back to a crisp axis mount
    syncLaser();
  });
  const mnt = $('laserMountChips');
  if (mnt) mnt.addEventListener('click', (e) => {
    if (!app.ch || !e || !e.target) return;
    const c = e.target.closest ? e.target.closest('.lmount') : null;
    if (!c || !c.dataset || c.dataset.m === undefined) return;
    const b = selBeam(app.ch);
    if (!b){ sparkMsg('＋ add a beam first'); return; }
    const d = BEAM_DIRS[parseInt(c.dataset.m, 10) || 0];
    if (!d) return;
    b.d = d.slice();
    syncLaser();
    sparkMsg('beam source → ' + dirLabel(d) + ' — every angle is a mount');
  });
  const rigs = $('laserRigs');
  if (rigs){
    rigs.innerHTML = '';
    for (const r of [['octa', '⬡ six'], ['ring18', '⬢ 18'], ['full26', '✹ every angle']]){
      const c = document.createElement('button');
      c.className = 'chip lrig';
      c.dataset.rig = r[0];
      const lab = document.createElement('span');
      lab.textContent = r[1] + ' · ';
      const rc = document.createElement('b');
      rc.className = 'rc';
      rc.textContent = '0';
      const spin = document.createElement('span');
      spin.className = 'spin';
      spin.style.setProperty('--p', '0%');
      c._rc = rc; c._spin = spin;
      c.appendChild(lab); c.appendChild(rc); c.appendChild(spin);
      c.addEventListener('click', () => {
        if (!app.ch) return;
        const v = RIGS[r[0]];
        app.ch.beams.length = 0;
        for (const d of v) app.ch.beamAdd('ray', { axis: 'x', dir: 1, d });
        app.ch._beamSel = app.ch.beams.length - 1;
        syncLaser();
        sparkMsg('＋' + v.length + ' sources mounted — every angle covered, retune powers to taste');
      });
      rigs.appendChild(c);
    }
  }
  const offEls = { u: $('laserOffU'), v: $('laserOffV') };
  const applyOff = () => {
    if (!app.ch) return;
    const b = selBeam(app.ch);
    if (!b) return;
    const R = beamOffMax();
    const [u, v] = beamTraverse(beamDirVec(b));
    const pu = parseFloat(offEls.u.value) / 100 || 0;
    const pv = parseFloat(offEls.v.value) / 100 || 0;
    b.offx = R * (pu * u[0] + pv * v[0]);
    b.offy = R * (pu * u[1] + pv * v[1]);
    b.offz = R * (pu * u[2] + pv * v[2]);
    syncLaser();
    sparkMsg('beam line traversed ' + (pu || pv) * 100 + '% off-axis');
  };
  if (offEls.u) offEls.u.addEventListener('input', applyOff);
  if (offEls.v) offEls.v.addEventListener('input', applyOff);
}

function syncLaser(){
  const ch = app.ch;
  const beams = (ch && ch.beams) || [];
  const b = beams[Math.min(ch ? (ch._beamSel || 0) : 0, beams.length - 1)];
  const on = !!(b && b.on && b.power > 0.01);
  const type = b ? (b.type || 'ray') : 'ray';
  const bsel = ch ? Math.min(ch._beamSel || 0, beams.length - 1) : 0;
  const bl = $('beamList');
  if (bl){
    bl.innerHTML = '';
    if (beams.length) for (let i = 0; i < beams.length; i++){
      const c = document.createElement('button');
      c.className = 'chip bchip' + (i === bsel ? ' on' : '');
      c.dataset.i = String(i);
      c.textContent = beamLabel(beams[i], i);
      bl.appendChild(c);
    }
  }
  const arm = $('laserArm');
  if (arm){
    arm.textContent = on ? 'arm ●' : 'off ○';
    arm.style.background = on ? 'var(--good)' : 'var(--line)';
    arm.style.color = on ? '#063' : 'var(--txt)';
  }
  const pw = $('laserPower');
  if (pw && b && Math.abs((pw.value || 0) - b.power) > 1e-9) pw.value = b.power || 0;
  const rd = $('laserPRead');
  if (rd) rd.textContent = b ? Math.round((b.power || 0) * 100) + '%' : '0%';
  const sp = $('laserSpotIn');
  if (sp && b && Math.abs((sp.value || 0) - b.spot * 100) > 1e-9) sp.value = b.spot * 100 || 16;
  const srd = $('laserSpotRead');
  if (srd) srd.textContent = b ? Math.round((b.spot || 0.16) * 100) + '%' : '16%';
  const rt = $('laserRateIn');
  if (rt && b && Math.abs((rt.value || 0) - b.rate) > 1e-9) rt.value = b.rate || 10;
  const rrd = $('laserRateRead');
  if (rrd) rrd.textContent = b ? Math.round(b.rate || 10) + ' Hz' : '10 Hz';
  const gr = $('laserGripIn');
  if (gr && b && Math.abs((gr.value || 0) - b.grip) > 1e-9) gr.value = b.grip || 0.5;
  const grd = $('laserGripRead');
  if (grd) grd.textContent = b ? Math.round((b.grip || 0.5) * 100) + '%' : '50%';
  const wv = $('laserWavIn');
  if (wv && b && Math.abs((wv.value || 0) - (b.wav || 532)) > 1e-9) wv.value = b.wav || 532;
  const wrd = $('laserWavRead');
  if (wrd) wrd.textContent = b ? Math.round(b.wav || 532) + ' nm · ' + (1240 / (b.wav || 532)).toFixed(2) + ' eV' : '532 nm';
  const dly = $('laserDelIn');
  if (dly && b && Math.abs((dly.value || 0) - (b.delay || 0) * 100) > 1e-9) dly.value = Math.round((b.delay || 0) * 100);
  const drd = $('laserDelRead');
  if (drd) drd.textContent = b ? Math.round((b.delay || 0) * 100) + '%' : '0%';
  const pr = $('laserPulseRow');
  if (pr) pr.style.display = type === 'pulse' ? '' : 'none';
  const gir = $('laserGripRow');
  if (gir) gir.style.display = type === 'trap' ? '' : 'none';
  const tlw = $('laserTypeList');
  if (tlw){
    for (const c of tlw.children){
      if (!c.classList || !c.classList.contains('chip')) continue;
      c.classList.toggle('on', c.dataset.t === type);
    }
  }
  const axw = $('laserAxisChips');
  if (axw){
    axw.innerHTML = '';
    for (const a of BEAM_AXES){
      const c = document.createElement('button');
      c.className = 'chip laxis' + (b && !b.d && (b.dir < 0 ? '-' : '') + (b.axis || 'y') === a ? ' on' : '');
      c.dataset.a = a;
      c.textContent = AXIS_LABEL[a];
      axw.appendChild(c);
    }
  }
  const mnt = $('laserMountChips');
  if (mnt){
    mnt.innerHTML = '';
    const bd = b ? beamDirVec(b) : [0, 1, 0];
    for (let i = 0; i < BEAM_DIRS.length; i++){
      const d = BEAM_DIRS[i];
      const c = document.createElement('button');
      c.className = 'chip lmount' + (b && dirLabel(bd) === dirLabel(d) ? ' on' : '');
      c.dataset.m = String(i);
      c.textContent = dirLabel(d);
      mnt.appendChild(c);
    }
  }
  // traverse sliders: project the beam's offset back onto U/V so the controls stay honest
  {
    const R = beamOffMax() || 1;
    const [u, v] = b ? beamTraverse(beamDirVec(b)) : [[0, 0, 1], [1, 0, 0]];
    const projU = b ? (b.offx * u[0] + b.offy * u[1] + b.offz * u[2]) / R : 0;
    const projV = b ? (b.offx * v[0] + b.offy * v[1] + b.offz * v[2]) / R : 0;
    const rows = [['laserOffU', 'laserOffURead', projU], ['laserOffV', 'laserOffVRead', projV]];
    for (const [id, rid, proj] of rows){
      const el = $(id);
      if (!el) continue;
      const pct = Math.round(clamp(proj, -1, 1) * 100);
      if (Math.abs((el.value || 0) - pct) > 1e-9) el.value = pct;
      const rd = $(rid);
      if (rd) rd.textContent = (pct === 0 ? '0' : (pct > 0 ? '+' : '−') + Math.abs(pct)) + '%';
    }
  }
  // rig spinner badges: live armed count + conic fraction per rig
  const rigs = $('laserRigs');
  if (rigs){
    for (const c of rigs.children){
      if (!c.dataset || !c.dataset.rig) continue;
      const dd = RIGS[c.dataset.rig] || [];
      let armed = 0, tot = 0;
      for (const bb of beams){
        const bdLabel = dirLabel(beamDirVec(bb));
        const onRig = dd.some(d => dirLabel(d) === bdLabel);
        tot += onRig ? 1 : 0;
        if (bb.on && bb.power > 0.01 && onRig) armed++;
      }
      const badge = c._rc;
      const sp = c._spin;
      const pct = tot ? Math.round(armed / tot * 100) : 0;
      c.dataset.armed = String(armed);
      c.dataset.count = String(tot);
      if (badge) badge.textContent = String(armed);
      if (sp) sp.style.setProperty('--p', pct + '%');
      if (armed > 0) c.classList.add('spinny'); else c.classList.remove('spinny');
    }
  }
  const desc = $('laserDesc');
  if (desc){
    const k = LASER_TYPES.find(x => x.t === type);
    desc.textContent = (k ? k.help : '') + (beams.length > 1 ? ' · each beam acts independently — stack them for molasses, criss-cross traps, multi-axis heating.' : ' · ＋ add beam to fire from another angle.');
  }
  syncMachRead();
}

function syncFeedArm(){
  const on = app.ch && app.ch.feederOn;
  const b = $('feedArmToggle');
  if (!b) return;
  b.textContent = on ? 'auto ●' : 'auto ○';
  b.style.background = on ? 'var(--good)' : 'var(--line)';
  b.style.color = on ? '#063' : 'var(--txt)';
}

const FEED_HEAD = '<div class="fhead"><span class="hsym">el</span><span class="hn">n</span><span class="hev">every</span><span class="hst">start</span><span class="hgap"></span></div>';

function renderFeedSlots(){
  if (!app.ch) return;
  const rows = app.ch.feed.map((s, i) => {
    const el = s.z != null ? app.ch.elByZ.get(s.z) : null;
    const ttl = el ? '#' + el.z + ' ' + el.name : 'set a valid element symbol';
    return `<div class="frow${s.z == null || !el ? ' bad' : ''}" data-i="${i}" title="${ttl}">
      <input class="fsym" value="${el ? el.s : ''}" placeholder="el" title="element symbol">
      <input class="fn" type="number" min="1" max="500" value="${s.n}" title="atoms per shot">
      <input class="fev" type="number" min="1" step="1000" value="${s.every}" title="repeat every (fs)">
      <input class="fst" type="number" min="0" step="1000" value="${s.start}" title="start at (fs)">
      <span class="fact on" title="arm slot">${s.enabled ? '●' : '○'}</span>
      <span class="fact del" title="remove">×</span></div>`;
  });
  const body = FEED_HEAD + rows.join('');
  const slots = $('feedSlots');
  if (slots) slots.innerHTML = body;
  syncFeedArm();
}

function syncMachRead(){
  if (!app.ch) return;
  const m = MACHINES.find(x => x.id && x.shape === app.ch.shape);
  const armed = (app.ch.beams || []).filter(b => b.on && b.power > 0.01).length;
  const fields = `B ${formatField('B', app.ch.B)} · E ${formatField('E', app.ch.E)} · P ${formatField('power', app.ch.power)}${armed > 0 ? ' · ☀ ' + armed + '×' : ''}`;
  const rd = $('machRead');
  if (rd) rd.textContent = fields;
  const jitter = `${app.ch.atoms.length} atoms · ⇢ ${app.ch.feedTotal} fed ${app.ch.feederOn ? '· auto ●' : ''}`;
  const crd = $('machCountRead');
  if (crd) crd.textContent = jitter;
}

function syncMachUi(){
  const ch = app.ch;
  if (!ch) return;
  const wrap = $('machList');
  if (wrap){
    for (const b of wrap.children){
      if (!b.classList.contains('chip')) continue;
      const m = MACHINES.find(x => x.id === b.dataset.mach);
      b.classList.toggle('on', !!m && m.shape === ch.shape && Math.abs((m.B || 0) - (ch.B || 0)) < 0.05 && Math.abs((m.E || 0) - (ch.E || 0)) < 0.05 && Math.abs((m.power || 0) - (ch.power || 0)) < 0.02);
    }
  }
  syncMachFields();
  const desc = $('machDesc');
  if (desc){
    const m = MACHINES.find(x => x.id && x.shape === ch.shape);
    desc.textContent = m ? m.icon + ' ' + m.tag + ' — ' + m.desc : 'Custom rig — tweak fields or add feed slots below.';
  }
  renderFeedSlots();
  syncMachRead();
}

function applyMachine(m){
  const ch = app.ch;
  if (!ch) return;
  if (app.cur && app.cur.id === 'chladni'){
    sparkMsg('the machine takes over the plate — no sand');
    return;
  }
  const before = ch.atoms.length;
  ch.size = m.size;
  ch.shape = m.shape;
  ch.wallInset = m.wallInset ?? 0.12;
  ch.T_target = m.T;
  ch.setHeat(m.power > 0 ? 0.5 : 0, m.T);
  Object.assign(ch, { B: m.B || 0, E: m.E || 0, power: m.power || 0, Baxis: m.Baxis || 'y', Edir: m.Edir || 'x' });
  if (m.id === 'tokamak' || m.id === 'stellarator' || m.id === 'beam' || m.id === 'sputter'){
    for (const a of ch.atoms) a.q = a.q || 1;      // ionize the live seed so fields visibly act
  }
  fitAtomsToShape(ch);
  removePlateSlab();
  buildChamber();
  rebuildNodes();
  refreshShapeUi();
  syncChladniUi();
  syncMachUi();
  syncLaser();
  updateStepHud();
  pauseAtSlowest(m.rate || 1e5);
  syncMachRead();
  sparkMsg(`${m.icon} ${m.label} · B ${m.B || 0} T · E ${m.E || 0} MV/m · P ${(m.power * 100).toFixed(0)}% · ${before} atoms kept`);
}

function preselectExperimentElements(){
  if (!app.ch || !app.selZ) return;
  if (!app.selZ || typeof app.selZ.clear !== 'function') return;
  app.selZ.clear();
  for (const a of app.ch.atoms) app.selZ.add(a.el.z);
  if (typeof app.syncSelUi === 'function') app.syncSelUi();
}

function loadExperiment(exp, reuse = null){
  app.cur = exp;
  app.stepIdx.delete(exp.id);
  let ch = reuse;
  if (!ch){
    ch = new Chamber(DATA, {
      size: exp.id === 'all' ? 3.4 : exp.id === 'salt' ? 1.7 : exp.id === 'decay' ? 2.0 : 2.4,
      T: 300,
    });
    ch._rate = ch.dt * ch.substeps;
    exp.setup(ch);
  }
  app.ch = ch;
  rebuildNodes();
  removePlateSlab();
  buildChamber();
  refreshShapeUi();
  syncChladniUi();
  syncScopeUi();
  if (crossWallState.on) closeCrossWall();
  if (scanState.on) updateScan();
  $('expTitle').textContent = exp.name;
  $('expTag').textContent = exp.tag;
  $('expGoal').textContent = 'Goal: ' + exp.goal;
  $('expDesc').textContent = exp.desc;
  closeModal();
  preselectExperimentElements();
  updateStepHud();
  document.getElementById('goalPanel').classList.remove('open');
  pauseAtSlowest();
}

/* Re-fit the live experiment into the current cage: geometry changes must keep the
   user's setup, not re-seed it. Tube chambers (stellarator 'helix', tokamak 'torus')
   ribbon every atom evenly along the tube so the seed visibly threads the boundary;
   other shapes dock out-of-bound atoms onto the nearest contained point and zero
   their frame-start positions. Bonds, elements, charges and feed slots all stay. */
function fitAtomsToShape(ch){
  if (ch.shape === 'helix' || ch.shape === 'torus' || ch.shape === 'rose' || ch.shape === 'crown' || ch.shape === 'spire'){
    ribbonAtoms(ch);
    return;
  }
  for (const a of ch.atoms){
    const pad = ch.wallInset + a.r;
    if (!ch.contains(a.x, a.y, a.zz, pad)){
      const p = shapeClampPoint(ch, a.x, a.y, a.zz, ch.size, pad * 0.85);
      a.x = p[0]; a.y = p[1]; a.zz = p[2];
    }
    a.px0 = a.x; a.py0 = a.y; a.pz0 = a.zz;
  }
}

function ribbonAtoms(ch){
  const n = ch.atoms.length;
  if (!n) return;
  const h = ch.size;
  const rng = ch.rng || Math.random;
  let i = 0;
  for (const a of ch.atoms){
    const pad = (ch.wallInset || 0.12) + (a.r || 0);
    if (ch.shape === 'helix' || ch.shape === 'rose' || ch.shape === 'crown' || ch.shape === 'spire'){
      const kp = knotParams(ch.shape) || { P: 2, Q: 3, tube: 0.24 };
      const rTube = Math.max(0.05, (kp.tube || 0.24) * h);
      const t = ((i + rng() * 0.6) / n) * Math.PI * 2;
      const cpt = torusKnotPointC(t, h, undefined, kp.P, kp.Q);
      const tpt = torusKnotPointC(t, h, rng() * Math.PI * 2, kp.P, kp.Q);
      const d = Math.hypot(tpt[0] - cpt[0], tpt[1] - cpt[1], tpt[2] - cpt[2]);
      const frac = d > 1e-9 ? Math.max(0, rTube - pad) / d : 0;
      a.x = cpt[0] + (tpt[0] - cpt[0]) * frac;
      a.y = cpt[1] + (tpt[1] - cpt[1]) * frac;
      a.zz = cpt[2] + (tpt[2] - cpt[2]) * frac;
    } else {
      const R = h * 0.72, r = h * 0.34;
      const th = ((i + rng() * 0.6) / n) * Math.PI * 2;
      const u = rng() * Math.PI * 2;
      const rr = Math.max(0, r - pad);
      a.x = (R + rr * Math.cos(u)) * Math.cos(th);
      a.y = rr * Math.sin(u);
      a.zz = (R + rr * Math.cos(u)) * Math.sin(th);
    }
    a.vx = 0; a.vy = 0; a.vz = 0;
    a.px0 = a.x; a.py0 = a.y; a.pz0 = a.zz;
    i++;
  }
}

function setShape(id){
  if (app.cur && app.cur.id === 'chladni'){
    sparkMsg('chladni sand needs the plate — shape is fixed');
    return;
  }
  if (!app.ch) return;
  const ch = app.ch;
  const meta = SHAPES.find(s => s.id === id);
  if (!meta) return;
  if (ch.shape === id){ sparkMsg('chamber already ' + meta.label); return; }
  const before = ch.atoms.length;
  ch.shape = id;
  fitAtomsToShape(ch);
  removePlateSlab();
  buildChamber();
  rebuildNodes();
  if (crossWallState.on) closeCrossWall();
  if (scanState.on) updateScan();
  refreshShapeUi();
  syncChladniUi();
  syncScopeUi();
  updateStepHud();
  sparkMsg('chamber → ' + meta.label + ' · environment geometry only · ' + before + ' atoms kept in-bounds');
  pauseAtSlowest();
}

function updateStepHud(){
  const exp = app.cur;
  const el = $('goalPanel');
  if (!exp) { el.classList.add('open'); return; }
  const sig = exp.steps.length + '|' + (app.stepIdx.get(exp.id) || 0);
  if (el._stepSig === sig) return;             // skip rebuild churn — restarts card CSS otherwise
  el._stepSig = sig;
  el.classList.add('open');
  const list = el.querySelector('.goalList');
  list.innerHTML = '';
  exp.steps.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'gstep';
    const done = (app.stepIdx.get(exp.id) || 0) > i;
    div.innerHTML = `<span class="gdot ${done ? 'done' : ''}"></span><span class="gtxt ${done ? 'done' : ''}">${s.title}</span>`;
    list.appendChild(div);
  });
}

function sparkMsg(msg){
  const el = $('spark');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(app._sparkT);
  app._sparkT = setTimeout(() => el.classList.remove('show'), 3400);
}

/* ---------- experiment data export ---------- */

function r3(v){
  v = Number(v);
  return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0;
}

function exportExperimentData(){
  const ch = app.ch, exp = app.cur;
  if (!ch) return null;
  const idx = new Map(ch.atoms.map((a, i) => [a, i]));
  const atoms = ch.atoms.map(a => ({
    z: a.z, sym: a.el && a.el.s,
    q: Math.round((a.q || 0) * 1e3) / 1e3,
    x: r3(a.x), y: r3(a.y), zz: r3(a.zz),
    vx: r3(a.vx), vy: r3(a.vy), vz: r3(a.vz),
    m: a.m, r: a.r, fixed: !!(a.fixed), label: a.label || '',
    temp: Math.round(a.temp || 0), state: (a.el && a.el.cat) || null,
  }));
  const bonds = ch.bonds.map(b => ({
    a: idx.get(b.a), b: idx.get(b.b), type: b.type || 'covalent',
  })).filter(b => b.a != null && b.b != null);
  const base = {
    format: LABS.format,
    envelope: 2,
    lab: { name: LABS.name, key: LABS.key, agent: LABS.agent, exported: new Date().toISOString() },
    exported: new Date().toISOString(),
    app: { version: '1.0', engine: 'exp-core.mjs' },
    experiment: exp ? { id: exp.id, name: exp.name, tag: exp.tag, goal: exp.goal } : null,
    run: {
      t: ch.t, dt: ch.dt, substeps: ch.substeps,
      T_cur: ch.T_cur, T_target: ch.T_target, heatPower: ch.heatPower,
      shape: ch.shape, size: ch.size, sandMode: ch.sandMode,
      B: ch.B, E: ch.E, power: ch.power, Baxis: ch.Baxis, Edir: ch.Edir,
      freq: ch.freq, mode: ch.mode, drive: ch.drive, sandOrder: ch.sandOrder,
      scopeMode: ch.scopeMode,
      beams: (ch.beams || []).map(b => ({ type: b.type, axis: b.axis, dir: b.dir, power: b.power, spot: b.spot, rate: b.rate, grip: b.grip, on: !!b.on, wav: b.wav || 532, delay: b.delay || 0 })),
      laserOn: ch.laserOn, laserPower: ch.laser, laserAxis: ch.laserAxis,
      laserType: ch.laserType || 'ray', laserSpot: ch.laserSpot, laserRate: ch.laserRate, laserGrip: ch.laserGrip,
      feederOn: ch.feederOn, feedTotal: ch.feedTotal,
      decayCount: ch.decayCount, reactionCount: ch.reactionCount,
      cross: ch.cross && ch.cross.preset ? ch.cross : { preset: null },
    },
    feed: ch.feed.map(s => ({ z: s.z, n: s.n, every: s.every, start: s.start, inlet: s.inlet, enabled: !!s.enabled })),
    atoms,
    bonds,
    events: ch.events.slice(-24).map(e => ({ t: e.t, msg: e.msg, kind: e.kind })),
  };
  base.sig = checksum(JSON.stringify({ atoms: base.atoms, bonds: base.bonds, run: base.run }));
  return base;
}

function downloadText(name, text){
  try {
    if (typeof URL === 'undefined' || !URL.createObjectURL) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    if (!a || typeof a.click !== 'function'){ if (URL.revokeObjectURL) URL.revokeObjectURL(url); return; }
    a.href = url;
    a.download = name;
    if (document.body && document.body.appendChild) document.body.appendChild(a);
    a.click();
    setTimeout(() => { if (URL.revokeObjectURL) URL.revokeObjectURL(url); if (a.remove) a.remove(); }, 400);
  } catch (err){ /* headless or browser-restricted — exportExperimentData() still callable */ }
}

function downloadBytes(name, bytes, mime = 'application/octet-stream'){
  try {
    if (typeof URL === 'undefined' || !URL.createObjectURL) return;
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    if (!a || typeof a.click !== 'function'){ if (URL.revokeObjectURL) URL.revokeObjectURL(url); return; }
    a.href = url;
    a.download = name;
    if (document.body && document.body.appendChild) document.body.appendChild(a);
    a.click();
    setTimeout(() => { if (URL.revokeObjectURL) URL.revokeObjectURL(url); if (a.remove) a.remove(); }, 400);
  } catch (err){ /* headless or browser-restricted */ }
}

// Persistent re-download chips for the last clip export. Real anchors with blob
// URLs mean each file is a genuine user click — never throttled the way several
// programmatic downloads from one gesture are in Chromium/Brave.
function showScanChips(list){
  try {
    if (typeof (document || {}).getElementById !== 'function' || typeof Blob === 'undefined' ||
        typeof URL === 'undefined' || !URL.createObjectURL) return;
    const footer = document.getElementById('scanFooter');
    if (!footer) return;
    const row = document.getElementById('scanClipDl') || (() => {
      const d = document.createElement('div');
      d.id = 'scanClipDl';
      let acts = footer.querySelector && footer.querySelector('.sf-acts');
      if (!acts) acts = footer;
      acts.appendChild(d);
      return d;
    })();
    row.innerHTML = '';
    list.forEach(c => {
      try {
        const data = c.bytes !== undefined ? c.bytes : c.text;
        if (data === undefined || data === null) return;
        const a = document.createElement('a');
        a.textContent = '⬇ ' + c.label;
        a.title = c.name;
        a.href = URL.createObjectURL(new Blob([data], { type: c.mime }));
        a.download = c.name;
        a.style.cssText = 'color:var(--amber);font:10px monospace;background:#0a0f1f;border:1px solid #223052;'
          + 'border-radius:2px;padding:3px 7px;margin-right:6px;text-decoration:none;cursor:pointer;';
        row.appendChild(a);
      } catch (err){ /* one bad chip shouldn't kill the row */ }
    });
  } catch (err){ /* headless or browser-restricted */ }
}

function exportRun(){
  const data = exportExperimentData();
  if (!data){ sparkMsg('nothing to export yet'); return; }
  const name = LABS.fn + '-' + ((app.cur && app.cur.id) || 'lab') + '-' + Math.round(app.ch.t) + 'fs.json';
  const text = JSON.stringify(data, null, 2);
  downloadText(name, text);
  const mf = buildManifest([{ name, text }], 'experiments');
  saveToWorkspace('experiments', [{ name, text }, { name: 'manifest.json', text: JSON.stringify(mf, null, 2) }]);
  sparkMsg('⬇ exported ' + data.atoms.length + ' atoms · ' + data.bonds.length + ' bonds · sig ' + data.sig);
}

function wireExport(){
  const btn = $('exportBtn');
  if (btn) btn.addEventListener('click', exportRun);
}

app.exportData = exportExperimentData;

/* ========== instrument suite: chart recorder · mass spec · pressure · recipe sequencer
   spectral beams λ · pump-probe detector · sample stage · lab book (snapshot + seed) ========== */
const INST = (app._inst = {
  chart: { cap: 640, on: { temp: true, heat: false, B: false, E: false, power: false, nat: false }, t: [], ch: { temp: [], heat: [], B: [], E: [], power: [], nat: [] } },
  spec: { bins: [], n: 0, kind: 'mz' },
  press: { Pa: 0, mfp: 0, vap: 0, at: 0, byEl: new Map(), temp: 300 },
  method: { prog: [], active: false, step: 0, next: 0, cur: null, ramp: null },
  stage: { seed: null, n: 0, armed: false },
  seed: null, notes: 0,
  ct: 0, st: 0,
});
const CHART_SRC = [
  { k: 'temp', label: '°K', color: '#ff5b5b', fmt: (v) => Math.round(v) },
  { k: 'heat', label: 'heat', color: '#ffb020', fmt: (v) => v },
  { k: 'B', label: 'B', color: '#37c8ff', fmt: (v) => v },
  { k: 'E', label: 'E', color: '#c38bff', fmt: (v) => v },
  { k: 'power', label: 'RF', color: '#59ff9c', fmt: (v) => v },
  { k: 'nat', label: 'atoms', color: '#ff77d9', fmt: (v) => Math.round(v) },
];
const SPEC_COLORS = ['#59ff9c', '#37c8ff', '#ffb020', '#ff77d9', '#ff5b5b', '#c38bff', '#83ff5b', '#ff8f4d'];

function sampleChart(){
  const ch = app.ch;
  const C = app._inst.chart;
  if (!ch) return;
  C.t.push(ch.t);
  C.ch.temp.push(ch.T_cur || 0);
  C.ch.heat.push(ch.heatPower || 0);
  C.ch.B.push(ch.B || 0);
  C.ch.E.push(ch.E || 0);
  C.ch.power.push(ch.power || 0);
  C.ch.nat.push(ch.atoms.length);
  if (C.t.length > C.cap){
    C.t.shift();
    for (const k in C.ch) C.ch[k].shift();
  }
}

function drawChart(){
  const cvs = $('chartCanvas');
  if (!cvs) return;
  const w = cvs.width, h2 = cvs.height;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, w, h2);
  const C = app._inst.chart;
  ctx.strokeStyle = 'rgba(90,120,200,0.22)';
  ctx.strokeRect(0, 0, w, h2);
  if (!C.t.length) { drawFeedLabel(ctx, w, h2, 'no log — run the experiment'); return; }
  const n = C.t.length;
  for (const s of CHART_SRC){
    if (!C.on[s.k]) continue;
    const buf = C.ch[s.k];
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < n; i++){ const v = buf[i]; if (v > hi) hi = v; if (v < lo) lo = v; }
    if (hi === lo) hi = lo + 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < n; i++){
      const x = (i / (n - 1)) * (w - 10) + 5;
      const y = h2 - 8 - clamp((buf[i] - lo) / (hi - lo), 0, 1) * (h2 - 20);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = s.color;
    ctx.font = '10px ui-monospace,monospace';
    ctx.fillText(s.label + ' ' + s.fmt(buf[n - 1]), 8, 12 + CHART_SRC.indexOf(s) * 13);
  }
  const lastT = C.t[n - 1];
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '10px ui-monospace,monospace';
  ctx.fillText('↦ ' + fmtFancyTime(lastT), w - 110, h2 - 6);
}
function drawFeedLabel(ctx, w, h, txt){
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '11px ui-monospace,monospace';
  ctx.fillText(txt, 8, 16);
}

function chartCsv(){
  const C = app._inst.chart;
  if (!C.t.length){ sparkMsg('nothing logged yet'); return; }
  const srcs = CHART_SRC.filter(s => C.on[s.k]);
  const head = 't_fs,' + srcs.map(s => s.k).join(',');
  const rows = [head];
  for (let i = 0; i < C.t.length; i++) rows.push(C.t[i].toFixed(3) + ',' + srcs.map(s => C.ch[s.k][i]).join(','));
  const text = rows.join('\n');
  const name = 'aps-chart-' + ((app.cur && app.cur.id) || 'lab') + '-' + Math.round(C.t[C.t.length - 1]) + 'fs.csv';
  downloadText(name, text);
  const mf = buildManifest([{ name, text }], 'experiments');
  saveToWorkspace('experiments', [{ name, text }, { name: 'manifest.json', text: JSON.stringify(mf, null, 2) }]);
  sparkMsg('⬇ chart log → ' + name + ' (' + C.t.length + ' samples)');
}

function updateSpec(){
  const ch = app.ch;
  const S = app._inst.spec;
  if (!ch) return;
  const counts = new Map();
  const seen = new Set();
  for (const c of clusterCandidates(ch)){
    let m = 0, q = 0;
    for (const a of c.ats){ const e = a.el || elByZ.get(a.z); m += e ? (e.m || a.z) : a.z; q += a.q || 0; }
    const mz = m / Math.max(1, Math.abs(q));
    counts.set(mz, (counts.get(mz) || 0) + 1);
    for (const a of c.ats) seen.add(a.id);
  }
  for (const a of ch.atoms){
    if (seen.has(a.id)) continue;
    const e = a.el || elByZ.get(a.z);
    const m = e ? (e.m || a.z) : a.z;
    const mz = m / Math.max(1, Math.abs(a.q || 0));
    counts.set(mz, (counts.get(mz) || 0) + 1);
  }
  S.bins = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  S.n = ch.atoms.length;
}

function drawSpec(){
  const cvs = $('specCanvas');
  if (!cvs) return;
  const w = cvs.width, h2 = cvs.height;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, w, h2);
  const S = app._inst.spec;
  if (!S.bins.length){
    drawFeedLabel(ctx, w, h2, 'tracking the beam — peaks when clusters form');
    return;
  }
  let mx = 1;
  for (const [, c] of S.bins) if (c > mx) mx = c;
  const plotW = w - 14, plotH = h2 - 26;
  const maxMz = Math.min(400, S.bins[S.bins.length - 1][0] + 1);
  for (let i = 0; i < S.bins.length; i++){
    const [mz, c] = S.bins[i];
    if (mz > maxMz) continue;
    const x = 8 + (mz / maxMz) * plotW;
    const bh = (c / mx) * plotH;
    ctx.fillStyle = SPEC_COLORS[i % SPEC_COLORS.length];
    ctx.fillRect(x, h2 - 10 - bh, Math.max(2, plotW / 80), bh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '10px ui-monospace,monospace';
  ctx.fillText('m/z 0 → ' + maxMz.toFixed(0), 8, h2 - 6);
  ctx.fillText('species ' + S.bins.length + ' · atoms ' + S.n, w - 130, h2 - 6);
}

function samplePress(){
  const ch = app.ch;
  if (!ch) return;
  const N = ch.atoms.length;
  const Vnm3 = Math.pow(2 * (ch.size || 2.4), 3);
  const Vm3 = Vnm3 * 1e-27;
  const T = Math.max(1, ch.T_cur || 300);
  const Pa = Vm3 > 0 ? N * 1.38e-23 * T / Vm3 : 0;
  const nVm = N / Math.max(Vnm3, 1e-12);
  const mfp = nVm > 0 ? 1 / (Math.SQRT2 * Math.PI * 0.3 * 0.3 * nVm) : 0;
  const byEl = new Map();
  let vap = 0;
  for (const a of ch.atoms){
    const e = a.el || elByZ.get(a.z);
    if (!e) continue;
    const Tloc = a.temp || T;
    let g = byEl.get(e.s);
    if (!g){ g = { n: 0, vap: 0 }; byEl.set(e.s, g); }
    g.n++;
    if (Tloc > (e.melt || 1e9)){ g.vap++; vap++; }
  }
  app._inst.press = { Pa, mfp, vap, at: N, byEl, temp: T };
}

function fmtPress(Pa){
  if (Pa >= 1e9) return (Pa / 1e9).toFixed(2) + ' GPa';
  if (Pa >= 1e6) return (Pa / 1e6).toFixed(2) + ' MPa';
  if (Pa >= 1e3) return (Pa / 1e3).toFixed(1) + ' kPa';
  return Pa.toFixed(0) + ' Pa';
}

function drawPress(){
  const el = $('pressRead');
  if (!el) return;
  const P = app._inst.press;
  const pp = P.at ? (P.vap / P.at * 100) : 0;
  const byTxt = [...P.byEl.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 4)
    .map(([s, g]) => (g.vap ? '<b style="color:#fb8">⬆</b>' : '<b style="color:#8cf">⬇</b>') + s + ' ' + g.n)
    .join(' · ');
  el.innerHTML =
    '<div class="pgrid"><span>P</span><b>' + fmtPress(P.Pa) + '</b>' +
    '<span>λ<sub>mfp</sub></span><b>' + (P.mfp && Number.isFinite(P.mfp) ? P.mfp.toFixed(2) + ' nm' : '∞') + '</b></div>' +
    '<div class="pgrid"><span>vapor</span><b>' + pp.toFixed(1) + '%</b>' +
    '<span>T</span><b>' + Math.round(P.temp) + ' K</b></div>' +
    '<div class="pgrid small">' + (byTxt || '<span>no atoms</span>') + '</div>';
}

/* ---- recipe sequencer ---- */
const METHOD_STEPS = [
  { type: 'ramp', T: 1200, over: 2e5, power: 0.6, label: 'ramp' },
  { type: 'hold', T: 1200, dur: 3e5, label: 'hold' },
  { type: 'feed', z: 6, n: 6, label: 'feed' },
  { type: 'pulse', power: 0.8, dur: 2e5, label: 'pulse' },
];
const methodLabel = (s) => s.type + (s.type === 'ramp' ? '→' + s.T + 'K' : s.type === 'hold' ? ' ' + s.T + 'K' : s.type === 'feed' ? ' №' + s.z + '×' + s.n : ' ⚡' + Math.round(s.power * 100) + '%');

function renderMethods(){
  const wrap = $('methodList');
  if (!wrap) return;
  const I = app._inst.method;
  wrap.innerHTML = I.prog.length
    ? I.prog.map((s, i) => {
        const p = s.type === 'ramp' ? s.T : s.type === 'hold' ? s.T : s.type === 'feed' ? s.z : Math.round(s.power * 100);
        const d = s.type === 'hold' || s.type === 'pulse' ? s.dur : s.over;
        const units = s.type === 'hold' || s.type === 'pulse' ? 'fs' : s.type === 'ramp' ? 'K' : 'z';
        return '<div class="mrow" data-i="' + i + '" title="' + methodLabel(s) + '">' +
          '<span class="mt">' + (i + 1) + '.' + s.type + '</span>' +
          '<input class="mp" type="number" value="' + p + '" data-f="p" title="' + units + '">' +
          '<input class="md" type="number" value="' + (d || 0) + '" data-f="d" title="fs">' +
          '<span class="mf del" title="remove">×</span></div>';
      }).join('')
    : '<div class="mrow dim">empty recipe — add steps</div>';
}
function syncMethodUi(){
  const I = app._inst.method;
  const run = $('methodRunBtn');
  if (run){
    run.textContent = I.active ? '■ pause' : '▶ run';
    run.style.background = I.active ? 'var(--good)' : 'var(--line)';
    run.style.color = I.active ? '#063' : 'var(--txt)';
  }
  const rd = $('methodRead');
  if (rd){
    if (!I.prog.length) rd.textContent = '';
    else if (I.active) rd.textContent = 'step ' + I.step + '/' + I.prog.length + (I.cur ? ' · ' + methodLabel(I.cur) : '');
    else if (I.step >= I.prog.length) rd.textContent = '● done';
    else rd.textContent = 'armed · ' + I.prog.length + ' steps';
  }
}
function execMethodStep(s){
  const ch = app.ch;
  if (!ch) return;
  if (s.type === 'ramp' || s.type === 'hold'){
    ch.setHeat(s.power ?? ch.heatPower, s.T);
  } else if (s.type === 'feed'){
    const n = Math.min(s.n || 1, Math.max(0, ch.MAX_FEED - ch.atoms.length));
    for (let i = 0; i < n; i++) ch.spawn(s.z, { temp: ch.T_cur });
    ch.event && ch.event('recipe injected №' + s.z + ' ×' + n, 'feed');
  } else if (s.type === 'pulse'){
    const b = selBeam(ch);
    if (b){ b.on = true; b.power = Math.max(b.power, s.power || 0.8); if (b.type === 'ray') b.type = 'pulse'; }
  }
}
function stepMethod(){
  const I = app._inst.method;
  if (!I.active) return;
  const ch = app.ch;
  if (!ch) return;
  if (I.ramp){
    const f = clamp((ch.t - I.ramp.t0) / Math.max(1, I.ramp.end - I.ramp.t0), 0, 1);
    ch.T_target = I.ramp.from + (I.ramp.to - I.ramp.from) * f;
    if (ch.t >= I.ramp.end){ ch.T_target = I.ramp.to; I.ramp = null; }
  }
  while (I.step < I.prog.length && ch.t >= I.next){
    const s = I.prog[I.step];
    execMethodStep(s);
    I.step++;
    I.cur = s;
    if (s.type === 'ramp'){
      I.ramp = { from: ch.T_target, to: s.T, t0: ch.t, end: ch.t + Math.max(s.over || 0, 1) };
      I.next = ch.t + Math.max(s.over || 0, 1);
    } else {
      I.next = ch.t + Math.max(s.dur || 0, 1);
    }
    if (I.step >= I.prog.length){
      I.active = false;
      I.cur = null;
      sparkMsg('recipe done in ' + fmtFancyTime(ch.t));
    }
  }
  syncMethodUi();
}

/* ---- sample stage / seed holder ---- */
const seedCache = new Map();
function loadSeedCrystal(sym, count){
  const ch = app.ch;
  const e = elBySym(sym);
  if (!ch || !e){ sparkMsg('unknown element: ' + sym); return false; }
  let made = 0;
  const R0 = 0.28;
  const N3 = Math.max(2, Math.min(5, Math.ceil(Math.cbrt(count) || 2)));
  for (let i = 0; i < N3 && made < count; i++)
    for (let j = 0; j < N3 && made < count; j++)
      for (let k = 0; k < N3 && made < count; k++)
        if (ch.atoms.length < ch.MAX_FEED){
          ch.spawn(e.z, { x: (i - (N3 - 1) / 2) * R0, y: (j - (N3 - 1) / 2) * R0, zz: (k - (N3 - 1) / 2) * R0, vx: 0, vy: 0, vz: 0, temp: ch.T_cur });
          made++;
        }
  if (made){ app._inst.stage.seed = e.s; app._inst.stage.n = made; }
  sparkMsg(made ? '⛰ seed crystal loaded on stage: ' + e.s + ' ×' + made : 'stage full');
  return made > 0;
}

/* ---- lab book: seed rng + notebook + snapshot import ---- */
function seedHash(s){
  if (Number.isFinite(Number(s))) return Number(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function applySeed(str){
  const ch = app.ch;
  const stamp = seedHash(String(str || ''));
  if (ch) ch.rng = mulberry(stamp);
  app._inst.seed = String(str || '');
  ch && ch.event && ch.event('RNG seed set to ' + String(str || stamp), 'note');
  sparkMsg('seed ↦ ' + String(str || stamp));
}
function addNote(txt){
  const ch = app.ch;
  if (!ch) return;
  ch.events.push({ t: ch.t, msg: txt, kind: 'note' });
  app._inst.notes++;
  sparkMsg('✎ noted at ' + fmtFancyTime(ch.t));
}
function importSnapshotData(data){
  if (!data || typeof data !== 'object' || data.format !== LABS.format){
    sparkMsg('not an Aarkanum snapshot'); return;
  }
  const r = data.run || {};
  const ch = new Chamber(DATA, {
    size: r.size || 2.4, T: Number.isFinite(r.T_target) ? r.T_target : 300,
    shape: r.shape || 'cube', rng: mulberry(data.seed && data.seed.length ? seedHash(data.seed) : Math.floor(Math.random() * 1e9)),
  });
  ch.t = r.t || 0;
  ch.dt = r.dt || ch.dt;
  ch.atoms = [];
  ch.bonds = [];
  const restored = [];   // parallel to data.atoms; export bonds reference array indices
  for (const at of data.atoms || []){
    const el = elByZ.get(at.z);
    if (!el) continue;
    const a = ch.spawn(at.z, { x: at.x, y: at.y, zz: at.zz ?? 0, vx: at.vx ?? 0, vy: at.vy ?? 0, vz: at.vz ?? 0, q: at.q || 0, temp: at.temp || r.T_cur || 300 });
    restored.push({ guard: a });
  }
  for (let i = 0; i < (data.bonds || []).length; i++){
    const bt = data.bonds[i];
    const ra = restored[bt.a] && restored[bt.a].guard;
    const rb = restored[bt.b] && restored[bt.b].guard;
    if (ra && rb) ch.addBond(ra, rb, { type: bt.type || 'covalent' });
  }
  Object.assign(ch, {
    B: r.B || 0, E: r.E || 0, power: r.power || 0, Baxis: r.Baxis || 'y', Edir: r.Edir || 'x',
    T_target: Number.isFinite(r.T_target) ? r.T_target : 300,
    heatPower: r.heatPower || 0, freq: r.freq || 0, drive: r.drive || 0,
    decayCount: r.decayCount || 0, reactionCount: r.reactionCount || 0, feedTotal: 0,
  });
  ch.cross = r.cross && r.cross.preset ? { preset: r.cross.preset } : { preset: null };
  ch.feed = (data.feed || []).map(s => ({ z: s.z, n: s.n, every: s.every, start: s.start || 0, inlet: s.inlet || 'top', enabled: !!(s.enabled ?? true), next: s.start || 0 }));
  ch.feederOn = !!r.feederOn;
  ch.beams = (r.beams && r.beams.length ? r.beams : [{ type: 'ray', axis: 'y', dir: 1, power: 0 }]).map(b => {
    const nb = ch._newBeam(b.type || 'ray', b.axis || 'y', b.dir ?? 1, b.power ?? 0);
    Object.assign(nb, { spot: b.spot || 0.16, rate: b.rate || 10, grip: b.grip || 0.5, on: !!b.on, wav: b.wav || 532, delay: b.delay || 0 });
    if (b.d) nb.d = b.d.slice();
    return nb;
  });
  ch.laserOn = !!r.laserOn;
  app.cur = data.experiment && data.experiment.id ? findExperiment(data.experiment.id) || app.cur : app.cur;
  app.ch = ch;
  app._deployKit = null;
  removePlateSlab();
  buildChamber();
  rebuildNodes();
  refreshShapeUi();
  syncChladniUi();
  syncMachUi();
  syncLaser();
  updateHud();
  ch.event('snapshot restored — ' + ch.atoms.length + ' atoms · ' + ch.bonds.length + ' bonds at t ' + fmtFancyTime(ch.t), 'note');
  sparkMsg('⏏ snapshot restored — ' + ch.atoms.length + ' atoms · ' + ch.bonds.length + ' bonds · t ' + fmtFancyTime(ch.t));
  return ch;
}

/* ---- instruments wiring + per-frame sampler ---- */
function instTick(dt){
  const ch = app.ch;
  if (!ch) return;
  const I = app._inst;
  const detEl = $('laserDetRead');
  if (detEl){
    const b = selBeam(ch);
    const det = b ? ((b._hits || 0)) : 0;
    const de = b ? (b._E || 0) : 0;
    detEl.textContent = b && det ? (det + ' hits · ' + (de >= 1000 ? (de / 1000).toFixed(1) + 'k' : Math.round(de)) + ' eV') : 'no hits';
  }
  I.ct += dt;
  if (I.ct > 140){ I.ct = 0; sampleChart(); drawChart(); samplePress(); drawPress(); }
  I.st += dt;
  if (I.st > 170){ I.st = 0; updateSpec(); drawSpec(); }
  stepMethod();
}

function wireInstruments(){
  const cs = $('chartSrcChips');
  if (cs){
    cs.innerHTML = '';
    for (const s of CHART_SRC){
      const b = document.createElement('button');
      b.className = 'chip csrc' + (app._inst.chart.on[s.k] ? ' on' : '');
      b.dataset.k = s.k;
      b.textContent = s.label;
      b.addEventListener('click', () => {
        app._inst.chart.on[s.k] = !app._inst.chart.on[s.k];
        if (s.k === 'temp' && !app._inst.chart.on.temp) app._inst.chart.on[s.k] = true;
        for (const c of cs.children){
          if (c.classList) c.classList.toggle('on', !!app._inst.chart.on[c.dataset.k]);
        }
        drawChart();
      });
      cs.appendChild(b);
    }
  }
  const csv = $('chartCsvBtn');
  if (csv) csv.addEventListener('click', chartCsv);
  const specModes = $('specModes');
  if (specModes){
    specModes.innerHTML = '';
    for (const [k, label] of [['mz', 'm/z'], ['charge', 'charge']]){
      const b = document.createElement('button');
      b.className = 'chip smode' + (k === 'mz' ? ' on' : '');
      b.dataset.k = k;
      b.textContent = label;
      b.addEventListener('click', () => {
        app._inst.spec.kind = k;
        for (const c of specModes.children) if (c.classList) c.classList.toggle('on', c.dataset.k === k);
        updateSpec(); drawSpec();
      });
      specModes.appendChild(b);
    }
  }
  const ml = $('methodList');
  if (ml) ml.addEventListener('click', (e) => {
    if (!e || !e.target || !e.target.closest) return;
    const r = e.target.closest('.mrow');
    if (!r || !r.dataset || r.dataset.i === undefined) return;
    if (e.target.classList && e.target.classList.contains('del')){
      app._inst.method.prog.splice(parseInt(r.dataset.i, 10), 1);
      app._inst.method.step = 0; app._inst.method.next = 0;
      renderMethods(); syncMethodUi();
    }
  });
  if (ml) ml.addEventListener('input', (e) => {
    if (!e || !e.target || !e.target.dataset || e.target.dataset.i === undefined) return;
    const s = app._inst.method.prog[parseInt(e.target.dataset.i, 10)];
    if (!s) return;
    const v = parseFloat(e.target.value) || 0;
    if (e.target.dataset.f === 'p'){ if (s.type === 'ramp' || s.type === 'hold') s.T = v; else if (s.type === 'feed') s.z = Math.round(v); else s.power = v / 100; }
    else { if (s.type === 'hold' || s.type === 'pulse') s.dur = v; else s.over = v; }
  });
  const addBtns = $('methodAdds');
  if (addBtns) addBtns.addEventListener('click', (e) => {
    if (!e || !e.target || !e.target.dataset || !e.target.dataset.m) return;
    const t = METHOD_STEPS.find(x => x.type === e.target.dataset.m);
    if (!t) return;
    const copy = Object.assign({}, t);
    if (copy.type === 'feed') copy.z || (copy.z = 6);
    app._inst.method.prog.push(copy);
    renderMethods(); syncMethodUi();
  });
  const runBtn = $('methodRunBtn');
  if (runBtn) runBtn.addEventListener('click', () => {
    const I = app._inst.method;
    if (!app.ch){ sparkMsg('deploy an experiment first'); return; }
    if (!I.prog.length){ sparkMsg('recipe is empty'); return; }
    if (I.active){ I.active = false; }
    else {
      I.active = true;
      I.step = Math.min(I.step, I.prog.length);
      if (I.step >= I.prog.length) I.step = 0;
      I.next = app.ch.t;
      I.cur = null;
      I.ramp = null;
    }
    syncMethodUi();
  });
  const rstBtn = $('methodResetBtn');
  if (rstBtn) rstBtn.addEventListener('click', () => {
    const I = app._inst.method;
    I.active = false; I.step = 0; I.next = 0; I.cur = null; I.ramp = null;
    I.prog.length = 0;
    renderMethods(); syncMethodUi();
  });
  const stageEl = $('stageEl');
  const stageBtn = $('stageArmBtn');
  const loadStage = () => {
    if (!app.ch){ sparkMsg('deploy an experiment to load the stage'); return; }
    if (stageEl) app._inst.stage.armed = loadSeedCrystal(stageEl.value, 8);
    const rd = $('stageRead');
    if (rd) rd.textContent = app._inst.stage.seed ? '⛰ ' + app._inst.stage.seed + ' ×' + app._inst.stage.n : 'stage empty';
  };
  if (stageBtn) stageBtn.addEventListener('click', loadStage);
  const seedBtn = $('seedBtn');
  if (seedBtn) seedBtn.addEventListener('click', () => { const s = $('seedIn'); applySeed(s ? s.value : ''); });
  const noteBtn = $('noteAddBtn');
  if (noteBtn) noteBtn.addEventListener('click', () => { const s = $('noteIn'); if (s && s.value) addNote(s.value); });
  const impBtn = $('snapImportBtn');
  if (impBtn) impBtn.addEventListener('click', () => {
    const f = $('snapFile');
    if (f && typeof f.click === 'function') f.click();
  });
  const snapFile = $('snapFile');
  if (snapFile) snapFile.addEventListener('change', () => {
    const f0 = snapFile.files && snapFile.files[0];
    if (!f0 || !f0.text) { sparkMsg('pick a snapshot file'); return; }
    f0.text().then((t) => {
      try { importSnapshotData(JSON.parse(t)); } catch (err){ sparkMsg('snapshot parse error: ' + (err && err.message)); }
    });
  });
  // spectral λ + pump-probe delay + detector readout
  const wv = $('laserWavIn');
  if (wv) wv.addEventListener('input', () => {
    const b = selBeam(app.ch);
    if (b){ b.wav = clamp(parseFloat(wv.value) || 532, 150, 2500); }
    syncLaser();
  });
  const dly = $('laserDelIn');
  if (dly) dly.addEventListener('input', () => {
    const b = selBeam(app.ch);
    if (b){ b.delay = clamp((parseFloat(dly.value) || 0) / 100, 0, 1); }
    syncLaser();
  });
  const detReset = $('detResetBtn');
  if (detReset) detReset.addEventListener('click', () => {
    const b = selBeam(app.ch);
    if (b){ b._hits = 0; b._E = 0; syncLaser(); sparkMsg('detector board cleared'); }
  });
}

function wireMethodsApp(){
  // boot-time state sync hooks called from deploy/reset
  INST.stage.seed = null; INST.stage.n = 0; INST.stage.armed = false;
  INST.method.active = false; INST.method.step = 0; INST.method.next = 0; INST.method.cur = null; INST.method.ramp = null;
  const rd = $('stageRead');
  if (rd) rd.textContent = 'stage empty';
  syncMethodUi();
  const sr = $('seedRead');
  if (sr) sr.textContent = INST.seed ? 'seed ' + INST.seed : 'rng unseeded';
}

/* ========== environment presets + launch overlay ========== */
const envKey = 'aar.env.v1';
const agentKey = 'aar.agent.v1';
let starPoints = null;

function loadAgent(){
  try {
    const q = (typeof location !== 'undefined') ? new URLSearchParams(location.search).get('agent') : null;
    if (q) return String(q).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const s = (typeof localStorage !== 'undefined') ? localStorage.getItem(agentKey) : null;
    return (s || 'you').slice(0, 40);
  } catch (err){ return 'you'; }
}
function storeAgent(slug){
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(agentKey, String(slug || 'you')); } catch (err) {}
}
function loadEnv(){
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(envKey) : null;
    if (raw) return Object.assign(envDefault(), JSON.parse(raw));
  } catch (err){ /* storage unavailable */ }
  return null;
}
function storeEnv(env){
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(envKey, JSON.stringify(env)); } catch (err) {}
}

function ensureStars(){
  if (starPoints) return;
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++){
    const r = 36 + Math.random() * 44;
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(v) * Math.cos(u);
    pos[i * 3 + 1] = r * Math.sin(v) * Math.sin(u);
    pos[i * 3 + 2] = r * Math.cos(v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xbfdaff, size: 0.28, transparent: true, opacity: 0.9, sizeAttenuation: true });
  starPoints = new THREE.Points(geo, mat);
  scene.add(starPoints);
}

function applySky(env){
  if (!env) return;
  if (env.stars) ensureStars();
  if (starPoints) starPoints.visible = !!(env.stars);
  renderer.setClearColor(env.bg ?? 0x05070f, 1);
}

function clearAmbientGas(){
  const ch = app.ch;
  if (!ch) return;
  for (let i = ch.atoms.length - 1; i >= 0; i--){
    const a = ch.atoms[i];
    if (a.gas){
      for (const b of a.bonds.slice()) ch.removeBond(b);
      ch.atoms.splice(i, 1);
    }
  }
  rebuildNodes();
}

function spawnAmbientGas(env, cap = 8){
  const ch = app.ch;
  if (!IS_REAL || !ch || !env || !env.gasMix || !env.gasMix.length) return;
  if (ch.atoms.some(a => a.gas)) return;
  if (ch.atoms.length + cap > ch.MAX_FEED) return;
  const pts = env.gasMix;
  const total = pts.reduce((s, p) => s + (p[1] || 0), 0) || 1;
  let budget = cap;
  for (const [z, ppm] of pts){
    if (budget <= 0) break;
    const n = Math.min(budget, Math.max(1, Math.round(cap * (ppm || 0) / total)));
    for (let i = 0; i < n; i++){
      const a = ch.spawn(z, { temp: env.T || 300 });
      if (a){ a.gas = true; a.label = 'ambient'; a.r = Math.min(0.1, a.r); a.base = '#3b4a6b'; a.color = a.base; }
    }
    budget -= n;
  }
  rebuildNodes();
}

function applyEnv(env){
  if (!env) return;
  app.env = env;
  if (app.ch){
    app.ch.env = { g: env.g || 0, atm: env.atm || 0 };
    if (app.ch.T_target == null && env.T != null) app.ch.T_target = env.T;
    if (app.ch.T_cur == null) app.ch.T_cur = env.T ?? 300;
  }
  applySky(env);
  spawnAmbientGas(env);
  if (document.body) document.body.dataset.env = env.id || 'custom';
  updateLaunchEnv();
}

function envLabel(env){
  if (!env) return 'unset';
  if (env.id !== 'custom'){
    const p = (ENVIRONMENTS.find(e => e.id === env.id) || {});
    if (p.label) return p.label;
  }
  return 'custom · ' + (env.g ?? 0.5).toFixed(2) + ' g · ' + (env.T ?? 300) + ' K';
}

function updateLaunchEnv(){
  const el = document.getElementById('launchEnv');
  if (el) el.textContent = 'environment: ' + envLabel(app.env);
  const btn = document.getElementById('btnEnv');
  if (btn && btn.title) btn.title = 'environment: ' + envLabel(app.env) + ' · open wizard';
}

/* ---- wizard ---- */
const wizState = { preset: 'custom' };
function wizEnvFromUi(){
  const ids = ['ewG', 'ewT', 'ewA', 'ewName'];
  return {
    id: 'custom',
    label: (v($('ewName')) || 'Custom').slice(0, 30),
    g: parseFloat(v($('ewG')) ?? 0.5) || 0,
    T: parseFloat(v($('ewT')) ?? 300) || 300,
    atm: parseFloat(v($('ewA')) ?? 0.5) || 0,
    gasMix: wizState.gasMix || [[7, 78], [8, 21]],
    stars: !!(document.getElementById('ewS') && document.getElementById('ewS').checked),
    bg: wizPresetBg(wizState.preset),
  };
}
function wizPresetBg(id){
  const p = (ENVIRONMENTS.find(e => e.id === id) || {});
  return p.bg ?? 0x05070f;
}
function v(el){ return el && el.value; }
function setRange(id, val){
  const el = document.getElementById(id);
  if (el) el.value = String(val);
}
function readRange(id, fmt){
  const el = document.getElementById(id);
  let out = 0;
  if (el) out = parseFloat(el.value) || 0;
  if (fmt) return fmt(out);
  return out;
}
function wizSyncFromPreset(p){
  if (!p) return;
  wizState.preset = p.id;
  wizState.gasMix = p.gasMix || [];
  setRange('ewG', p.g);
  setRange('ewT', p.T);
  setRange('ewA', p.atm);
  if ($('ewName')) $('ewName').value = p.label.replace(/[^A-Za-z ]/g, '');
  if ($('ewS')) $('ewS').checked = !!p.stars;
  wizSyncReads();
  const chips = document.getElementById('envPresets');
  if (chips) for (const c of chips.children) if (c.dataset) c.classList.toggle('on', c.dataset.id === p.id);
}
function wizSyncReads(){
  updateVal('ewGRead', readRange('ewG', x => x.toFixed(2)) + ' g');
  updateVal('ewTRead', Math.round(readRange('ewT')) + ' K');
  updateVal('ewARead', readRange('ewA', x => x.toFixed(2)) + ' atm');
  updateVal('ewGasRead', (wizState.gasMix || []).map(g => g[1] + '%').join(' · ') || 'vacuum');
}
function updateVal(id, t){
  const el = document.getElementById(id);
  if (el) el.textContent = t;
}

function renderEnvPresets(){
  const wrap = document.getElementById('envPresets');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const p of ENVIRONMENTS){
    const b = document.createElement('button');
    b.className = 'chip envchip';
    b.dataset.id = p.id;
    b.innerHTML = `<span>${p.icon}</span>${p.label}<small>${p.tag}</small>`;
    b.addEventListener('click', () => {
      wizSyncFromPreset(p);
      highlightEnvChip(p.id);
    });
    wrap.appendChild(b);
  }
}
function highlightEnvChip(id){
  const wrap = document.getElementById('envPresets');
  if (!wrap) return;
  for (const c of wrap.children) if (c.dataset) c.classList.toggle('on', c.dataset.id === id);
}

function openLaunch(){
  const L = document.getElementById('launch');
  if (L){ L.classList.add('on'); }
  updateLaunchEnv();
}
function closeLaunch(){
  const L = document.getElementById('launch');
  if (L) L.classList.remove('on');
}

function openEnvWizard(){
  renderEnvPresets();
  wizSyncFromPreset(ENVIRONMENTS.find(e => e.id === (app.env && app.env.id)) || ENVIRONMENTS[0]);
  const W = document.getElementById('envWiz');
  if (W) W.classList.add('on');
}
function closeEnvWizard(){
  const W = document.getElementById('envWiz');
  if (W) W.classList.remove('on');
}

function wireEnvLaunch(){
  renderEnvPresets();
  const lnNew = $('lnNew'), lnLoad = $('lnLoad'), lnEnv = $('lnEnv'), lnSettings = $('lnSettings'), lnClose = $('lnClose');
  if (lnNew) lnNew.addEventListener('click', () => { closeLaunch(); openEnvWizard(); });
  if (lnLoad) lnLoad.addEventListener('click', () => { closeLaunch(); if (!app.gridOn) toggleMenu(); });
  if (lnEnv) lnEnv.addEventListener('click', () => { closeLaunch(); openEnvWizard(); });
  if (lnClose) lnClose.addEventListener('click', () => { closeLaunch(); });
  const btnEnv = $('btnEnv');
  if (btnEnv) btnEnv.addEventListener('click', () => { closeLaunch(); openEnvWizard(); });
  const btnSettings = $('btnSettings');
  if (btnSettings) btnSettings.addEventListener('click', openSettings);
  for (const id of ['ewG', 'ewT', 'ewA']){
    const el = $('ew' + id.slice(2));
    if (el) el.addEventListener('input', () => { wizState.preset = 'custom'; highlightEnvChip('custom'); wizSyncReads(); });
  }
  const gas = $('ewGasCycle');
  if (gas){
    const GAS_OPTIONS = [
      { l: 'vacuum', mix: [] },
      { l: 'N₂/O₂ 78/21', mix: [[7, 78], [8, 21]] },
      { l: 'CO₂ sky 95', mix: [[6, 95], [7, 2.8], [18, 1.6]] },
      { l: 'sea O₂ 62', mix: [[8, 62], [7, 34], [6, 4]] },
      { l: 'trace He', mix: [[2, 100]] },
    ];
    let gi = 1;
    gas.addEventListener('click', () => {
      gi = (gi + 1) % GAS_OPTIONS.length;
      const o = GAS_OPTIONS[gi];
      wizState.gasMix = o.mix;
      wizState.preset = 'custom';
      highlightEnvChip('custom');
      updateVal('ewGasRead', o.l);
    });
  }
  if (lnSettings) lnSettings.addEventListener('click', openSettings);
  const ewRun = $('ewRun');
  if (ewRun) ewRun.addEventListener('click', () => {
    const env = wizEnvFromUi();
    applyEnv(env);
    storeEnv(env);
    closeEnvWizard();
    if (!app.gridOn) toggleMenu();
    sparkMsg('environment applied — ' + envLabel(env));
  });
  const ewCancel = $('ewCancel');
  if (ewCancel) ewCancel.addEventListener('click', () => { closeEnvWizard(); openLaunch(); });
  wireSettings();
  restoreSaveRoot().then(() => { syncSettingsPathRead(); syncMinimap(); });
  updateLaunchEnv();
}

/* ========== settings · permanent save paths (File System Access) ========== */
const dbKey = 'aar.saveRoot';
let saveRootDir = null;
let idbDb = null;

function idbOpen(){
  if (idbDb) return Promise.resolve(idbDb);
  return new Promise((res, rej) => {
    try {
      const req = window.indexedDB.open('aarkanum-labs', 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
      req.onsuccess = () => { idbDb = req.result; res(idbDb); };
      req.onerror = () => rej(req.error);
    } catch (e){ rej(e); }
  });
}
function idbGet(key){
  return idbOpen()
    .then(db => new Promise((res) => { try { const tx = db.transaction('kv', 'readonly'); const g = tx.objectStore('kv').get(key); g.onsuccess = () => res(g.result); g.onerror = () => res(undefined); } catch (e){ res(undefined); } }))
    .catch(() => undefined);
}
function idbSet(key, val){
  return idbOpen()
    .then(db => new Promise((res) => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e){ res(false); } }))
    .catch(() => false);
}
function idbDel(key){
  return idbOpen()
    .then(db => new Promise((res) => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = () => res(true); } catch (e){ res(true); } }))
    .catch(() => true);
}

async function restoreSaveRoot(){
  if (typeof window === 'undefined' || !window.indexedDB || !window.isSecureContext) return;
  const h = await idbGet(dbKey).catch(() => undefined);
  if (h && h.name && typeof h.queryPermission === 'function' && (await h.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted'){
    saveRootDir = h;
  }
}

async function pickSaveRoot(){
  if (typeof window === 'undefined' || !window.showDirectoryPicker){
    sparkMsg('folder picking needs a capable browser — download fallback stays on');
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({ id: 'aar-save-root', mode: 'readwrite' });
    saveRootDir = dir;
    await idbSet(dbKey, dir);
    sparkMsg('save root set: ' + (dir.name || 'folder'));
  } catch (err){ /* user cancelled — fallback stays */ }
  syncSettingsPathRead();
}

async function clearSaveRoot(){
  saveRootDir = null;
  await idbDel(dbKey).catch(() => {});
  syncSettingsPathRead();
}

function syncSettingsPathRead(){
  const el = document.getElementById('setPathRead');
  if (el){
    el.textContent = saveRootDir
      ? '✓ ' + (saveRootDir.name || 'selected folder')
      : 'downloads fallback (browser files)';
  }
}

function openSettings(){
  const el = document.getElementById('settings');
  if (el) el.classList.add('on');
  const ag = document.getElementById('setAgent');
  if (ag) ag.value = LABS.agent;
  const mm = document.getElementById('setMinimap');
  if (mm){ mm.checked = !!app._minimapOn; }
  const bw = document.getElementById('setBeamWire');
  if (bw){ bw.checked = !!app._beamWire; }
  const insp = document.getElementById('setInspect');
  if (insp){ insp.checked = !!app._tapInspect; }
  const ov = document.getElementById('setOverlay');
  if (ov){ ov.value = app._overlayMode; }
  const hu = document.getElementById('setHud');
  if (hu){ hu.value = String(app._hudScale); setHudRead(app._hudScale); }
  const setFull = document.getElementById('setFull');
  if (setFull){ setFull.checked = !!(document.fullscreenElement || document.webkitFullscreenElement); }
  buildModToggles();
  syncSettingsPathRead();
}

function setHudRead(v){
  const el = document.getElementById('setHudRead');
  if (el) el.textContent = Math.round(v * 100) + '%';
}

function applyOverlayMode(mode){
  app._overlayMode = mode || 'full';
  const b = document.body.classList;
  b.remove('calm', 'min');
  if (mode === 'calm') b.add('calm');
  else if (mode === 'min') b.add('calm', 'min');
  if (mode === 'min'){ b.add('feed-min', 'hud-min'); } else { b.remove('feed-min', 'hud-min'); }
  const hudM = UIMODS.find(q => q.id === 'hud');
  if (hudM && hudM.vis === false) b.add('hud-min');
}

function applyHudScale(s){
  app._hudScale = clamp(s, 0.6, 1.8);
  const el = document.getElementById('hud');
  if (el && el.style && typeof el.style.setProperty === 'function'){ el.style.setProperty('--hud-scale', app._hudScale); }
  const root = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
  if (root && root.style && typeof root.style.setProperty === 'function'){ root.style.setProperty('--hud-scale', app._hudScale); }
  setHudRead(app._hudScale);
}

function wireSettings(){
  const setClose = $('setClose');
  if (setClose) setClose.addEventListener('click', () => { const el = document.getElementById('settings'); if (el) el.classList.remove('on'); });
  const setAgent = $('setAgent');
  if (setAgent) setAgent.addEventListener('change', () => { LABS.agent = (setAgent.value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'you'; storeAgent(LABS.agent); });
  const setPathBtn = $('setPathBtn');
  if (setPathBtn) setPathBtn.addEventListener('click', pickSaveRoot);
  const setPathClear = $('setPathClear');
  if (setPathClear) setPathClear.addEventListener('click', clearSaveRoot);
  const setMinimap = $('setMinimap');
  if (setMinimap) setMinimap.addEventListener('change', () => { app._minimapOn = !!setMinimap.checked; syncMinimap(); });
  const setBeamWire = $('setBeamWire');
  if (setBeamWire) setBeamWire.addEventListener('change', () => { app._beamWire = !!setBeamWire.checked; });
  const insp = $('setInspect');
  if (insp) insp.addEventListener('change', () => { app._tapInspect = !!insp.checked; });
  const ov = $('setOverlay');
  if (ov) ov.addEventListener('change', () => { applyOverlayMode(ov.value); });
  const hu = $('setHud');
  if (hu) hu.addEventListener('input', () => { applyHudScale(parseFloat(hu.value) || 1); });
  const setFull = $('setFull');
  if (setFull){
    const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const syncFull = () => { setFull.checked = isFull(); };
    setFull.addEventListener('change', () => {
      const active = isFull();
      if (setFull.checked && !active){
        const d = document.documentElement;
        const p = d.requestFullscreen ? d.requestFullscreen() : (d.webkitRequestFullscreen ? d.webkitRequestFullscreen() : null);
        if (p && typeof p.catch === 'function') p.catch(() => { if (document.exitFullscreen) document.exitFullscreen(); });
      } else if (!setFull.checked && active){
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        syncFull();
      }
    });
    if (typeof document.addEventListener === 'function'){
      document.addEventListener('fullscreenchange', syncFull);
      document.addEventListener('webkitfullscreenchange', syncFull);
    }
    syncFull();
  }
}

app._minimapOn = true;
app._tapInspect = true;
app._beamWire = true;
app._overlayMode = 'full';
app._hudScale = 1;
let minimapT = 0;
function syncMinimap(){
  const el = document.getElementById('minimapWrap');
  if (el) el.classList.toggle('on', !!app._minimapOn);
  const label = document.getElementById('minimap');
  if (label && typeof label.title === 'string') label.title = app._minimapOn ? 'live chamber density · minimap' : 'minimap hidden';
}
function updateMinimap(dt){
  minimapT += dt;
  if (minimapT < 120 || !app._minimapOn) return;
  minimapT = 0;
  const c = document.getElementById('minimap');
  const ch = app.ch;
  if (!c || typeof c.getContext !== 'function' || !ch || !ch.atoms || !ch.atoms.length) return;
  const ctx = c.getContext('2d');
  const W = c.width || 120, H = c.height || 120;
  ctx.clearRect(0, 0, W, H);
  const s = ch.size || 2; const hx = s * 1.5 * 2;
  const n = ch.atoms.length;
  for (let i = 0; i < n; i++){
    const a = ch.atoms[i];
    const u = (a.x / hx + 0.5) * W;
    const v = (a.zz / hx + 0.5) * H;
    if (u < 0 || u > W || v < 0 || v > H) continue;
    const el = a.el || {};
    const lit = a.glow > 0;
    ctx.fillStyle = lit ? '#ffb020' : (a.gas ? '#3b4a6b' : (a.excited ? '#ff8f8f' : '#37c8ff'));
    ctx.fillRect(u | 0, v | 0, 2, 2);
  }
}

/* ========== workspace writer (FS Access root + agents/) ========== */
async function fsEnsureDir(parent, parts){
  let cur = parent;
  for (const p of parts){
    cur = await cur.getDirectoryHandle(p, { create: true });
  }
  return cur;
}
async function fsWriteText(dir, name, text){
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  return name;
}
function runSlug(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate()), '-', p(d.getHours()), p(d.getMinutes()), p(d.getSeconds())].join('');
}
async function saveToWorkspace(kind, files){
  // files: [{ name, text, binary? }]. Writes under agents/<agent>/<kind>/<run>/…
  if (!saveRootDir) return false;
  try {
    const agentDir = await fsEnsureDir(saveRootDir, ['agents', LABS.agent, kind, runSlug()]);
    for (const f of files){
      if (f.binary){
        const fh = await agentDir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(new Blob([f.binary]));
        await w.close();
      } else {
        await fsWriteText(agentDir, f.name, f.text);
      }
    }
    sparkMsg('→ wrote ' + files.length + ' files to agents/' + LABS.agent + '/' + kind);
    return true;
  } catch (err){ sparkMsg('save failed: ' + (err && err.message || err)); return false; }
}
/* manifest + envelope utilities live in the export section (scan/volume/orbital) */

function checksum(text){
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++){ h ^= text.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function binChecksum(bytes){
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++){ h ^= bytes[i]; h = (h * 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function buildManifest(files, kind){
  return {
    format: LABS.format,
    envelope: 2,
    lab: { name: LABS.name, key: LABS.key, agent: LABS.agent, exported: new Date().toISOString() },
    kind,
    experiment: app.cur ? { id: app.cur.id, name: app.cur.name } : null,
    env: app.env ? { id: app.env.id, g: app.env.g, T: app.env.T, atmos: app.env.atm } : null,
    run: app.ch ? { t: Math.round(app.ch.t) + 'fs', atoms: app.ch.atoms.length, bonds: app.ch.bonds.length } : null,
    files: files.map(f => ({
      name: f.name,
      bytes: f.binary ? f.binary.length : ((f.text || '').length),
      checksum: f.binary ? binChecksum(f.binary) : checksum(f.text || ''),
    })),
  };
}

/* ---------- experiment menu ---------- */

function wireGrid(){
  $('btnGrid').addEventListener('click', toggleMenu);
  const layer = $('gridBars');
  layer.addEventListener('pointerdown', (e) => {
    if (!e || !e.target || typeof e.target.closest !== 'function') return;
    const bar = e.target.closest('.gbar');
    if (!bar) return;
    app._gridTap = { id: bar.dataset.id, x: e.clientX || 0, y: e.clientY || 0 };
  });
  layer.addEventListener('click', (e) => {
    if (!e || !e.target || typeof e.target.closest !== 'function') return;
    const bar = e.target.closest('.gbar');
    if (!bar) return;
    const t = app._gridTap;
    app._gridTap = null;
    if (t && t.id === bar.dataset.id){
      const dx = (e.clientX || 0) - t.x;
      const dy = (e.clientY || 0) - t.y;
      if (Math.abs(dx) + Math.abs(dy) > 10) return;
    }
    openExpDetail(bar.dataset.id);
  });
  const go = $('edGo');
  if (go) go.addEventListener('click', () => {
    const id = app._detailId;
    closeExpDetail();
    if (id) deployExperiment(id);
  });
  const cl = $('edClose');
  if (cl) cl.addEventListener('click', closeExpDetail);
  const gcl = $('gridClose');
  if (gcl) gcl.addEventListener('click', closeMenu);
  const esc = document.getElementById('expDetail');
  if (esc) esc.addEventListener('click', (e) => {
    if (e && e.target && e.target.id === 'expDetail') closeExpDetail();
  });
}

function openExpDetail(id){
  const exp = EXPERIMENTS.find(e => e.id === id);
  if (!exp) return;
  app._detailId = id;
  const set = (i, v) => { const el = document.getElementById(i); if (el) el.textContent = v; };
  set('edIco', exp.icon);
  set('edName', exp.name);
  set('edTag', exp.tag + (exp.family ? ' · ' + exp.family : ''));
  set('edDesc', exp.desc);
  set('edGoal', exp.goal);
  const sc = document.getElementById('edSteps');
  if (sc){
    sc.innerHTML = '';
    (exp.steps || []).forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'ed-step';
      d.innerHTML = '<i>' + (i + 1) + '.</i><b>' + (s.title || '') + '</b>' + (s.edu ? '<span>' + s.edu + '</span>' : '');
      sc.appendChild(d);
    });
  }
  set('edEnv', app.env ? 'theatre · ' + envLabel(app.env) : 'theatre · default');
  const pick = exp.pick || {};
  const kit = app._deployKit || (app._deployKit = {});
  kit.shape = pick.geo || 'cube';
  kit.band = (pick.time && pick.time.band) || 'ns';
  kit.preset = (pick.presets && pick.presets[0] && pick.presets[0].id) || 'off';
  kit.feed = (pick.feed && pick.feed[0] && pick.feed[0].id) || 'off';
  buildDossierKit(exp, pick, kit);
  const win = document.getElementById('expDetail');
  if (win) win.classList.add('on');
}

function buildDossierKit(exp, pick, kit){
  const geoWrap = document.getElementById('edGeoSel');
  const timeWrap = document.getElementById('edTimeSel');
  const presetWrap = document.getElementById('edPresetSel');
  if (!geoWrap || !timeWrap || !presetWrap || !document.createElement) return;
  geoWrap.innerHTML = '';
  timeWrap.innerHTML = '';
  presetWrap.innerHTML = '';
  const locked = exp.id === 'chladni';
  const shapes = locked ? SHAPES.filter(s => s.id === 'plate') : SHAPES;
  for (const s of shapes){
    const b = document.createElement('button');
    b.className = 'chip' + (s.id === kit.shape ? ' on' : '');
    b.dataset.id = s.id;
    b.innerHTML = s.icon + ' ' + s.label;
    if (!locked && s.id !== 'plate'){
      b.addEventListener('click', () => {
        kit.shape = s.id;
        for (const c of geoWrap.children) c.classList.toggle('on', c === b);
      });
    }
    geoWrap.appendChild(b);
  }
  for (const t of TIME_BANDS){
    const b = document.createElement('button');
    b.className = 'chip' + (t.key === kit.band ? ' on' : '');
    b.dataset.id = t.key;
    b.textContent = t.label;
    b.addEventListener('click', () => {
      kit.band = t.key;
      for (const c of timeWrap.children) c.classList.toggle('on', c === b);
      const why = document.getElementById('edTimeWhy');
      if (why) why.textContent = t.why + ' · ' + fmtRate(timeBandRate(pick, t.key));
    });
    timeWrap.appendChild(b);
  }
  const tWhy = document.getElementById('edTimeWhy');
  if (tWhy) tWhy.textContent = (pick.time && pick.time.why) + ' · ' + fmtRate(timeBandRate(pick, kit.band));
  for (const p of (pick.presets || [])){
    const b = document.createElement('button');
    b.className = 'chip' + (p.id === kit.preset ? ' on' : '');
    b.dataset.id = p.id;
    const cp = CROSS_PRESETS.find(x => x.id === p.id);
    b.innerHTML = (cp ? cp.icon + ' ' + cp.label : p.id);
    b.addEventListener('click', () => {
      kit.preset = p.id;
      for (const c of presetWrap.children) c.classList.toggle('on', c === b);
      const why = document.getElementById('edPresetWhy');
      if (why) why.textContent = p.why || '';
    });
    presetWrap.appendChild(b);
  }
  const pWhy = document.getElementById('edPresetWhy');
  if (pWhy) pWhy.textContent = (pick.presets && pick.presets[0] && pick.presets[0].why) || '';
  const feedWrap = document.getElementById('edFeedSel');
  const fWhy = document.getElementById('edFeedWhy');
  if (feedWrap){
    feedWrap.innerHTML = '';
    const off = document.createElement('button');
    off.className = 'chip' + (kit.feed === 'off' || !(pick.feed || []).length ? ' on' : '');
    off.textContent = 'off';
    off.addEventListener('click', () => {
      kit.feed = 'off';
      for (const c of feedWrap.children) c.classList.toggle('on', c === off);
      if (fWhy) fWhy.textContent = 'no element feeder — the chamber holds what you start with';
    });
    feedWrap.appendChild(off);
    for (const f of (pick.feed || [])){
      const b = document.createElement('button');
      b.className = 'chip' + (f.id === kit.feed ? ' on' : '');
      b.dataset.id = f.id;
      const e = DATA.find(d => d.z === f.z);
      b.innerHTML = '⇢ ' + (e ? e.s : '#' + f.z) + ' ×' + f.n + ' · ' + fmtRate(f.every) + ' fs';
      b.addEventListener('click', () => {
        kit.feed = f.id;
        for (const c of feedWrap.children) c.classList.toggle('on', c === b);
        if (fWhy) fWhy.textContent = f.why + ' · every ' + fmtRate(f.every) + ' fs · ' + (f.inlet ? 'inlet' : 'bulk');
      });
      feedWrap.appendChild(b);
    }
    const sel = (pick.feed || []).find(f => f.id === kit.feed);
    if (fWhy) fWhy.textContent = sel
      ? sel.why + ' · every ' + fmtRate(sel.every) + ' fs · ' + (sel.inlet ? 'inlet' : 'bulk')
      : 'no element feeder — the chamber holds what you start with';
  }
}

function fmtRate(r){
  if (!Number.isFinite(r)) return '';
  return r >= 1e6 ? (r / 1e6).toFixed(1) + ' M' : r >= 1e3 ? (r / 1e3).toFixed(1) + ' k' : String(Math.round(r));
}

function deployExperiment(id){
  const exp = EXPERIMENTS.find(e => e.id === id);
  if (!exp) return;
  const kit = app._deployKit || {};
  closeMenu();
  loadExperiment(exp);
  const ch = app.ch;
  if (!ch) return;
  const locked = exp.id === 'chladni';
  const wantShape = locked ? 'plate' : (kit.shape || 'cube');
  const shapeChanged = wantShape && ch.shape !== wantShape;
  ch.shape = wantShape;
  fitAtomsToShape(ch);
  if (shapeChanged){
    const meta = SHAPES.find(s => s.id === wantShape);
    removePlateSlab();
    buildChamber();
    rebuildNodes();
    refreshShapeUi();
    syncChladniUi();
    sparkMsg('kit · geometry → ' + (meta ? meta.label : wantShape) + ' · environment geometry only');
  }
  const pick = exp.pick || {};
  const band = kit.band || (pick.time && pick.time.band) || 'ns';
  const rate = timeBandRate(pick, band);
  ch.setRate(rate);
  syncRatePill();
  if (kit.preset && !exp.custom){
    const cp = CROSS_PRESETS.find(x => x.id === kit.preset);
    if (cp) applyCrossPresetReal(cp);
  }
  if (kit.feed && kit.feed !== 'off'){
    const fp = (pick.feed || []).find(f => f.id === kit.feed);
    if (fp) applyFeedPreset(ch, fp);
  } else if (!exp.custom){
    ch.feed.length = 0;
    ch.feederOn = false;
    renderFeedSlots();
    syncFeedArm();
  }
  syncMachRead();
  preselectExperimentElements();
  pauseAtSlowest();
}

function applyFeedPreset(ch, f){
  ch.feed.length = 0;
  ch.addFeed({ z: f.z, n: f.n, every: f.every, start: f.start, inlet: f.inlet !== false });
  ch.feed[0].enabled = true;
  ch.feederOn = true;
  const e = DATA.find(d => d.z === f.z);
  sparkMsg('feeder armed → ' + (e ? e.s : '#' + f.z) + ' ×' + f.n + ' every ' + fmtRate(f.every) + ' fs' + (f.inlet ? ' · inlet' : ''));
  renderFeedSlots();
  syncFeedArm();
}

function closeExpDetail(){
  const el = document.getElementById('expDetail');
  if (el) el.classList.remove('on');
  app._detailId = null;
}

/* Universal dismissal: Esc (or the ✕ on any surface) closes the top-most overlay,
   one layer at a time, so a stacked UI never traps the user. */
function closeOverlayTop(){
  if (app._detailId){ closeExpDetail(); return true; }
  if (app.gridOn){ closeMenu(); return true; }
  const wf = document.getElementById('wallFocus');
  if (typeof crossWallState !== 'undefined' && crossWallState && crossWallState.on && wf && wf.classList && wf.classList.contains('on')){
    closeWallFocus();
    sparkMsg('back to the cross wall');
    return true;
  }
  if (typeof crossWallState !== 'undefined' && crossWallState && crossWallState.on){ closeCrossWall(); return true; }
  if (app.modal){ closeModal(); return true; }
  for (const id of ['settings', 'envWiz', 'launch', 'wallPick', 'saveDlg']){
    const o = document.getElementById(id);
    if (o && o.classList && o.classList.contains('on')){ o.classList.remove('on'); return true; }
  }
  const tp = document.getElementById('toolsPanel');
  if (tp && tp.classList && tp.classList.contains('open')){ toggleTools(); return true; }
  const ep = document.getElementById('elementsPanel');
  if (ep && ep.classList && ep.classList.contains('open')){
    const b = document.getElementById('btnElemToggle');
    if (b && typeof b.click === 'function'){ b.click(); }
    else if (ep.classList.remove){ ep.classList.remove('open'); }
    return true;
  }
  return false;
}

function wireOverlayKeys(){
  if (typeof window.addEventListener !== 'function') return;
  window.addEventListener('keydown', (e) => {
    if (e && (e.key === 'Escape' || e.key === 'Esc') && closeOverlayTop()){
      if (e.preventDefault) e.preventDefault();
    }
  });
}

function toggleMenu(){
  app.gridOn = !app.gridOn;
  document.body.classList.toggle('gridMode', app.gridOn);
  $('btnGrid').classList.toggle('active', app.gridOn);
  $('gridLayer').classList.toggle('open', app.gridOn);
  if (app.gridOn) renderMenu();
}

function closeMenu(){
  app.gridOn = false;
  document.body.classList.remove('gridMode');
  $('gridLayer').classList.remove('open');
  $('btnGrid').classList.remove('active');
  const bars = $('gridBars');
  if (bars) bars.innerHTML = '';
  closeExpDetail();
}

const EXP_GENRES = [
  { key: 'chemistry', label: 'Chemistry' },
  { key: 'physics',   label: 'Physics' },
  { key: 'materials', label: 'Materials' },
  { key: 'biology',   label: 'Biology' },
];
function expGenre(exp){
  if (exp && exp.custom) return 'custom';
  if (!exp.family) return 'core';
  return EXP_GENRES.some(g => g.key === exp.family) ? exp.family : 'core';
}
function genreLabel(key){
  if (key === 'custom') return 'Custom Missions';
  if (key === 'core') return 'Command Centre';
  const g = EXP_GENRES.find(x => x.key === key);
  return g ? g.label : 'Command Centre';
}

function renderMenu(){
  const bars = $('gridBars');
  if (!bars) return;
  bars.innerHTML = '';
  const active = app.cur && app.cur.id;
  const groups = new Map();
  for (const exp of EXPERIMENTS){
    const k = expGenre(exp);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(exp);
  }
  let gidx = 0;
  for (const [key, exps] of groups){
    const head = document.createElement('div');
    head.className = 'gnr';
    head.innerHTML = `<span class="gnr-ico">${key === 'custom' ? '★' : key === 'core' ? '▮' : key === 'chemistry' ? '⚗' : key === 'physics' ? '⚛' : key === 'materials' ? '◆' : '🧬'}</span>
      <b>${genreLabel(key)}</b><i>${exps.length} missions · tap to load</i>`;
    bars.appendChild(head);
    exps.forEach((exp, ii) => {
      const i = gidx + ii;
      const live = exp.id === active;
      const bar = document.createElement('button');
      bar.className = 'gbar' + (live ? ' focus' : '');
      bar.dataset.id = exp.id;
      bar.innerHTML = `<span class="gi">${exp.icon}</span>
        <span class="gbody"><span class="gn">${exp.name}</span><span class="gd">${exp.desc}</span><span class="gtag">${exp.tag}</span></span>
        ${live ? '<span class="glive">● live</span>' : '<span class="ggo">→</span>'}
        <span class="gkey">⌁${i + 1}</span>`;
      bars.appendChild(bar);
    });
    gidx += exps.length;
  }
}

function focusMenu(id){
  const exp = EXPERIMENTS.find(e => e.id === id);
  if (!exp) return;
  closeMenu();
  loadExperiment(exp);
  sparkMsg(exp.name + ' · ▦ reopens the experiment menu');
}

let last = performance.now();
let hudT = 0;
function tick(now){
  requestAnimationFrame(tick);
  const dt = Math.min(40, now - last);
  last = now;
  if (app.running && app.ch && !crossWallState.on){
    app.ch.advance(dt);
    checkSteps();
    updateNodes(dt);
    updateStrikeRings(dt);
    updateBonds();
    updateExtras();
    updatePlateViz();
    instTick(dt);
  } else {
    updateStrikeRings(dt);
  }
  drawScope();
  updateMinimap(dt);
  syncInletPorts();
  if (app.modal && app.modalNode){
    const a = app.modalNode;
    if (!app.ch.atoms.includes(a)) { closeModal(); }
    else {
      const p = projectNodePos(a);
      if (p.inFront) placeModal(p.x, p.y);
    }
  }
  hudT += dt;
  if (hudT > 90){
    hudT = 0;
    updateHud();
    pushEvents();
    updateStepHud();
  }
  controls.update();
  if (crossWallState.on){
    updateCrossWallState(dt);
    renderCrossWall();
  } else {
    if (scanState.on) updateScan();
    renderer.render(scene, camera);
    updateTracking();
  }
}

function updatePlateViz(){
  if (!plateSlab) return;
  const ch = app.ch;
  plateSlab.visible = (ch.shape || 'cube') === 'plate';
  const amp = clamp(ch.drive || 0, 0, 1);
  const fl = plateSlab.material;
  fl.opacity = 0.12 + amp * 0.3;
  const m = Math.max(1, (ch.mode && ch.mode.m) || 1) * Math.max(1, (ch.mode && ch.mode.n) || 2);
  fl.color.setHSL(0.62 + (m % 8) * 0.02, 0.55, 0.35 + amp * 0.2);
  fl.emissive.setHSL(0.6, 0.6, 0.06 + amp * 0.14);
  // ripple the top & bottom faces into the standing wave — the plate visibly
  // flexes under the chosen (m,n) mode, so mode/freq/drive taps move the preview
  const geo = plateSlab.geometry;
  const p = geo.attributes.position;
  const base = plateSlab.userData.basePos;
  if (base && p && plateSlab.visible && amp > 0.01){
    const L = Math.max(0.1, ch.size);
    const hL = L * S;
    const half = L * 0.22 * S;
    const waveAmp = amp * 0.4 * half;
    const mm = (ch.mode && ch.mode.m) || 2, nn = (ch.mode && ch.mode.n) || 2;
    for (let i = 0; i < p.count; i++){
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const sy = Math.abs(by) > half * 0.9 ? Math.sign(by) : 0;   // faces only — side walls keep their rig
      if (sy === 0){ if (p.getY(i) !== by) p.setY(i, by); continue; }
      const wx = bx / hL, wz = bz / hL;
      const taper = Math.max(0, 1 - Math.abs(wx)) * Math.max(0, 1 - Math.abs(wz));
      const wave = Math.cos(Math.PI * mm * wx) * Math.cos(Math.PI * nn * wz) * taper;
      p.setY(i, sy * (half + wave * waveAmp));
    }
    p.needsUpdate = true;
  }
  if (ch.sandMode) plateSlab.scale.setScalar(1 + amp * 0.004 * Math.sin(ch.platePhase += 0.2));
}

function updateHud(){
  const ch = app.ch;
  if (!ch) return;
  $('timeRead').textContent = fmtFancyTime(ch.t);
  $('atomRead').textContent = ch.atoms.length + ' atoms';
  $('bondRead').textContent = ch.bonds.length + ' bonds';
  const tempEl = $('tempReadMeasure');
  tempEl.textContent = ch.sandMode
    ? '◈ sand settled ' + (ch.sandOrder * 100).toFixed(0) + '%'
    : '° ' + (ch.T_cur || 0).toFixed(0) + ' K';
  const goal = $('expGoal');
  if (goal && app.cur) goal.textContent = 'Goal: ' + app.cur.goal;
}

/* ---------- moveable UI modules ----------
   Every module is one whole element (its container), so dragging a grip always
   moves the full group — a modal, footer or stat strip never breaks apart into
   individual children. Drag = pointer-drag the '≡' grip; edges snap to the
   viewport and to other visible modules. Positions/visibility persist. */
const UIMODS = [
  { id: 'hud',         label: 'Stats bar',     def: 'top' },
  { id: 'scanFooter',  label: 'MRI scanner',   def: 'bottom' },
  { id: 'goalPanel',   label: 'Goal card',     def: 'bottom-right' },
  { id: 'minimapWrap', label: 'Minimap',       def: 'bottom-left' },
  { id: 'eventFeed',   label: 'Event feed',    def: 'left' },
  { id: 'toolsPanel',  label: 'Tools sheet',   def: 'right' },
  { id: 'elementsPanel', label: 'Element picker', def: 'center' },
];
const MOD_SNAP = 10;

function modEl(id){ return document.getElementById(id); }

function modRect(id){
  const el = modEl(id); if (!el) return null;
  if (typeof el.getBoundingClientRect === 'function') return el.getBoundingClientRect();
  return null;
}

function applyModPos(id, x, y){
  const el = modEl(id); if (!el || !el.style) return;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 760;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 480;
  const w = el.offsetWidth || ((modRect(id) && modRect(id).width) || 0);
  const h = el.offsetHeight || ((modRect(id) && modRect(id).height) || 0);
  x = Math.max(0, Math.min(x, Math.max(0, vw - w)));
  y = Math.max(0, Math.min(y, Math.max(0, vh - h)));
  el.style.position = 'fixed';
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'none';
  el.style.margin = '0';
}

function snapPoint(id, x, y, w, h){
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 760;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 480;
  const xs = [0, vw - w], ys = [0, vh - h];
  for (const o of UIMODS){
    if (o.id === id) continue;
    const oe = modEl(o.id);
    if (!oe || o.vis === false || (oe.style && oe.style.display === 'none')) continue;
    const r = modRect(o.id); if (!r) continue;
    xs.push(r.left, r.left + r.width);
    ys.push(r.top, r.top + r.height);
  }
  let best = Infinity, rx = x, ry = y;
  for (const a of xs){ const d = Math.abs(a - x); if (d < best && d <= MOD_SNAP){ best = d; rx = a; } }
  best = Infinity;
  for (const a of ys){ const d = Math.abs(a - y); if (d < best && d <= MOD_SNAP){ best = d; ry = a; } }
  rx = Math.max(0, Math.min(rx, Math.max(0, vw - w)));
  ry = Math.max(0, Math.min(ry, Math.max(0, vh - h)));
  return { x: rx, y: ry };
}

function moduleDragStart(id, clientX, clientY, ev){
  const el = modEl(id);
  if (!el) return;
  if (ev){
    if (ev.preventDefault) ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
  }
  const host = (typeof document !== 'undefined' && typeof document.addEventListener === 'function') ? document : el;
  const r = (typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : null;
  if (!r) return;
  applyModPos(id, r.left, r.top);
  const dx0 = (typeof clientX === 'number' ? clientX : r.left) - r.left;
  const dy0 = (typeof clientY === 'number' ? clientY : r.top) - r.top;
  if (el.classList.add) el.classList.add('dragging');
  let raf = 0;
  const place = (gx, gy) => {
    const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    const p = snapPoint(id, gx - dx0, gy - dy0, w, h);
    applyModPos(id, p.x, p.y);
  };
  const mv = (ev2) => {
    if (raf) return;
    if (typeof requestAnimationFrame === 'function'){
      raf = requestAnimationFrame(() => { raf = 0; place(ev2.clientX || 0, ev2.clientY || 0); });
    } else {
      place(ev2.clientX || 0, ev2.clientY || 0);
    }
  };
  const up = () => {
    if (el.classList.remove) el.classList.remove('dragging');
    host.removeEventListener('pointermove', mv);
    host.removeEventListener('pointerup', up);
    host.removeEventListener('pointercancel', up);
    saveModLayout();
  };
  host.addEventListener('pointermove', mv);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  const t = (ev && ev.target) || el;
  if (t.setPointerCapture && ev && typeof ev.pointerId === 'number'){ try { t.setPointerCapture(ev.pointerId); } catch(_){} }
}

function initModuleGrip(id){
  const el = modEl(id);
  if (!el || !document.createElement) return;
  // A previous innerHTML reset (the event feed re-renders its rows) wipes the
  // grip node out of the children list even though the _grip handle is still
  // set — re-create it so the module stays draggable.
  if (el._grip && Array.prototype.indexOf.call(el.children, el._grip) !== -1) return;
  const g = document.createElement('span');
  if (!g.classList) return;
  g.className = 'ui-grip';
  g.textContent = '≡';
  g.setAttribute('role', 'button');
  g.setAttribute('title', 'drag to move · snaps to edges');
  g._gid = id;
  g.addEventListener('pointerdown', (e) => moduleDragStart(id, e.clientX, e.clientY, e));
  el.appendChild(g);
  el._grip = g;
}

// A module whose only child is its own drag grip is an empty shell — the grip
// floats alone in a bordered frame. Keep the grip hidden until the module has
// real content so the "lone ≡" ghost module never appears (and never eats a
// tap meant for the scene).
function syncModuleShell(id){
  const el = modEl(id);
  if (!el) return;
  const g = el._grip || null;
  const hasContent = Array.prototype.some.call(el.children || [], c => !!c && c !== g && c.className !== 'ui-grip');
  if (g) g.style.display = hasContent ? '' : 'none';
}

// The chamber-scan minimap spawns mid screen (horizontally centered, ~80px below
// the vertical centre). Saved drag positions are not restored for it: the minimap
// has no pointer-events so it can't be dragged, and stale zero rects captured by
// older layout saves would pin it to the top-left forever.
function anchorMinimap(){
  const el = modEl('minimapWrap');
  if (!el || !el.style) return;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 760;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 480;
  const w = el.offsetWidth || 132, h = el.offsetHeight || 132;
  const x = Math.max(0, Math.round((vw - w) / 2));
  const y = Math.min(Math.max(8, Math.round(vh / 2 - h / 2 + 80)), Math.max(8, vh - h - 8));
  applyModPos('minimapWrap', x, y);
}

function setModVisible(id, on){
  const m = UIMODS.find(q => q.id === id);
  if (m) m.vis = !!on;
  const el = modEl(id); if (!el) return;
  el._vis = !!on;
  if (id === 'elementsPanel'){
    // element picker is opened/closed with the ＋ toggle + `.open` class
    el.style.display = '';
    el.classList.toggle('open', !!on);
    const b = modEl('btnElemToggle');
    if (b && b.classList) b.classList.toggle('active', !!on);
  } else if (el.style) el.style.display = on ? '' : 'none';
  if (id === 'hud'){
    const b = document.body;
    if (b && b.classList){ if (on) b.classList.remove('hud-min'); else b.classList.add('hud-min'); }
  }
  if (id === 'scanFooter' && on) anchorScanFooter();
  saveModLayout();
}

// The MRI scanner spawns docked under the top button bar, flushed to the left
// edge with a small gap — not over the action buttons.
function topbarBottom(){
  const tb = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('topbar') : null;
  if (!tb || typeof tb.getBoundingClientRect !== 'function') return 52;
  const r = tb.getBoundingClientRect();
  return (r && Number.isFinite(r.bottom) && r.bottom > 0) ? r.bottom : 52;
}
function anchorScanFooter(){
  const el = modEl('scanFooter');
  if (!el || !el.style) return;
  applyModPos('scanFooter', 8, topbarBottom() + 88);
}

function centerMod(id){
  const el = modEl(id); if (!el) return;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 760;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 480;
  if (id === 'elementsPanel') el.style.width = 'min(460px, calc(100vw - 20px))';
  const w = el.offsetWidth || 460, h = el.offsetHeight || 320;
  applyModPos(id, Math.max(0, (vw - w) / 2), Math.max(0, (vh - h) / 2));
}

function modHasSavedPos(id){
  const s = app._modLayout && app._modLayout[id];
  return s && typeof s.x === 'number' && Number.isFinite(s.x) && typeof s.y === 'number' && Number.isFinite(s.y);
}

function saveModLayout(){
  const q = {};
  for (const m of UIMODS){
    if (modEl(m.id)){
      q[m.id] = {};
      if (m.vis === false) q[m.id].vis = false;
      const r = modRect(m.id);
      if (m.vis !== false && r && Number.isFinite(r.left) && Number.isFinite(r.top) && r.width > 0 && r.height > 0 && !isStaleTopY(m.id, r.top)){
        q[m.id].x = Math.round(r.left); q[m.id].y = Math.round(r.top);
      }
    }
  }
  app._modLayout = q;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('apsim_mods', JSON.stringify(q)); } catch(_){}
}

function restoreModLayout(){
  let q = null;
  try { if (typeof localStorage !== 'undefined'){ const raw = localStorage.getItem('apsim_mods'); if (raw) q = JSON.parse(raw); } } catch(_){}
  app._modLayout = q || {};
  for (const m of UIMODS){
    const s = app._modLayout[m.id];
    if (idSpawnAnchorAround(m.id)) continue;
    if (!s) continue;
    if (s.vis === false) setModVisible(m.id, false);
    else if (typeof s.x === 'number' && Number.isFinite(s.x) && typeof s.y === 'number' && Number.isFinite(s.y)) applyModPos(m.id, s.x, s.y);
  }
  for (const m of UIMODS) syncModuleShell(m.id);
}

// A top-of-screen y (inside the button bar + stats strip band) is unusable for
// the feed/goal cards: the top bar and HUD sit on top of them and swallow both
// the card and its drag grip, which is exactly how the event feed got stuck
// "way up there" and immoveable. Such saves are treated as stale and re-docked.
function modTopBandY(){ return topbarBottom() + 56; }
function isStaleTopY(id, y){
  if (id !== 'eventFeed' && id !== 'goalPanel') return false;
  if (!(y >= 0 && Number.isFinite(y))) return true;
  return y < modTopBandY();
}
function anchorEventFeed(){
  const el = modEl('eventFeed');
  if (!el || !el.style) return;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 760;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 480;
  const w = el.offsetWidth || 300, h = el.offsetHeight || 160;
  const x = Math.max(4, 10);
  const y = Math.min(Math.max(8, vh - Math.min(vh - 8, Math.max(140, h)) - 12), Math.max(8, vh - h - 8));
  applyModPos('eventFeed', x, y);
}
function anchorGoalPanel(){
  const el = modEl('goalPanel');
  if (!el || !el.style) return;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 760;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 480;
  const w = el.offsetWidth || 250, h = el.offsetHeight || 90;
  applyModPos('goalPanel', Math.max(0, vw - w - 10), Math.max(0, vh - h - 12));
}

// Scanner placement policy: a saved position that lands on/above the top button
// bar (or one that's missing) is treated as stale — re-dock it under the bar so
// the grab handle stays reachable and the module never hides behind the actions.
// The minimap honors positions from real drags, but a degenerate top-left (0,0)
// save is treated as stale and re-anchored mid screen.
function idSpawnAnchorAround(id){
  if (id === 'scanFooter'){
    const s = app._modLayout && app._modLayout[id];
    if (s && s.vis === false){ setModVisible(id, false); return true; }
    if (s && typeof s.y === 'number' && Number.isFinite(s.y) && s.y >= topbarBottom() + 4){
      applyModPos(id, s.x, s.y);
    } else {
      anchorScanFooter();
    }
    return true;
  }
  if (id === 'minimapWrap'){
    const s = app._modLayout && app._modLayout[id];
    if (s && s.vis === false){ setModVisible(id, false); return true; }
    if (s && typeof s.x === 'number' && Number.isFinite(s.x) && typeof s.y === 'number' && Number.isFinite(s.y) && !(s.x === 0 && s.y === 0)){
      applyModPos(id, s.x, s.y);
    } else {
      anchorMinimap();
    }
    return true;
  }
  if (id === 'eventFeed'){
    const s = app._modLayout && app._modLayout[id];
    if (s && s.vis === false){ setModVisible(id, false); return true; }
    if (s && typeof s.x === 'number' && Number.isFinite(s.x) && typeof s.y === 'number' && Number.isFinite(s.y) && !isStaleTopY(id, s.y)){
      applyModPos(id, s.x, s.y);
    } else {
      anchorEventFeed();
    }
    return true;
  }
  if (id === 'goalPanel'){
    // bottom-right card: a stale top-band save re-anchors down to its default corner
    const s = app._modLayout && app._modLayout[id];
    if (s && s.vis === false){ setModVisible(id, false); return true; }
    if (s && typeof s.x === 'number' && Number.isFinite(s.x) && typeof s.y === 'number' && Number.isFinite(s.y) && !isStaleTopY(id, s.y)){
      applyModPos(id, s.x, s.y);
    } else {
      anchorGoalPanel();
    }
    return true;
  }
  return false;
}

function buildModToggles(){
  const host = document.getElementById('modList'); if (!host || !document.createElement) return;
  if (typeof host.replaceChildren === 'function'){ try { host.replaceChildren(); } catch(_){} }
  else { try { host.innerHTML = ''; } catch(_){} try { while (host.children && host.children.length) host.children.pop(); } catch(_){} }
  for (const m of UIMODS){
    if (!modEl(m.id)) continue;
    const lab = document.createElement('label');
    if (!lab.classList) continue;
    lab.className = 'mod-tog';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (m.vis === false) ? false : true;
    cb._gid = m.id;
    cb.addEventListener('change', () => { setModVisible(m.id, cb.checked); });
    lab.appendChild(cb);
    const spa = document.createElement('span');
    spa.textContent = m.label;
    lab.appendChild(spa);
    host.appendChild(lab);
  }
}

function initModules(){
  for (const m of UIMODS){ m.vis = true; initModuleGrip(m.id); }
  restoreModLayout();
  for (const m of UIMODS) syncModuleShell(m.id);
}

app.UIMODS = UIMODS;
app.applyModPos = applyModPos;
app.anchorMinimap = anchorMinimap;
app.snapPoint = snapPoint;
app.setModVisible = setModVisible;
app.saveModLayout = saveModLayout;
app.restoreModLayout = restoreModLayout;
app.anchorScanFooter = anchorScanFooter;
app.anchorEventFeed = anchorEventFeed;
app.syncModuleShell = syncModuleShell;
app.topbarBottom = topbarBottom;
app.idSpawnAnchorAround = idSpawnAnchorAround;
app.buildModToggles = buildModToggles;
app.initModules = initModules;

function boot(){
  const want = (typeof location !== 'undefined') ? findExperiment(new URLSearchParams(location.search).get('exp')) : null;
  const saved = loadEnv();
  app.env = saved || envDefault();
  LABS.agent = loadAgent();
  nodesGroup = new THREE.Group();
  scene.add(nodesGroup);
  loadExperiment(want || findExperiment('salt') || EXPERIMENTS[0]);
  scene.add(bondsMesh);
  bindRaycasts();
  wireControls();
  wireTrack();
  wireScan();
  wireCrossStack();
  wireWallFocus();
  loadCustomExpsFromStorage();
  wireSaveDlg();
  syncRatePill();
  applyEnv(app.env);
  wireOverlayKeys();
  wireEnvLaunch();
  initModules();
  resize();
  requestAnimationFrame(tick);
  const wantsWizard = (typeof location !== 'undefined') ? new URLSearchParams(location.search).get('env') === 'new' : false;
  if (wantsWizard) openEnvWizard();
  else if (!saved) openLaunch();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { app };