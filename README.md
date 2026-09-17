# n8n-rust-v.4

High-Performance Rust Port of n8n with Arena AI Virtual SSH Engine.

The port never rewrites n8n from guesswork: n8n 2.9.4 is the behavioral
reference, every component is isolated behind an explicit contract, and only then
is a Rust replacement attempted.

## Project status

| stage | state |
| :--- | :--- |
| ANATOMY (`docs/anatomy/`) | ✅ |
| CONTRACT (`contracts/`) | ✅ 12/12 contracts |
| REFERENCE SOURCE (`reference/n8n/`, n8n 2.9.4) | ✅ 15050 files pinned |
| REFERENCE RUNTIME (baseline 11/11 smoke test) | ✅ |
| **WORKFLOW ISOLATION (LEGO 01)** | **✅ VERIFIED 10/10 — see [`docs/isolation/workflow.md`](docs/isolation/workflow.md)** |
| **NODE MODEL (LEGO 02)** | **✅ IMPLEMENTED — `packages/node-lego/` (58 exports)** |
| **CONNECTION (LEGO 03)** | **✅ IMPLEMENTED — `packages/connection-lego/` (pure, 0 coupling)** |
| **VALIDATION (LEGO 04)** | **✅ IMPLEMENTED — `packages/validation-lego/` + new capability** |
| **EXPRESSION (LEGO)** | **✅ IMPLEMENTED — `packages/expression-lego/` ({{ }} evaluator)** |
| **EXECUTION DATA (LEGO)** | **✅ IMPLEMENTED — `packages/execution-data-lego/` (pairedItem, binary)** |
| **EXECUTION ENGINE (LEGO)** | **✅ IMPLEMENTED — `packages/execution-engine-lego/` (2655 LOC reconstructed)** |
| **PERSISTENCE, TRIGGER, WEBHOOK, SCHEDULER, CREDENTIALS, API, SETTINGS, BINARY** | **✅ IMPLEMENTED — `packages/*-lego/`** |
| **RECONSTRUCTED ENGINE (Full Stack)** | **✅ VERIFIED — `packages/reconstructed-engine/` (14 LEGOs integrated, 6 languages ID/EN/JV/AR/ZH/RU)** |
| RUST IMPLEMENTATION | ⏸ NOT STARTED (crates contain genesis Rust, zero new Rust per PROJECT_RULES) |
| **ERROR RECOVERY (LEGO)** | **✅ TESTED 32/32 — retry, onError/continueOnFail routing, `$getPairedItem` provenance — see [`contracts/error-recovery.contract.md`](contracts/error-recovery.contract.md)** |

“Isolated” means the TypeScript component now has an enforced boundary and a
contract. “Implemented” means the LEGO has been reconstructed 1:1 in pure JS/TS from n8n 2.9.4 source with clear boundary and formal contract. It does **not** mean it was replaced by Rust — ZERO RUST per PROJECT_RULES.md, frontend 100% original untouched.

## Structure

- `reference/n8n/` : pristine upstream n8n 2.9.4 source (read-only, hash-pinned, 15050 files)
- `docs/anatomy/` : system anatomy (18 documents)
- `contracts/` : formal LEGO contracts (13/13: workflow, node, connection, validation, execution-data, expression, trigger, webhook, scheduler, persistence, credentials, api, error-recovery)
- `docs/isolation/` : Phase 2 isolation records, dependency map, port contract, verification report, reconstructed-engine blueprint
- `packages/workflow-lego/` : the isolated Workflow Model LEGO (boundary, ports, tests, manifests) — 10/10 gates PASS
- `packages/node-lego/` : Node Model LEGO (node-helpers, versioned-node-type, node-parameters/**) — 58 runtime exports
- `packages/connection-lego/` : Connection LEGO (common/**, graph-utils, connections-diff) — pure, 0 coupling
- `packages/validation-lego/` : Validation LEGO (type-validation, schemas, type-guards + new capability validateWorkflow)
- `packages/expression-lego/` : Expression LEGO (Expression, WorkflowDataProxy, sandbox, extensions)
- `packages/execution-data-lego/` : Execution Data LEGO (run-execution-data/**, factories, pairedItem, binary)
- `packages/execution-engine-lego/` : Execution Engine LEGO (WorkflowExecute 2655 LOC reconstructed, DAG loop)
- `packages/persistence-lego/` : Persistence LEGO (ExecutionRepository, migration, pruning)
- `packages/trigger-lego/`, `webhook-lego/`, `scheduler-lego/`, `credentials-lego/`, `api-lego/`, `settings-lego/`, `binary-data-lego/` : Extended LEGOs (8 secondary)
- `packages/reconstructed-engine/` : Full-stack reconstructed engine integrating all 14 LEGOs, modular src/, 6-language i18n (ID, EN, JV, AR, ZH, RU), zero Rust, frontend untouched — VERIFIED
- `packages/reconstructed-engine/src/error-recovery-policy.ts` : isolated Error Recovery LEGO (retry policy, `onError` routing, error-item split, `$getPairedItem` provenance) — consumed by `runner.mjs` and the TS execution engine
- `tools/` : boundary mapper, kernel/port/reference gates, isolation extractor, model digest, gate runner, live engine harness
- `tests/reference/` : golden workflows + baseline smoke test evidence (connection, execution-data, expression, workflow-rust)
- `tasks/`, `results/` : inbound task manifests and execution results
- `crates/`, `apps/n8n-rust/` : (reserved) Rust implementation — genesis Rust from initial commit, zero new Rust per PROJECT_RULES.md

## Verify a LEGO

```bash
scripts/setup-reference-runtime.sh        # n8n-workflow/core/nodes-base 2.9.1 == the n8n 2.9.4 dependency set
npm install --prefix packages/workflow-lego
npm run verify                            # 11 gates; writes docs/isolation/evidence/*

npm run verify:fast                       # same, without the live engine checks (10/10)
npm run isolation:check                   # boundary + kernel + port + reference-integrity only

# Reconstructed engine (full stack, 14 LEGOs)
node packages/reconstructed-engine/test-run.mjs          # legacy runner, 3 nodes linear
node packages/reconstructed-engine/test-enhanced.mjs     # full LEGO integration, 5 nodes, IF branching, 6 locales

# Individual LEGO packages
npm --prefix packages/connection-lego run typecheck
npm --prefix packages/validation-lego run typecheck
npm --prefix packages/node-lego run typecheck
npm --prefix packages/expression-lego run typecheck
npm --prefix packages/execution-data-lego run typecheck

# Error Recovery LEGO (retry + error routing)
npm run reconstructed:test                # 32 tests: error-recovery + pairedItem provenance (unit & JS engine)
npm run reconstructed:demo                # end-to-end regression demo (must print VERIFIKASI BERHASIL)

npm --prefix packages/reconstructed-engine run typecheck   # 0 errors (16/16 LEGO packages)
npm --prefix packages/reconstructed-engine run emit:cjs    # compile TS engine (CJS, dist-cjs/)
npm --prefix packages/reconstructed-engine run test:ts-integration
                                          # error-recovery integration on the TypeScript engine
```

A failing gate means the isolation is void and must be rolled back — the records
are machine-readable in `docs/isolation/evidence/`.

## Reconstructed Engine — Quick Start

```bash
# Load workflow definition (n8n format)
import { ReconstructedWorkflowEngine } from './packages/reconstructed-engine/src/execution-engine/runner.ts';

const engine = new ReconstructedWorkflowEngine({ mode: 'manual', locale: 'id' });
engine.loadWorkflow({
  id: 'test',
  name: 'Test Workflow',
  nodes: [
    { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
    { name: 'Set', type: 'n8n-nodes-base.set', parameters: {} }
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Set', type: 'main', index: 0 }]] }
  },
  active: false
});
engine.registerDefaultNodeTypes();
const result = await engine.executeWorkflow();
```

**Provenance:** n8n 2.9.4, 6-language i18n (ID, EN, JV, AR, ZH, RU), zero Rust, frontend 100% original Vue Canvas untouched, backend modular LEGO data flow with clear boundaries and formal contracts. See `docs/isolation/reconstructed-engine.md` for full blueprint.
