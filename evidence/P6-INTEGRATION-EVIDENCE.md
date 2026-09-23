# P6 Milestone — Integration Evidence Ledger (P6.1–P6.31)

- **Milestone:** P6 COMPLETE · **Reconciled by:** Global Integration Commander (Agent 1) · **Final main:** `40dc5b00b7132580317831bc1254a36d792ec381` (P6.31 (merge))
- **Why this ledger:** P6 landed via PRs whose bodies carried evidence for some slices (9/18 open-stack, 4/13 early merges) but the lane never wrote per-slice evidence files. This document records **measured, reproducible integration facts** — not retroactive narrative.
- **Method:** each suite executed standalone via `node --test <file>` on final protected main; counts below are the runner's own `# tests/# pass/# fail` lines; full backend run = **1664 tests / 1661 pass / 3 fail (PRE_EXISTING REST 404 trio)**; governance gates **7/7**; cargo workspace **288 pass / 0 fail**; frontend **419/418/0 fail/1 skip**.

## Per-slice merge map (stack integrated bottom-up)

| Slice | PR | main merge SHA |
| :--- | :--- | :--- |
| P6.1 | #124 | `pre-reconciliation (see git log)` |
| P6.2 | #138 | `0d2bf016457a71b3f6a9614707e664ebc0b33663` |
| P6.3 | #139 | `89cc56df94cc443807a67b1144960d5fb6093401` |
| P6.4 | #140 | `2b07ef347eed4f464cbf285bfa372f827cab8223` |
| P6.5 | #142 | `fe53e93360038e92694f617a79b8ed4f88a0b77a` |
| P6.6 | #143 | `42ceebf3762e0e8ed94e068a8884976f4479248b` |
| P6.7 | #144 | `e2b00eeb2f4364365d777760c5c87795272fd971` |
| P6.8 | #146 | `3228d1809cb299362cd5475809078a633ff8b63f` |
| P6.9 | #148 | `e5203c2fccd9d45e6e375aa28762c9291194746d` |
| P6.10 | #149 | `2607ef08b973d01de8bd0ea5f64517ede73f6945` |
| P6.11 | #150 | `a8522f5cb43cec8b4a7ec7a045e64cc73d2c86d5` |
| P6.12 | #151 | `8d210dc5cb64913e22e9c36f232dbbbebd28b74a` |
| P6.13 | #152 | `24032a0ccdb388c4e81b87f3e8c11220fb681feb` |
| P6.14 | #153 | `ee387a582394303ea194b2509013cf8f25013224` |
| P6.15 | #154 | `7a52b8835c09b44b658f32fd2d85b9ba3571e419` |
| P6.16 | #155 | `70cdea80998b452b6a47a4a0d07498665c793093` |
| P6.17 | #157 | `7a2e7f09ec7734ca6ef08554aef85938b26e4668` |
| P6.18 | #159 | `7bafa638c8037dcd6515f09b0b0ed1c4eb05899d` |
| P6.19 | #160 | `9528a5dbfe8135ba04dc329084c2c12d64e2da2b` |
| P6.20 | #162 | `40013e485f27f11ab2cfe65bfd1b2a8c193e0189` |
| P6.21 | #163 | `86b8072cccc4e94f44d1c1a38c6d75647367de6c` |
| P6.22 | #165 | `720345baaa150fb824c6d5a94de287c28b5b2baf` |
| P6.23 | #167 | `6d901676346d14d8858f8c15812973ff5875a330` |
| P6.24 | #168 | `3d7b52ee6190e5a383f11487c58871c0c8a52337` |
| P6.25 | #169 | `9a3b2cb200ac44be6800b28a883c3404f462b8de` |
| P6.26 | #170 | `9f8813668b6593ce35278e2569ddd76980e59373` |
| P6.27 | #171 | `5bb9cdb21e5af622a5a9f41ceff5269a4d7c55d0` |
| P6.28 | #172 | `0db0736224ff3149079e36c167aeaee3c50b2c02` |
| P6.29 | #173 | `b6ca241379d350a2d475f14a33009c3a089b4857` |
| P6.30 | #174 | `7c7aa028b978305582c4c8821c9794a500241bd5` |
| P6.31 | #175 | `40dc5b00b7132580317831bc1254a36d792ec381` |

## Measured suite evidence (final main, standalone runs)

| Suite | tests | pass | fail |
| :--- | --: | --: | --: |
| `lego-admission-explain.test.mjs` | 14 | 14 | 0 |
| `lego-canary-rollout.test.mjs` | 18 | 18 | 0 |
| `lego-cancel-accounting.test.mjs` | 12 | 12 | 0 |
| `lego-capability-compiler.test.mjs` | 34 | 34 | 0 |
| `lego-capability-contract.test.mjs` | 33 | 33 | 0 |
| `lego-dependency-closure.test.mjs` | 36 | 36 | 0 |
| `lego-freshness.test.mjs` | 13 | 13 | 0 |
| `lego-incremental-registry.test.mjs` | 16 | 16 | 0 |
| `lego-io-compiler.test.mjs` | 13 | 13 | 0 |
| `lego-jit-lease.test.mjs` | 13 | 13 | 0 |
| `lego-lifecycle.test.mjs` | 28 | 28 | 0 |
| `lego-namespace-confusion.test.mjs` | 12 | 12 | 0 |
| `lego-native-abi.test.mjs` | 9 | 9 | 0 |
| `lego-node-acceptance.test.mjs` | 14 | 14 | 0 |
| `lego-node-health.test.mjs` | 19 | 19 | 0 |
| `lego-node-lifecycle.test.mjs` | 24 | 24 | 0 |
| `lego-node-portability.test.mjs` | 45 | 45 | 0 |
| `lego-node-registry.test.mjs` | 25 | 25 | 0 |
| `lego-node-residency.test.mjs` | 27 | 27 | 0 |
| `lego-package-transaction.test.mjs` | 38 | 38 | 0 |
| `lego-provenance-log.test.mjs` | 12 | 12 | 0 |
| `lego-registry-acceptance.test.mjs` | 10 | 10 | 0 |
| `lego-registry-compiler.test.mjs` | 46 | 46 | 0 |
| `lego-registry-integrity.test.mjs` | 18 | 18 | 0 |
| `lego-registry-repair.test.mjs` | 10 | 10 | 0 |
| `lego-revocation-bulletin.test.mjs` | 17 | 17 | 0 |
| `lego-runtime-lease.test.mjs` | 23 | 23 | 0 |
| `lego-runtime-pool.test.mjs` | 13 | 13 | 0 |
| `lego-sbom-policy.test.mjs` | 11 | 11 | 0 |
| `lego-supply-chain.test.mjs` | 24 | 24 | 0 |
| `lego-wasm-cache.test.mjs` | 13 | 13 | 0 |
| `lego-worker-convergence.test.mjs` | 18 | 18 | 0 |
| **TOTAL** | **658** | **658** | **0** |

## Contract & register reconciliation
- `contract-lock.json`: **75 rows**, zero duplicate ids, all semver+owner present; P9/observability rows preserved: `observability.envelope`, `observability.structured-log`, `observability.metrics`, `observability.trace` (never removed/downgraded).
- Count pins: `contracts.length, 75` ×7 test files — verified green.
- Domains manifest: **26 domains**, owners across 7 agents, zero nested-LEGO violations.
- `.ai`: fresh via `lego:ai:check` (source→regen→check workflow; never hand-edited).
- Errors contract: v1.2.0, **36 codes**, 11 families (auth/compat/credential/execution/lego/node/storage/unsupported/webhook/workflow/workspace), zero near-duplicate names.
- Architecture lanes verified: P3=workflow/execution · P4=ingress/trigger (single cron engine in `crates/n8n-common/schedule.rs`; no second scheduler in apps) · P6=node registry/runtime (no execution-engine imports; `node-acceptance` filename inventory is read-only acceptance) · P9=observability (no business-logic imports).
- Stale PRs #153–#175 closed WITH per-PR integration comments citing merge SHAs (nothing dangling).

