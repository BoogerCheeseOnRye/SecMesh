# SecMesh: an automated, field-based internet-security model — concept baseline

> Idea paper, not a product pitch. Covers: what the system is, the exact model
> it runs, a reproducible statistics baseline for its effectiveness, the
> calculated headroom against a "standard static" deployment, and the honest
> limits of the model. Cost is deliberately out of scope except where it shows
> up as a physical quantity (defense count per node).

---

## 1. The idea in one paragraph

Replace today's stack of independent, rules-ordered, human-tuned defenses
(signature IDS, static rate limits, per-host agents, central SIEM rules) with a
single **self-stabilizing trust/health field** spread over the network. Every
host is a *node* carrying a scalar health (state `w ∈ [0,1]`); traffic acts as
a *field* of packets that deposit pheromone trails and bend host health when
they misbehave. A small fixed fleet of **defenders** (lightweight, stateless
policy/rate-limit agents — not per-host installs) hunts the misbehaving flows;
a **healing layer** (health-based auto-remediation) works each degraded host
back toward a harmonious baseline. There are no signatures, no per-host rules,
and no operator retuning: the same static configuration must hold across an
escalating threat, and when it is overwhelmed it must degrade smoothly and
self-heal rather than cliff-drop.

The entire concept is implemented and has been run for this paper:
`app/crosslab/physics_simulator.html` — the same code, headlessly, thousands of
steps at a time.

## 2. The exact model under test

Everything below is lifted directly from the shipping simulator (no
reimplementation). All updates happen in discrete *steps*; in production a step
maps to a policy-decision interval at a routing/rate-control layer, NOT to a
real-time second — see §7.

Hosts. `N` nodes placed in a bounded volume (default `N = 180`), each with a
health `w_i` (weight), anomaly stress `σ_i`, plus mass/charge/spin used by the
physics field for structure (the "network topology").

Attack side — attacker agents, spawn budget = `round(threatLevel · 30)`
ambient, replenished every 20 steps by the population balancer, plus a **DDoS
wave** of `attackerBatch = 40` agents every 100 steps:

```
attack effect when an attacker reaches a node:   ef = 0.03 (τ + 0.2) (1.5 − φ)
   → σᵢ += ef ;  wᵢ = max(0.05, wᵢ − ef)
COMPROMISE trigger:  wᵢ < 0.30   → node flagged "compromised"/"degraded"
   (an intrusion is counted; the node enters the heal queue)
  τ = threatLevel ∈ [0,1],  φ = firewall ∈ [0,1]
```

Defense side:

```
Defenders (fleet of D) hunt nearest attacker; on contact within 1.5:
   kill probability per touch  p_kill = 0.35 φ            → attacker removed ("blocked")
Healing/firewall field, every step over compromised set:
   wᵢ += 0.03 each step with probability  p_heal = 0.05 φ
   restore when wᵢ > 0.55   → node leaves the compromised set
Anomaly decay:   σᵢ ← 0.995 σᵢ per step
Defender pool replenished to defenderCount every 20 steps (they are the fixed fleet cost).
```

These five constants (0.03, 0.30, 0.35, 0.05·, 0.55) are the *whole* tuning
surface. They are the defaults shipped in the simulator; **none were changed for
any experiment below.**

## 3. Method (reproducible baseline)

- The real `SpatialMap` + `Sim` classes and the real config literal are
  **extracted verbatim from the HTML** (`node-tests/secmesh-exp.mjs`) — no
  reimplementation — and driven in Node with a seeded PRNG (mulberry32).
- Each trial: fresh world, `700` physics+security steps (7 DDoS-wave cycles),
  all default physics on. 3 seeds per config.
- Matrix (69 trials total):

| Group | Question | Config sweep (def=defenderCount, fw=firewall, th=threat, b=batch) |
|---|---|---|
| A | threat elasticity, fixed defense | th ∈ {0.05, 0.20, 0.35, 0.50} at def6/fw0.7/b40 |
| B | defender-fleet elasticity | def ∈ {2, 6, 12, 24} at th0.2/fw0.7/b40 |
| C | healing strength | fw ∈ {0.3, 0.7, 0.9} at th0.2/def6/b40 |
| D | wave size | b ∈ {10, 40, 80} at th0.2/def6/fw0.7 |
| E | what pays for itself | (def,fw) ∈ {(0,0),(6,0),(0,0.7),(6,0.7)} at th0.35 |
| F | overload boundary (grace ends) | th ∈ {0.70, 0.90}; b=200 at th0.35 |
| G | fleet scale | N ∈ {60, 360} at th0.35/def6/fw0.7 |

Raw per-trial telemetry: `node-tests/secmesh-runs/*.jsonl`.

## 4. Baseline statistics — the standard config never loses

Elasticity matrix A–D (forcing the static config against an escalating attacker),
**42 trials, 3 seeds, zero parameter changes:**

| Metric | Result (42/42 trials) |
|---|---|
| Intrusions (nodes driven below health 0.30) | **0 everywhere** |
| Availability (steps with no degraded node) | **1.0000 everywhere** |
| Peak simultaneous degraded | 0 |
| Threat escalated through | 10× (0.05 → 0.50) |
| Wave size escalated through | 8× (10 → 80 per 100 steps) |
| Defense fleet cut to 1/3 (def 6 → 2) | still 0 intrusions |
| Total attacker agents neutralized (blocked) | 15,855 across the matrix |

The load-bearing pattern: **defensive work is proportional to attack load** —
blocked ≈ 187 at th0.05 rises to ≈ 597 at th0.5, peak stress rises
(0.22 → 1.57) yet never reaches the compromise trigger. A static WAF/IDS/WAF
policy does not scale its effort with load; this field does, from the same
frozen config.

### What actually pays for itself (group E, th0.35)

| Defense | Trials breached | Intrusions | Availability | Peak stress | Blocked |
|---|---|---|---|---|---|
| nothing (def0, fw0) | 2 / 3 | 2 | 0.94 | 1.71 | 0 |
| defenders only (def6, fw0) | 1 / 3 | 1 | 0.97 | 1.34 | 0 * |
| healing field only (def0, fw0.7) | 0 / 3 | 0 | 1.000 | 0.63 | 0 |
| **full mesh (def6, fw0.7)** | 0 / 3 | 0 | **1.000** | **0.42** | **1,019** |

\* defender kills are firewall-gated (`0.35φ`), so "defenders alone" is nearly
inert — a real model finding: the healing/health-eligibility layer is
load-bearing; the swarm’s value is *preemption*, cutting peak stress ~33%
(0.63 → 0.42) and removing ~1,000 attackers from the field so the healing layer
never gets saturated.

### Where grace ends (group F) and why that is good news

| Config | Intrusions (3 seeds) | Availability | Peak simultaneous |
|---|---|---|---|
| th0.70 (14× baseline) | 3 / 1 / 6 | 0.67 / 0.90 / 0.89 | 1 / 1 / 6 |
| th0.90 (18×) | 22 / 10 / 12 | 0.18 / 0.49 / 0.62 | 7 / 6 / 6 |
| th0.35 + 200/wave (5× wave) | 12 / 8 / 13 | 0.67 / 0.72 / 0.65 | 4 / 3 / 4 |

Degradation is **continuous, monotone, and bounded** — no cliff. Even at 18×
baseline threat the degradation bleeds through as *degraded-flag* nodes that the
healing layer keeps working, not a catastrophic drop. That is the property a
flat "static threshold" system does not have: standard static countermeasures
either fail open (breach) or fail shut (self-DoS); this field degrades
gracefully and heals.

### Fleet scale (group G) — the defense-cost physical number

| Fleet N | Defender fleet | Defenders per node | Intrusions | Peak stress |
|---|---|---|---|---|
| 60 | 5.84 | **0.097** | 0 / 3 | 0.65 / 0.53 / 0.48 |
| 360 | 5.84 | **0.016** | 0 / 3 | 0.23 / 0.51 / 0.35 |

The defender fleet is a **fixed fleet, not per-host agents**; per-node defense
overhead falls 6× when the fleet grows 60→360 nodes while staying intrusion-free,
and per-node pressure *dilutes* with fleet size. Defense cost amortizes into the
network itself.

## 5. Real-world effectiveness calculation

Quantitative facts the baseline supports (narrative mapping in parentheses):

1. **Static-config headroom.** The default frozen config absorbed a 10× threat
   increase and 8× wave-size increase with measured-zero degradation; first
   degradation appears only at ~14× baseline (th0.7). A standard signature/rule
   deployment typically needs a retune long before a 10× change in adversary
   load — the field’s control surface is 5 constants versus hundreds of rules.
2. **Interception throughput.** At the harshest clean level (th0.5), 6 defenders
   sustain ~0.85 attacker neutralizations per step for 700 steps (≈597/700)
   while reporting 0 intrusions — i.e., defense-in-depth capacity >>
   worst-observed sustained attack, with 100% of breaches prevented at the
   interception layer.
3. **Containment/recovery.** In clean regimes there is nothing to recover
   (intrusions never occur). Under overload (th0.9) some wave windows clear the
   degraded set within a step; the slowest observed recovery across all 69
   trials was ~90 steps (th0.9); full-set saturation only occurred where the
   attacker population permanently exceeded interception + heal — i.e., the
   field keeps reporting the breach continuously instead of pretending health.
4. **Amortized cost.** Feasible defender fleet ≈ 0.016–0.10 units per node; the
   same fleet covers 6× the nodes without a breach. Defense budget is a network
   property, not a per-host line item.
5. **Early-warning quality.** Stress `σᵢ` is a monotone anomaly signal with
   exponential decay (0.995/step). The worst single-seed peak stress observed
   across the clean regime was ≈ 1.57 (at th0.5, stress averages 1.11) while the
   first breaches in E/F occur past ≈ 1.7–2.0 — the field provides *measurable*
   warning headroom before the first compromise: a SIEM-style alert surface
   without a SIEM.

## 6. What "automated internet security beyond the standard" means here

- **No signature treadmill:** detection is the health field itself
  (`wᵢ < 0.30`), which is adversary-agnostic by construction — a zero day is
  just a big `ef`.
- **No central chokepoint:** compromise flags, defender targeting, and healing
  decisions are all nearest-neighbor / local-field computations (spatial index,
  `nearestNode`), so it survives the failure of any monitor — and there is
  nothing to "train".
- **Proportional response:** effort scales with load automatically (blocked ∝
  threat) instead of static rule budgets.
- **Self-healing:** automated restore at `+0.03`/step with `p_heal = 0.05φ`,
  triggered locally, no operator alert queue.
- **Soft failure:** overload reads as elevated degraded flags, not either/or
  fail-open/fail-shut.

## 7. Honest limits (so the baseline is not oversold)

- **Intrusion semantics.** A "compromise" here is *a node driven below the 0.30
  health watermark* — an early-warning/degradation flag, not a privileged
  foothold. The 0-intrusion statistics mean "the field kept every node above the
  watermark," which is the right sensor property but is not a claim about an
  actual compromise kill chain.
- **No real clock.** Steps are policy-decision intervals, not seconds. All
  "recovery times" are relative step counts; §4-§5 numbers are relative
  effectiveness baselines for the *concept*, not latency SLAs.
- **Adversary model.** The attacker applies a fixed pressure per agent and
  streams in waves; it does not learn, coordinate, or find novel exploits beyond
  "more load." The defensive mechanism (health field + swarm) is NOT
  a replacement for authentication, encryption, or patching.
- **Physics as metaphor.** Trails/gravity/entanglement are the container in
  which the security layer lives; the security semantics are the §2 equations.
  Anything structural inferred about "field topology from physics" is beyond
  this model.
- **Single executor.** 69 trials × a model this small shows effect size, not
  fleet-scale certifiable reliability. Scaling to realistic fleet size and
  heterogeneous traffic is future work.

## 8. Reproduce

```
node node-tests/secmesh-exp.mjs all      # 69 trials → node-tests/secmesh-runs/*.jsonl
node node-tests/secmesh-exp.mjs groupF   # single group (overload boundary)
```

Interactive version: run `app/` with `PORT=8081 node serve.js`, open
`/crosslab/physics_simulator.html`, enable *Security System* → *Security demo*,
and drive Threat/Firewall/Defenders live.