# Persistence LEGO — Phase 3, POOL-004 (pure core reconstruction)

**Agent:** agent-12 · **Branch:** `arena/01a0af71-n8n-rust-v-4` · **Task:** `tasks/POOL-004-persistence-pure-core.yaml`
**Reference:** n8n 2.9.4 (`reference/n8n` @ `b6dc2787`) · **Prior status:** Phase-2 VERIFIED (docs/contract, agent-4)
**This increment:** Phase-3 IMPLEMENTED — pure, DB-free core, self-verified `57/57` machine assertions.

---

## 1. Why this slice

The dynamic task pool bus (Supabase) is unreachable from this sandbox (HTTP 000);
the git-bus record shows LEGO lanes workflow/node/connection/expression/engine/validation
all actively owned by peers. Persistence is the highest-value unclaimed Phase-3 lane
(LEGO-MASTER-MAP §2: ISOLATED, no reconstruction yet). Per the standing worker protocol
I took it as POOL-004, split deliberately at the DB boundary:

- **IN (this task):** every persistence behavior observable and verifiable WITHOUT a
  database driver — deterministically machine-checkable in a sandbox.
- **OUT (next tasks, contract §12.2):** TypeORM metadata/repositories/SQL paths,
  `DbConnection`, migrations, fs-store, pruning/stop query paths — these need a
  live-DB harness and must not be half-ported blind.

## 2. What was ported (10 units, 1:1)

See `contracts/persistence.contract.md` §12.1 (written CONTRACT FIRST in this task, then
the code). Full-file ports where the reference file is self-contained; precise line-ranged
ports for `execution.repository.ts` L149/L191-226/L230-247/L269-344/L350-362/L388-406/
L1125-1140 and `execution-persistence.ts#create`.

Deviations — all boundary-only, behavior-preserving:
- **D-PERSIST-01/03/05** — `Container.get(GlobalConfig)` reads go through port
  `P-PERSIST-CONFIG` (reference defaults: `sqlite`, `all/all/true/true`).
- **D-PERSIST-02** — `jsonParse` + `migrateRunExecutionData` consumed read-only from
  pinned `n8n-workflow@2.9.1` via `src/consumed.mjs` (declare-only consumption, per
  contract-first; registers as a consumer of the Execution Data LEGO owned by agent-3).
- **D-PERSIST-04** — `ErrorReporter`/`Logger` edge calls through port `P-PERSIST-REPORTER`.
- **flatted@3.2.7 / nanoid@3.3.8** — the REAL pinned packages, not ports: the wire format
  is contractual (§11 byte compatibility) and the RNG wiring is canonical.

## 3. Machine evidence

- `npm test --prefix packages/persistence-lego` → **57/57 PASS, 0 fail** (7 suites).
  Includes A/B against the pinned dist: flatted round-trips, `migrateRunExecutionData`
  v1-identity + v0→v1 lift on `startData.destinationNode/originalDestinationNode`
  (2.9.x FLAT root shape — verified against `run-execution-data*.d.ts`), jsonParse
  throw/fallback behavior.
- SQL parity: `buildWorkflowsByNodesQuery` whereClause sha256-pinned
  (postgresdb `54776ba9…`, sqlite-2type `8c045d70…`) + source-region byte cross-check.
- Source pins: sha256 of 13 ported reference files in `manifest/source-pins.json`.
- Reference tree untouched (`git status reference/` clean); `crates/` + `apps/` untouched;
  `editor-ui`/UI untouched.

## 4. Evidence corrections recorded (behavior != assumption)

1. **`toSaveSettings` `'DEFAULT'` asymmetry** — explicit per-workflow `'DEFAULT'` returns
   the RAW config value (`'all'`/`'none'`), not a boolean; only absent keys collapse via
   `==='all'`. Pinned in test 07; contract §12.1/§12.4 corrected.
2. **flatted JSON-primitive roots throw** on the unflatten path (`'null'` / `'0'` → raw
   TypeError out of `flatted.parse`); the reference falsy-guard after `parse` is defensive
   and unreachable with flatted@3.2.7. Pinned in test 06.
3. **`shapeSingleExecution` `includeData:false` keeps raw `annotation` + `metadata`**
   (only `executionData` is stripped); serialized annotation only overwrites when
   `includeAnnotation && serializedAnnotation` is truthy. Pinned in test 06.
4. **IRunExecutionData is FLAT in 2.9.x** (root `startData/resultData/executionData`);
   the v0→v1 lift converts `startData.destinationNode/originalDestinationNode` and creates
   own-`undefined` keys when absent; untouched nested refs are shared (no deep copy).

## 5. Regression surface

Additive-only change set: new `packages/persistence-lego/**`, contract addendum,
pool manifest/result/docs, my bus outbox, plus ONE additive pin in
`scripts/setup-reference-runtime.sh` (`flatted@3.2.7` — a real n8n@2.9.4 dependency via
`@n8n/db`, pnpm catalog). Root gate re-run after this task: see
`results/POOL-004-persistence-pure-core.md`.

## 6. Follow-ups (not started, free for pool)

- POOL-005 candidates: `@n8n/db` entity schema→metadata parity (needs a decorator-free
  metadata extractor or a driver harness); `ExecutionPersistence` fs-store read/write
  golden against the real `FsStore`; pruning/stop query-path shaping; static-data +
  settings repositories; `to-save-settings` consumption by lifecycle hooks wiring.
