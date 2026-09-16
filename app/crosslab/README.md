# Quantum→Universe: Theoretical Physics Engine

A single-file Three.js simulation spanning **16 orders of magnitude** — from Planck scale (10⁻³⁵ m) to the observable universe (10²⁶ m) — unifying slime-mold pathfinding, neural weight alignment, and fundamental physics.

---

## Physics Models Implemented

| Scale | Physics | Implementation |
|-------|---------|----------------|
| **Planck** (10⁻³⁵) | Quantum foam, spacetime discreteness | reserved (UI knob `planckScale`, not wired) |
| **Quark/Nuclear** (10⁻¹⁸–10⁻¹⁵) | Strong force, confinement, color charge | `strongForce` attraction between same-shell nodes |
| **Atomic** (10⁻¹⁰) | Electron shells, quantum numbers | `energyShells`, `higgsField` mass coupling |
| **Molecular** (10⁻⁹–10⁻⁷) | Van der Waals, hydrogen bonds, tunneling | `tunnel` probability through potential barriers |
| **Mesoscopic** (10⁻⁵–1) | Slime mold chemotaxis, diffusion-limited aggregation | Agent trail deposition + sensor-based steering |
| **Human/City** (1–10⁴) | Neural weight alignment, Hebbian learning | `alignStrength` × activation correlation |
| **Planetary/Stellar** (10⁷–10⁹) | Newtonian gravity + GR curvature lensing | `gravity` × mass, `curvature` geodesic deviation |
| **Galactic** (10²⁰) | Dark matter filaments, MOND-like forces | `darkEnergy` repulsion at large r, `inflation` expansion |
| **Universal** (10²⁶) | ΛCDM cosmology | `decoherence` wave collapse; `vacuumEnergy` reserved (UI knob) |

### Key Equations

**Spacetime Curvature (agent step):**
```
Δx = v·dt + ½·curvature·R·(n×v)·dt²   // geodesic deviation
```

**Quantum Wavefunction Evolution:**
```
ψ(t+dt) = ψ(t)·exp(-i·H·dt/ħ) - decoherence·ψ(t)·dt
H = p²/2m + V + higgsField·|ψ|²
```

**Entanglement Correlation:**
```
⟨σᵢ·σⱼ⟩ = entangle·exp(-|rᵢ-rⱼ|/ξ)  // ξ = correlation length
```

**Tunneling Probability (WKB):**
```
P_tunnel ≈ exp(-2·∫√(2m(V-E))/ħ dx)  // scaled by tunnel parameter
```

**Slime Mold Chemotaxis:**
```
trail[x,y,z] *= evaporation + diffusion·∇²trail
sensor = trail(pos + sensorDist·(dir ± sensorAngle))
steer = rotationAngle·sign(sensorL - sensorR)
```

**Neural Alignment (Hebbian):**
```
Δwᵢⱼ = alignStrength·(aᵢ·aⱼ - wᵢⱼ)  // weight → activation correlation
```

**Dark Energy / Inflation:**
```
ṙ = r·(inflation + darkEnergy·ln(r/r₀))
```

---

## AI / Machine Learning Connections

| Simulator Concept | ML Analogy |
|-------------------|------------|
| **Node weight** | Neuron synaptic weight |
| **Activation (nodeAct)** | ReLU / sigmoid output |
| **Bias (nodeBias)** | Neuron bias term |
| **Alignment force** | Hebbian / STDP weight update |
| **Entanglement** | Attention mechanism / weight sharing |
| **Energy shells** | Layer depth / hierarchical features |
| **Slime agents** | Particle swarm / ant colony optimization |
| **Wavefunction collapse** | Dropout / stochastic regularization |
| **Spacetime curvature** | Riemannian optimization on manifolds |
| **Dark energy repulsion** | Contrastive loss / negative sampling |

**Training loop analogy:**
```
sim.update() ≈ forward pass + weight update
agent step ≈ gradient sampling
trail diffusion ≈ momentum / RMSprop smoothing
```

---

## Quick Start

```bash
# Serve the single HTML file (ES modules require HTTP)
cd /root
python3 -m http.server 8080
# open http://localhost:8080/physics_simulator.html
```

Or open `preview.html` for side-by-side presets:
```bash
open http://localhost:8080/preview.html
```

### Run controls & HUD

The sim **starts paused** so you can compose the plate first. The run bar has
`▶ Run experiment` / `❚❚ Pause` (default paused) / `⏭ Step` (single `sim.update`),
a **Time** slider (`CFG.runSpeed` 0.01–1.00 steps per frame) and a live `stepCount`;
`⚒ Export` on the bar opens the same run-report card as the studio's Export button.

The HUD shows **Scale** name + value, running **Nodes / Agents / Links / FPS** and
**Energy / Entropy** readouts, plus a **scale-ladder indicator** (right-edge vertical
bar with fill + dot). `◂ Return to hub` links back to the lab index.

### Mesh wall shells & ensemble layout

The **`Mesh wall shells`** checkbox switches the ensemble from free-fall to
**two concentric shell walls** (`SHELLS = [3.2, 5.4]`, Fibonacci-sphere placement)
that hold nodes as a layered "world/cluster" of devices instead of one collapsing
blob; a spring backs the shell layout off when gravity is high so web-forming
presets survive.

### Security system panel (simulator)

The research tool's ⚙ → **Security System** row gives you:
`Threat`, `Firewall`, `Defenders` sliders; `Security demo` and
`Moving-target defense (A)` checkboxes; `⟠ Attack burst` (spawns an attacker batch);
`↻ rotate now`; `⚔ Reset` (clears blocked/intrusions/peakStress/pulses/compromised).
Live status lines show **SECURE / UNDER ATTACK · protected N nodes · blocked ·
intrusions** and the auto-defense line (strategy · rotation · defender paths · cover %).
`Attack Beams` under Visuals renders the red attacker→node pulses.

Attacker telemetry follows the same taxonomy as the console: roles
`attacker`/`defender`/`legit`, protocol `syn-flood|dns-amp|tls-reneg`, TEST-NET source
IPs `192.0.2.x`, FNV-1a `simHash`, `ATK-###` ids, hops 2–10 with `ttl = 64-hops`,
risk 0.4–1.0, live target node. The engine also keeps a capped (40-event) security
ledger (`quarantine/release/deploy/burst/auto/blocked/deferred/intrusion/secured`)
and a `defenseLedger` audit trail; compromise flags a node at `weight < 0.30`
(firewall heals with `p = firewall·0.05`/tick, auto-restores above 0.55; stress
decays ×0.995/frame). Population is balanced automatically: ambient attacker hold =
`threatLevel·30`, defender refill every 20 ticks, a deterministic DDoS wave every 100
ticks, hard 1024-agent cap. Scale-dependent physics: `sf = clamp((scaleIdx+1)/8,
0.05, 2)` scales agent step, bounds and energy shells so behavior is scale-index-aware.

---

## Controls Reference

### Simulation
| Slider | Range | Physics Meaning |
|--------|-------|-----------------|
| Agents | 10–800 | Slime mold particles |
| Nodes | 10–600 | Neural / physics vertices |
| Speed | 0.01–1.0 | reserved (agent speed is per-role; knob not wired) |
| Evaporation | 0.800–0.999 | Trail decay rate |
| Diffusion | 0.00–1.00 | Trail spread |
| Sensor Angle | 5°–120° | Chemotaxis sensitivity |
| Rotation | 5°–120° | Turn rate |
| Sensor Dist | 0.1–5.0 | Forward feeler reach |
| Trail Deposit | 0.01–0.50 | Pheromone strength |
| Trail Res | 16–64 | Grid resolution |
| Alignment | 0.000–0.200 | Hebbian weight sync |
| Repulsion | 0.000–0.200 | Node separation |
| Damping | 0.50–0.99 | Velocity decay |
| Max Links | 1–12 | Connection degree |
| Link Threshold | 0.1–5.0 | Distance for edges |

### Theoretical Physics
| Slider | Range | Theory |
|--------|-------|--------|
| Gravity G | 0.00–1.00 | Newtonian + GR lensing |
| Quantum ħ | 0.00–1.00 | Wavefunction evolution |
| Entanglement | 0.00–1.00 | Non-local correlation |
| Tunneling | 0.00–1.00 | Barrier penetration |
| Curvature | 0.00–1.00 | Geodesic deviation |
| Energy Shells | 0–12 | Quantum number n |
| Dark Energy | 0.00–1.00 | Λ repulsion |
| Inflation | 0.000–0.050 | Exponential expansion |
| α Fine Structure | 0.00–2.00 | reserved (UI knob, not wired) |
| Strong Force | 0.00–1.00 | Color confinement |
| Weak Force | 0.00–1.00 | reserved (UI knob, not wired) |
| Higgs Field | 0.00–1.00 | Mass generation |
| Decoherence | 0.00–0.50 | Wave collapse |
| Vacuum Energy | 0.000–0.050 | reserved (UI knob, not wired) |
| Planck Scale | 0.00–1.00 | reserved (UI knob, not wired) |

### Visuals
| Control | Effect |
|---------|--------|
| Preset | 6 built-in configurations |
| Style | Points / Glow / Wireframe / Hybrid |
| Node/Agent/Link Color | Base hue |
| Background | Scene clear color |
| Color Offset | 0–1.0 hue shift from neighbors |
| Color Intensity | 0.1–1.0 saturation multiplier |
| Node Opacity | 0.1–1.0 |
| Glow Size | 0–5.0 point scale multiplier |
| Checkboxes | Grid, Agents, Links, Auto-rotate, Wave, Lensing, Heatmap, **Mesh wall shells**, **Attack Beams** |

### Export / Import / Node Inspector
- **Export** (⚒ run bar or Export button) opens the **run report infocard**: facts grid + Structure/Quantities/Thermodynamics cells + prose summary, configuration plate, scale ladder, a **"SecMesh · this run vs baseline"** block (run outcome, fleet/threat, stress cells, the 69-trial baseline) and a **moving-target-defense block** when auto-defense ran. Actions: `🖨 print`, `⧉ copy json`, `⇩ download` as `quantum-universe-run-report.json`, `✕ close`; a raw JSON `<details>` holds everything.
- **Import** → pastes JSON, restores weights, positions, entanglement
- **Node List** → click any node to inspect weight, mass, charge, spin, shell, wavefunction, entangled partners, position, velocity; the inspector has an **editable `Label` field + free-form `Data` textarea + Save** (persisted into export/import). Tap-inspect on the live scene gives cluster stats (members, links, density, radius, centroid, mean weight, ⚠ UNDER ATTACK) or per-node/agent details.
- **Randomize** → shuffles weights/mass/charge/spin/wave
- **Randomize All** → + positions, velocities, biases, labels (and re-randomizes agents)
- **Reset** → full re-initialization

### Tracking & inspection
- **Track closest to camera** + **Track count** (1–12): a face-tracker-style overlay boxes the N nearest nodes with labels, flagging `⚠` red when compromised.
- **T** toggles tracking; **A** toggles moving-target auto-defense + security; **Esc** closes the studio.

### Presets (all six, boot via `?preset=` URL)
| Key | Label | Sets | Never sets |
|-----|-------|------|-----------|
| `quantumFoam` | Quantum Foam | quantum .8, tunnel .5, entangle .7, decoherence .01, planckScale .5 (reserved) | no counts, no wave |
| `atomic` | Atomic Lattice | energyShells 7, strongForce .4, quantum .1, gravity .01 | no counts, no render style |
| `galactic` | Galactic Web | gravity .8, darkEnergy .3, curvature .7, inflation .1, alignStrength .01 | no counts, no auto-rotate |
| `slimeMold` | Slime Mold | tunnel 0, quantum 0, gravity 0, evaporation .99, diffusion .15, sensorAngle .7 | — |
| `neuralNet` | Neural Net | alignStrength .08, repulsionStrength .01, damping .92, maxConnections 8 | — |
| `chaos` | Chaos | quantum .9, gravity .6, entangle .8, tunnel .7, curvature .8, darkEnergy .9 | — |

Counts stay at defaults (200 agents / 180 nodes) unless changed via the studio sliders. The `?preset=` URL applies the recipe and syncs every slider thumb on load.

---

## Three Example Setups

### 1. Quantum Foam (`?preset=quantumFoam`)
**Physics:** Planck-scale fluctuations, strong entanglement, rapid tunneling
```json
{ "quantum": 0.8, "tunnel": 0.5, "entangle": 0.7, "decoherence": 0.01, "planckScale": 0.5 }
```
- **Scale:** PLANCK → QUARK
- **Agents:** 200 | **Nodes:** 180
- **Visual:** default palette (set by the scale-ladder theme); wave/lensing are optional Visuals toggles, not preset defaults
- **AI link:** Models **quantum neural networks** — entanglement = weight sharing across layers

### 2. Atomic Lattice (`?preset=atomic`)
**Physics:** Crystal bonds, electron shells, strong-force lattice, Higgs mass
```json
{ "energyShells": 7, "strongForce": 0.4, "quantum": 0.1, "gravity": 0.01 }
```
- **Scale:** ATOMIC → MOLECULAR
- **Agents:** 200 | **Nodes:** 180 (defaults)
- **AI link:** **Graph neural network** — nodes = atoms, edges = bonds, shells = message-passing rounds

### 3. Galactic Web (`?preset=galactic`)
**Physics:** Dark matter filaments, cosmic inflation, universal curvature
```json
{ "gravity": 0.8, "darkEnergy": 0.3, "curvature": 0.7, "inflation": 0.1, "alignStrength": 0.01 }
```
- **Scale:** GALACTIC → UNIVERSAL
- **Agents:** 200 | **Nodes:** 180 (defaults)
- **AI link:** **Transformer attention** — nodes = tokens, filaments = attention heads, dark energy = positional encoding decay

---

## Comparison Table

| Parameter | Quantum Foam | Atomic Lattice | Galactic Web |
|-----------|--------------|----------------|--------------|
| Scale | 10⁻³⁵ – 10⁻¹⁸ | 10⁻¹⁰ – 10⁻⁹ | 10²⁰ – 10²⁶ |
| Gravity | 0.00 | 0.01 | 0.80 |
| Quantum ħ | 0.80 | 0.10 | 0.00 |
| Entanglement | 0.70 | 0.00 | 0.00 |
| Tunneling | 0.50 | 0.00 | 0.00 |
| Strong Force | 0.00 | 0.40 | 0.00 |
| Energy Shells | 0 | 7 | 0 |
| Dark Energy | 0.00 | 0.00 | 0.30 |
| Curvature | 0.00 | 0.00 | 0.70 |
| Inflation | 0.00 | 0.00 | 0.10 |
| Agents | 200 | 200 | 200 |
| Nodes | 180 | 180 | 180 |
| Connections | sparse (entanglement) | dense (bonds) | filamentary |

---

## JSON Export Format (per node)

```json
{
  "label": "Node_42",
  "data": "{\"seed\":\"0.7342\"}",
  "weight": 0.8473,
  "bias": -0.1234,
  "mass": 1.234,
  "charge": 0.567,
  "spin": -0.5,
  "waveReal": 0.234,
  "waveImag": 0.111,
  "shell": 3,
  "entangled": [5, 12, 42],
  "pos": [1.23, -0.45, 3.67],
  "vel": [0.01, -0.02, 0.005]
}
```

Import restores **all** fields including entanglement graph.

---

## Performance Notes

- **60 FPS target** at 600 nodes / 800 agents
- `renderer.setPixelRatio(1)` — no HiDPI supersampling
- Spatial hash grid (32³ cells) → O(1) neighbor queries
- Flat `Float32Array` buffers — zero GC pressure
- Trail diffusion runs **every other frame**
- Three.js `BufferGeometry.setDrawRange` — no re-allocation

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Reset camera |
| `Space` | Spawn 50 agents |
| `Scroll` | Zoom = scale level |
| `Drag` | Orbit camera |
| `T` | Toggle track-closest overlay |
| `A` | Toggle moving-target auto-defense + security |
| `Esc` | Close the controls studio |

---

## File Structure

```
app/crosslab
├── physics_simulator.html   # Research tool: full physics engine + renderer + security demo (single file)
├── security_defender.html   # Defense console — the ACTUAL tool:
│                            #   node cloud wrapped to a globe · tap-inspect services (same tracking as the
│                            #   research tool) · streamdeck ops deck (auto-defense, guards, firewall, quarantine,
│                            #   ring, release, deploy, strategies) · live system-status + situation boards ·
│                            #   agent feed that shows REAL probes only — attackers never appear unless a
│                            #   verified mesh-guardian agent reports them · separated system-testing suite
├── secsim-core.mjs          # AUTO-GENERATED shared engine (CFG + SpatialMap + Sim) imported by the
│                            #   console page and every node tool; rebuilt from physics_simulator.html
├── preview.html             # 3-panel preset gallery
└── README.md                # This file
```

## Security system

The research tool's "security" preset pits **defenders** against **attackers** with a
moving-target auto-defense controller (sweep / perimeter / rash / pursuit strategies).
The same engine is packaged as `secsim-core.mjs` and driven from two places:

- **Research tool** (`physics_simulator.html`) — inline, toggled by CFG `security` +
  `autoDefense`. Attackers seek and stress nodes; compromised nodes are healed by the
  firewall; DDoS bursts arrive on a cadence.
- **Defense console** (`security_defender.html`) — the **operational** surface. It
  boots **harmonic** (no fabricated attackers): 180 service nodes are wrapped to a
  globe and 6 defenders orbit them, while the streamdeck deck arms auto-defense.
  Tap any node to open its service inspector (name, mesh address `10.42.x.x/16`,
  port, load, stress, guards near, links). Red markers and vectors appear **only
  when a verified `mesh-guardian` agent reports live probes** on `/status` — the
  console shows `accepted / blocked / recent` and places the source at its target's
  position; quarantining and neutralizing work against those real events too.

### Real device test suite

The console is honest: attackers never come from the page's imagination. To see an
attack arrive on a real network, run the accompanying node tools on your own devices:

```bash
# Device B — runs the system (defended target), then open the console with the agent URL
node ../../node-tests/mesh-guardian.mjs --listen 7171 --status 7172

# Device A — attacker, does NOT run the system
node ../../node-tests/mesh-tester.mjs --target <B-IP> --port 7171 --vectors syn-slew,snaplag,udp-amp --rate 40 --count 400

# Device B again — the "system OFF" leg for comparison
node ../../node-tests/mesh-control.mjs --listen 7173
node ../../node-tests/mesh-tester.mjs --target <B-IP> --port 7173 --vectors syn-slew,snaplag,udp-amp --rate 40 --count 400 --baseline
```

`mesh-guardian.mjs` rate-limits per source (→ `syn-slew` blocked), caps live
connections (→ `slew-overload`), evicts idle keep-alives (→ `conn-linger`) and
echoes clean keep-alives (`snaplag` accepted); every event is tallied and exposed
as CORS-open JSON at `/status`. It makes no kernel/firewall claims — the block/accept
distinction is the *userspace* differential you own. Everything stays on your LAN;
testers refuse non-private targets unless `--force`. For a one-device proof:

```bash
node ../../node-tests/mesh-selfcheck.mjs   # A/B guardian vs baseline on 127.0.0.1 → SELFCHECK-A-B-PASS
```

### In-console self-test (`/run-self-test`)

The console's **`▶ run self-test`** button executes the A/B live on this device —
no CLI or second box needed (requires serving the page from `node app/serve.js`):
it spawns its own guardian (`:17172/status`) and baseline (`:17174/status`),
POSTs `/run-self-test?count=N&rate=R&vectors=…` (409 while another test runs),
feeds preset vectors from the modal (`count/vectors/rate`), shows live probing
status, and renders a **result infocard** with `.wcard` download + copy. It is the
same honest differential as the CLI suite, wrapping the loopback in the console.

### Console theming
Themes live behind the theme/palette button and persist in `localStorage`
(`aarkanum.*`): apply built-in presets (default **aurora**), preview each in a
**themed miniature of the console UI**, **Build Own** with a custom editor
(Enter saves), ranked most-used list, and auto re-apply of the last-used theme
on load. No server involvement — pure page state.

### Console keyboard shortcuts
`a` auto-defense on/off · `g` +2 guards · `f` firewall step · `r` rotate strategy ·
`e` entangle fabric · `k` rotate keys · `m` mesh/conference key · `v` eve watch ·
`b` bench-rounds field · `p` preview refresh · `t` self-test suite · `?` manual ·
`Esc` close. The `⟲ preview` button rebuilds the 3D view without reseeding and
re-syncs the fabric overlay from the peers. Saved strategy presets persist under
`aarkanum.strategies`.

### peer-supervisor row
When `node node-tests/peer-supervisor.mjs` is running, the fabric panel's control
row arms: `⏱` (health refresh) · `⚡` (probe) · `⏻` (restart) · `⟳` (rotate) ·
`🔁` (re-seed). The supervisor health-checks each peer's `/e91` every 3 s and
auto-restarts a dead peer after two strikes. Its default peer-mesh runs the census
family (peer `i` → status `20003+3i`); the adb-forwarded layout uses the extended
convention `22001+3i / 22002+3i / 22003+3i`.

### Measured results — comparable to existing products

Every percentage below was measured live on this device with
`node-tests/bench-vectors.mjs` (300 probes × 5 vectors × 3 reps, sender at 30/s,
linger hold 6.5 s). No fabricated figures — re-measure any time:

```bash
node ../../node-tests/bench-vectors.mjs --count 300 --rate 30 --reps 3 --out bench-vectors.json
```

| Vector | System ON repel | System OFF repel | Δ | System ON spread (min–max) |
|--------|-----------------|------------------|----|----------------------------|
| syn-slew (TCP flood) | 42.11% | 0.00% | **+42.11** | 41.00 – 43.33% |
| linger (idle hold) | 100.00% | 0.00% | **+100.00** | 100.00% |
| snaplag (echo / latency) | 8.33% | 0.00% | **+8.33** | 7.00 – 9.67% |
| udp-amp (UDP flood) | 50.11% | 0.00% | **+50.11** | 50.00 – 50.33% |
| **Overall TCP+UDP** | **50.10%** | **0.00%** | **+50.1 pp** | 49.5 – 50.2% |

**Latency tax:** snaplag echo round-trip measured the same with the system on as with
it off (4 ms vs 4 ms) — the admission checks add no visible latency at LAN scale.

**Plain-English, product-style mapping** — think of the system as a bouncer at the
front door, and "system OFF" (mesh-control) as the same building with the door left
open (a stock server with no firewall — everything gets in):

- **syn-slew 42%** — a per-source pace rule: try to rush the door faster than the
  allowed rate and the excess is turned away. Same mechanism as a **WAF rate limit /
  `limit_req`** (Apache/Nginx) or **Cloudflare per-IP throttling**.
- **linger 100% vs 0%** — "no standing in the lobby doing nothing": idle connections
  are escorted out after the 6 s eviction window, where a stock server holds them
  forever. Same idea as **firewall / load-balancer idle timeouts** (pfSense,
  HAProxy `timeout client`, F5-style session reaping).
- **udp-amp 50%** — UDP datagrams are treated like noise: past the allow rate the
  system stops accepting more, where a stock echo accepts 100%. Same idea as
  **DDoS UDP clamp / L3-L4 mitigation** (Cloudflare, Arbor), DNS-amp defenses.
- **snaplag ~8% + equal latency** — the occasional over-speed rush gets rejected,
  but legitimate traffic is slowed by ~0 ms. This is the "does the security product
  slow my users down?" number.

So: introduce the system and it behaves like a small **next-generation firewall /
rate-limiting edge** (pfSense + Suricata class, or Cloudflare rate rules) — rejecting
roughly half of the attack traffic it's fed while adding ~0 ms of visible latency.

**Where cryptography fits (SHA-256, TLS, the engine's quantum-crypto mode).** Those
are the *data layer* — the tamper-proof envelopes and key exchange that protect the
contents of each conversation (the physics engine even simulates a quantum-keys class
of it). This benchmark is the *admission layer* — who gets in the front door at all.
They do not compete and neither changes the other: encrypted traffic still has to pass
admission first, and changing SHA-256 for another hash would move none of the numbers
above. The table above is about the door; crypto is about the safe inside.

The console and the node tools import `secsim-core.mjs`, so every surface runs the
byte-identical `Sim`:

```bash
# regenerate the shared module from the research tool (keeps them in sync)
node ../../node-tests/sync-seccore.mjs

# CLI playbook runner against the exact same engine
node ../../node-tests/defense-tool.mjs run --threat 0.6 --plan "q@50:n3,d@60:0,1,0"
node ../../node-tests/defense-tool.mjs soak --threat 0.8 --seeds 7,8,9
```

### Defense primitives (in `Sim`)
| Method | Effect |
|--------|--------|
| `attackerSource(a)` | Sanitized telemetry for an attacker: id, hash, ip:port, protocol, hops/TTL, risk, live target node |
| `quarantineNode(i)` / `releaseNode(i)` | Electrically isolate / re-link a node; attacks are deferred away from it and defenders guard it |
| `deployDefender(x,y,z)` | Air-drop an extra manual defender that prioritizes quarantined nodes |

No build step, no dependencies beyond Three.js CDN.

---

### Entanglement fabric (E91) — the quantum-key cluster

An E91 (Ekert) protocol **simulator** that runs as a cluster across your actual phones.
Real photon entanglement cannot travel over a wire, so — same honest-approximation
contract as the physics engine — the quantum channel is *emulated*: the classical
outcome distribution is sampled from the singlet joint distribution once both
measurement settings are fixed; the only injection that breaks the Bell
correlations is an eavesdropper's disturbance; Bell-CHSH decides the verdict.
Each node generates/measures its own share and holds half the state. Complete-graph
mesh: **N peers → n(n−1)/2 links** — nothing is fixed at "four"; add a node and the
mesh re-wires itself.

```
# peers on your LAN (Termux, no adb needed) — run the peer once on EACH phone:
node node-tests/entangle-peer.mjs --name node-0 --entangle 7200 --control 7300 --status 7301

# then from any control node coordinate every link concurrently (async full mesh):
node node-tests/qkd-cluster.mjs \
  --peers node-0=192.168.1.10:7200;node-1=192.168.1.11:7200;node-2=192.168.1.12:7200;node-3=192.168.1.13:7200 \
  --rounds 6000 --out qkd-run.json
  # control defaults to entangle + 1000; override with name=host:ent:ctl if needed

# …or from a host with adb: spawn + forward + tear down every attached phone:
node node-tests/qkd-cluster.mjs --adb all

# prove it scales — 8 spawn peers, 28 links, one conference key:
node node-tests/qkd-cluster.mjs --self --nodes 8 --rounds 4000

# one device, for the gate/bench:
node node-tests/qkd-selfcheck.mjs            # → --self 4-node · honest S̄≈2.83 (KEY) · eve S̄<2 (ABORT) · conference
```

Measured (6000 rounds per link, `--self`): honest links hold Bell-CHSH
**S ≈ 2·√2 ≈ 2.83**; `--eve node-2` collapses the links touching that node to
**S ≈ 0.6 < 2 → ABORT**; a **conference key** derives from the honest link keys only.

The Security Console's streamdeck adds an **Entanglement fabric** row —
`⟠ Entangle` · `⇆ Rotate Keys` · `⚑ Eve` · `⌬ Mesh Key` — fed by the peers'
`/e91` endpoints (set them in the test suite's **mesh** field; defaults to the
host supervisor's census-family status ports `127.0.0.1:20003 / 20006 / 20009 /
20012 / 20015` — peer `i` = `20003 + 3i`). On the world each reachable peer
orbits as a mini-sphere (with its own defense-grid shell, pulse/animate, and
tap-inspect: `showPeerInfo`) joined by constellation links — **green** honest KEY,
**red** Eve ABORT — so a deployment reads as a map of every sphere working
together. A live per-link telemetry readout under the deck shows the receipt per
link — `KEY/ABORT · Bell-CHSH S · initiator/responder · rounds · key bits · full
key` — plus a summary (`peers · links · honest · aborts · S̄ · Σ bits ·
conference`). A **bench** control — `⟳ bench N` — POSTs `/bench?n=N` to each
peer's status port; every peer re-runs the links it initiates at your length
(bits ≈ **n/9** per link; the shared secret is the SHA-256 of the corrected
bits). The center **control·hub** sphere opens the cluster/system card
(`showHubInfo`: fabric aggregate, rounds, armed/eve state, device cores), and the
top bar has a fullscreen toggle. This is the *data layer* (who can
read the safe), the measured-results table above is the *admission layer* (who gets
in the front door) — planned siblings, not competitors.

---

## License

MIT — use freely for research, education, art, or game prototyping.