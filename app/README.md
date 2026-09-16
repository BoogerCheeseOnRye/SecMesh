# ⬡ Atomic Printer Sim

An interactive nanoscale matter simulator: a folding 3D periodic table, a chemistry lab where you can spawn elements, weld bonds, and hammer them with electromagnetic fields, and a collection of machine presets (tokamak, stellarator, beamline, CVD, sputter) — all running in the browser with no build step.

> **Field guide & table of contents:** the full manual now lives as a styled, section-linked page in
> [`guide.html`](./guide.html) (Time scale, MRI all-axis map + clip→animation, moveable UI modules, data schema, and more). README.md stays the short reference.
>
> **Technical readme:** architecture, agent-vs-manual usage recipes and credits live in [`readme.html`](./readme.html).

## What's inside

| Page | What it does |
| --- | --- |
| `index.html` | The folding 3D periodic table — all 118 elements, orbit/zoom/pan, per-element fact cards. |
| `experiments.html` | The lab. Spawn elements, watch chemistry happen, run machines, map Chladni sand patterns. |
| `landing.html` | Labs hub — pretty links into each world. |
| `crosslab/physics_simulator.html` | The cross-lab field engine (magnetic bubbles, quantum foam, chaos) which feeds the lab's `◈ Cross-Lab` presets. |

There is nothing to build and nothing to install — `three.js` r160 is vendored in `lib/`. Just serve the folder.

```bash
node serve.js            # → http://localhost:8080
# or any static server:
python3 -m http.server 8080
```

ES modules + an import map mean you need to open it over HTTP rather than `file://`.

## Lab controls

- **▶ / ⏸** run / pause, **↻** reset the current experiment, **◎** cluster tracking toggle, **▦** experiment menu.
- **Speed stepper** (− / +) on the top bar sweeps **31 integration rates** from `0.01 fs` (10 attoseconds) per frame up to `3.2 T y` (trillions of years) per frame: `0.01 fs → 0.05 fs → 0.1 fs → ¼ fs → ½ fs → 1 fs → 100 fs → 1 ps → 10 ps → 100 ps → 1 ns → 10 ns → 100 ns → 1 µs → 10 µs → 100 µs → 1 ms → 10 ms → 100 ms → 1 s → 10 s → 100 s → 17 min → 28 h → 116 d → 32 y → 3.2 ky → 0.32 My → 32 My → 3.2 Gy → 3.2 T y`. Slow end = cinematic bond-level slo-mo; fast end = eons. Fast-forward uses a deep-macro substep so every rate actually delivers its full sim-time per frame at one real-time substep, keeping the physics rate-consistent and the HUD time truthful (units climb fs → s → min → h → d → y → My → Gy).
- **▦ menu** also carries the furnace: heat and target-temperature sliders, plus **⬇ export data**.
- The top-bar button cluster holds just two action toggles in front of the run controls: `＋` add elements (family quick-select + full 18-column table) and `⚙` instruments — one scrollable drawer holding chamber geometry (the `✱ Twist` is a (2,3) stellarator tube), sound/Chladni plate, oscilloscope, laser, machines + timed feeder, the MRI slice scanner, and cross-lab fields. A single drawer's worth of stacked sections instead of a row of floating panels keeps the viewport clear.
- **⚙ Laser / beam bank** (in the instruments drawer, under the oscilloscope): add as many beams as you like (`＋ add beam`), each aimed along any of the six directions (`±X ±Y ±Z`) with its own independent optics — type (`ray` steady heat + ionization, `pulse` ablation bursts, `trap` tweezers pulling atoms onto the line, `flood` wide soft illumination), power, spot-width, and the per-type sliders (`pulse` frequency, `grip` strength). A chip per beam shows direction + kind, tap to select and edit it. Because every beam is collimated along its own cylinder, stacking them from several angles behaves like a real lab rig: counter-propagating pairs on one axis form an optical molasses that cancels the net drift, and criss-crossed traps or multi-axis heating "look" like the machine they're meant to demo — not a global heater.
- The timed feeder lives inside the same `⚙` drawer as the machine presets — there is no separate main-UI copy. The command-centre dossier also carries **feeder options**: every deployable experiment that makes physical sense ships with two per-element feeder presets (element, atoms/shot, repeat every, inlet) plus `off` — the selected one is armed and set to auto when the experiment deploys, `off` clears all slots.
- On phones the `⚙` drawer works the same way; panels stay reachable via the ▦ menu.
- **◎ Cluster tracking** (top bar, on by default): a face-tracker-style overlay that locks onto every bonded cluster (from a 2-atom pair up to a whole molecule) with a colour-coded corner-bracket + a `Cn · formula` chip that stays glued to the atoms as they drift, merge, or split. Track ids persist via membership overlap (a cluster that breaks apart keeps its id on the majority piece, and a fresh fragment gets a new id). Hover a bracket and a data popup opens with the cluster's composition, atom/bond counts and match confidence, per-type bond distances vs their rest length, and the local temperature, like a vision/report on the reaction live.
- **MRI · Slice** (in the `⚙` drawer and the docked bottom bar): a slice-tomography scanner for the live chamber. Arm it, pick a scanning plane — **ALL** shows the X·Y·Z cross-sections side-by-side as one composite map (the default), or single X / Y / Z — a signal (`density` atom count, `therm` kinetic energy, `charge` signed gradient, `bonds` bond density), and a colourmap (cool gray or hot), then sweep the slice slider through the experiment. The virtual slice plane is shown as a glowing sheet inside the chamber, and the panel renders the corresponding 2-D scan live. `◈ snap` re-samples at higher resolution and `⬆ PNG` exports a 1024-px scan image; `⇶ axes` and `◎ orbit` export X/Y/Z and 360° contact sheets. **Clip mode** (`◌ clip`) samples up to 16 frames along the drift line — press once to record, again to save — and one save downloads the **GIF89a** (the sole auto-download) plus a filmstrip PNG, a frames manifest, and a self-contained **`-anim.html` experiment report**, a full technical document: a 2×2 grid (gray MRI clip, chamber-scan frame, 3D screenshot, hot MRI clip), captures of the other instruments (chart recorder, mass spec, manometer), the axis-sweep and orbital sheets in **gray → hot**, an **all-four-MRI-channels** gallery, a written experiment report, a results-at-a-glance table, the full run data and raw JSON. Zero dependencies, opens in any browser, `🖨 save / print`. Sampling splats each atom over a Gaussian footprint so even sparse chambers read as smooth tomography.
- **Cross-Lab single / stack**: the cross-field presets now run in two modes. `single` is the classic one-preset-at-a-time view (chips + knobs + the physicsSim live preview). `stack` instead lets you tick any combination of presets at once — the effective field is the max contribution per force across the selection (the presets share the same scalar keys, so the union is physically coherent), and removing a preset drops its forces cleanly. The readout lists the active stack.
- **⬛ run cross wall** (bottom of the Cross-Lab card): a real side-by-side A/B comparison. Each non-off cross preset gets its own tile — an independent chamber cloned from the *exact same record* of the first 44 live atoms (positions, velocities, temperature) and locked to the main speed stepper, so every preset runs the identical starting system under its own fields at the same rate. The view splits into a grid of tiles, each advancing live; tap any tile to promote that regime to the main chamber and close the wall. No more squinting at presets that never meet.

## UI modules

- Every major UI piece — the **stats bar**, the **MRI bottom bar**, the **goal card**, **minimap**, **event feed**, and the **tools sheet** — is a moveable module. Drag its `≡` grip (top-right); the **whole module moves as one group** (never one element of a modal). Edges snap to the viewport and to the edges of other visible modules (10 px). The MRI bar also moves by dragging anywhere on its header row.
- ⚙ Settings → **modules** is a toggle list for every module: hide what you don't need, show the rest, and snap the survivors edge-to-edge into a custom command deck. Positions + toggles persist per browser.
- **hud size** (60 %–180 %) scales the whole stats strip, and the top bar / drawer panels shift down to make room.
- All modules share one design language with sharp, near-square corners so they can dock flush against each other.

## The physics (honest approximations)

- Lennard-Jones pairwise forces + Coulomb for charged species, cell-hashed neighbour lists.
- A soft thermostat with a rate-scaled heating term and an operating-point taper so the furnace holds temperature across speed changes.
- Chemical bonds form/break on geometry + energy; ionic, covalent, and hydrogen colour-coded. Excited states, reactions, and radioactive decay are in.
- Machine fields: constant **B** (Lorentz, rotating about `Baxis`), constant **E** along `Edir`, and input **power** (RF-style heating). The **optical-time beam bank** lets you fire from all angles at once — each beam deposits momentum/energy only inside its own collimated spot cylinder (`ray`/`pulse` photo-ionize above 75 % power, `pulse` bursts kick hard, `trap` pulls atoms to its axis, `flood` heats a wide soft band) — all `dt`-scaled so they stay rate-consistent, and independent per beam so a pair of opposite beams truly cancels drift.
- Field readouts are split: `B · E · P · ☀` live in the machine card, while `N atoms · ⇢ fed · auto` sits on its own line — field bars change fields only, never atom counts.
- Timed feeder: per-element slots `{ element, atoms/shot, repeat every (fs), start (fs) }`, with a hard `MAX_FEED` cap.
- A resolved fine-regime solver for the chemistry band, a coarse rate-consistent fast-forward regime, and a deep-macro single-substep band that delivers every tick up to `3.2 T y/step` at full sim-time per frame.

## Data & export

- `elements.data.js` defines `window.ELEMENTS_DATA`, an audited 118-row dataset: `z, s, n, m, en, d, melt, boil, ion, grp, per, blk, cat, cfg, shells, year, era, crust, cosmic, cpk`. Generated file — do not hand-edit.
- The ▦ menu's **⬇ export data** downloads the live experiment as JSON (`aps-<exp>-<t>fs.json`):

```json
{
  "format": "atomic-printer-sim/experiment@1",
  "experiment": { "id": "salt", "name": "Salt from Nothing", "tag": "Na + Cl → NaCl", "goal": "…" },
  "run": { "t": 0, "dt": 1, "substeps": 1, "T_cur": 300, "T_target": 400, "B": 0, "E": 0, "power": 0.5, "beams": [ { "type": "ray", "axis": "y", "dir": 1, "power": 0, "spot": 0.16, "rate": 10, "grip": 0.5, "on": false } ], "laserOn": false, "laserPower": 0, "laserAxis": "y", "laserType": "ray", "laserSpot": 0.16, "laserRate": 10, "laserGrip": 0.5, "shape": "cube", "size": 2.4, "…": "…" },
  "feed": [ { "z": 11, "n": 2, "every": 50000, "start": 0, "enabled": true } ],
  "atoms": [ { "z": 17, "sym": "Cl", "q": 0, "x": 0.12, "y": 0.0, "zz": 0.03, "vx": 0, "vy": 0, "vz": 0, "fixed": false, "label": "", "temp": 300 } ],
  "bonds": [ { "a": 0, "b": 1, "type": "ionic" } ],
  "events": [ { "t": 123, "msg": "Na⇄Cl ionic bond formed", "kind": "info" } ]
}
```

`atoms` are positioned/velocity in nm and nm/step; `bonds` reference `atoms` by index; `run` carries rate, temperature, fields, the full beam bank (one entry per beam), shape, feeder totals, and the cross-lab preset.

## Built: the instrument floor

Everything below shipped in one pass and is covered by the headless suite
(`inst-probe.mjs` runs the full drawer headlessly; `selfcheck.mjs` = 20/20 green).

1. **Analytical instruments.**
   - **Mass spec (ToF)**: live `m/z` histogram from tracker-ring clusters + per-atom masses, `m/z` ↔ charge modes, peak readout. Canvas draws at 5 Hz, species counts update with the chamber.
   - **Manometer / gas phase**: pressure from the virial term, mean free path, vapor/condensed split and per-element partials from per-atom `temp` vs `melt` — the drawer's gauge readout.
   - **Chart recorder**: 6-channel stripchart (T, B, E, RF power, atoms, °K) vs sim-time with 640-sample ring buffer + `⬇ CSV log` (download + workspace copy). Logging rides the sim loop so it survives resets.
2. **Method / recipe automation.** The **recipe sequencer** drives ramp → hold → feed → pulse as a runnable/pausable method with a **PID ramp tracker** (linear T interpolation between ramp endpoints) — `ramp °K / hold / feed / pulse` chips, numbered step list with per-step edit, `▶ run / ■ pause / ✕ reset` and a live "step n/N · label" readout.
3. **Pump-probe (time-of-flight).** Per-beam **delay knob** (phase window shift) + far-mount **detector board** (`hits · eV`) with a clear button; two beams at different delay probe the same packet.
4. **Reproducibility — lab notebook.** **RNG seed string** (`set`), **snapshot import** (`⏏ import` restores atoms+bonds+beam bank+feed+run incl. per-beam `wav`/`delay`), and **sim-time annotations** (`✎ note`) pinned into the event log.
5. **Tunable spectral beams.** Per-beam **λ** slider (150–2500 nm → photon energy `1240/λ` eV); the engine already uses tuned `wav` against ionization thresholds for resonant excitation.
6. **Sample stage.** Mount a **seed crystal** (`⛰ load El`) — an ordered few-atom cluster at rest that acts as a growth template for condensates.

Remaining ideas for a future pass (no hooks added yet): bond-mode IR/Raman traces from
`√(k/μ)`, UV-Vis edges from excited states, stripchart persistence across a hard reset
beyond the in-memory ring, and a workspace-exported `manifest` per run.

## Project layout

```
index.html            folding 3D periodic table
experiments.html      the lab UI + styles
exp-app.js            lab app: viewport, UI wiring, machines, feeder, export
exp-core.mjs          physics engine: Chamber, fields, bonds, decay, Chladni
elements.data.js      audited element dataset (window.ELEMENTS_DATA)
landing.html          labs hub
crosslab/             physicsSim field presets
lib/                  vendored three.js r160
serve.js              zero-dependency static server (node)
```

## Tech

Plain ES modules, Canvas + WebGL via three.js r160, one file of CSS, no transpilers, no package manager. `exp-core.mjs` is framework-free and testable headlessly — the physics has been validated with standalone probes (rate-invariance sweeps, machine configs, URL-param boot, and headless DOM smoke suites).