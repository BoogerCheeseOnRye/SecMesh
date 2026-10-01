# Finite-Key Security — Whitepaper

`finite-key-e91.tex` — arXiv-style preprint: *Finite-Key Security for a
Discrete-Variable E91 Entanglement Fabric: Replacing the Asymptotic CHSH
Threshold with a Certified Stopping Rule*.

## Compile
```bash
pdflatex finite-key-e91.tex   # twice (refs)
```

## Reproduce Table 2 (main results)
```bash
node table.mjs
```
`table.mjs` drives the shipped gate in `../../node-tests/entangle-qkd.mjs` and
prints, per attacker class and block size: sample `S`, its Hoeffding lower bound
`S_LB`, per-round DI min-entropy `H_min(S_LB)`, `QBER%`, the analytic certified
bits, and the bootstrap-oracle bits.

## Companion implementation (shipped)
- `../../node-tests/entangle-qkd.mjs` — `minEntropyFromChsh`,
  `chshLowerConfidence`, `keyQBER`, `finiteKeyBits`, `numericalOracle`,
  `linkCert`, and the mesh `gate()`.
- `../../node-tests/qkd-selfcheck.mjs` — gate self-test (honest KEY, classical /
  aligned / parked Eve all ABORT). Part of `../../selfcheck.mjs` (20/20 green).
