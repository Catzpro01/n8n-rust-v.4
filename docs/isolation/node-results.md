# Node LEGO — Results Ledger (TAHAP-1 mirror, pending allocated TASK_ID)

**Status**: SUCCESS (all waves green, byte-stable)
**Worker**: agent-2
**Peran Sesaat**: Node Model & Parameter Engineer (spec-owner / auditor; `crates/**` forbidden)
**Protocol note (STANDING-WORKER-PROTOCOL.md, merged b809399b):** `results/<TASK_ID>.md`
lives outside agent-2's declared `allowed_paths`, so this ledger mirrors the TAHAP-1
structure inside the permitted `docs/isolation/node*` boundary until the mediator allocates
the Phase-3 node TASK_ID (see outbox MSG-16).

## Deliverables (accumulated, all VERIFIED-BY-EXECUTION against n8n@2.9.4 dist)

| # | Deliverable | Evidence (machine) |
|---|---|---|
| 1 | `node-fixtures.build.cjs` generator + `node-fixtures.json` **124 entries** (117 golden + 7 serde) | `node docs/isolation/node-fixtures.build.cjs --check` → byte-identical re-derivation, exit 0; 30+ hard tripwire asserts (exit 3 on drift) |
| 2 | `node-golden-cases.md` GC-1..GC-7 + WG-1..WG-15 | every expectation executed against pinned reference dist (not hand-computed) |
| 3 | `node-conformance-harness.md` | crate-side acceptance spec: 21 case-categories, case-count constants, port shapes, 12 pinned reference semantics |
| 4 | `node-rust-brief.md` fidelity gaps G-1..G-5 | audit of `crates/n8n-node-model` stub (65 LoC, 0/6 frozen ports — re-confirmed this cycle) |
| 5 | `node-phase3-verification.md` (independent 37/37) | `tools/rust-offline-rig run.sh test` full workspace green on main@e6c0188a, replicated in this sandbox (Rust 1.88.0, offline vendor set extended +10 crates) |
| 6 | ISSUE-011 closure compliance | `git diff origin/main HEAD -- reference/` = EMPTY; barrel canonical at `docs/isolation/node-barrel.ts`; dist evicted from pinned tree |

## Waves this ledger covers

| Wave | Categories | Cases | Key pinned semantics |
|---|---|---|---|
| GC-1..GC-7 | frozen ports | 19 | continueErrorOutput copy→rename→append; no-fallback getNodeType |
| WG-1..9 | pure helpers | 38 | `isINodePropertyOptions` name+value guard; space-banned dot-notation |
| WG-10..13 | issues + filters | 24 | two-tier filter behavior; issue early-exits, byte-exact messages |
| WG-14 | operator matrix | 26+1t | regex CI-exemption; `rightType ?? operator.type`; pre-switch exists |
| WG-15 | nested parameters | 9 | collection vs fixedCollection default-fill asymmetry |
| WG-16..19 | RLC + resourceMapper | 18 | number-accepting RLC guard; expression exemption; `__rl:true` planted default; empty-array issue key |
| serde | conformance probes | 7 | G-1..G-4 shapes for the Rust port |

## Proof of currency (this cycle)

```text
$ node docs/isolation/node-fixtures.build.cjs --check
node-fixtures.json is up to date (byte-identical re-derivation)
golden: 135 | serde: 7 | TOTAL: 142        (fixtures.json 77,499 bytes)
$ wc -l crates/n8n-node-model/src/lib.rs
65  → stub unchanged (0/6 frozen ports implemented; owner assignment pending)
```
