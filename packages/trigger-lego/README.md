# Trigger LEGO (`@lego/trigger`)

Activation lifecycle of trigger/poll nodes — the in-memory registry
(`ActiveWorkflows`), activation guards, and the emit boundary into Execution.

- Reference: n8n `2.9.4` (`b6dc2787`), `packages/core/src/execution-engine/active-workflows.ts`,
  `triggers-and-pollers.ts`, `packages/cli/src/active-workflow-manager.ts`
- Contract: `contracts/trigger.contract.md` · Isolation: `docs/isolation/trigger.md`
- Invariants: **T1–T10** (`src/model-surface.ts`, `TRIGGER_PROVENANCE`)
- Engine twin: `packages/reconstructed-engine/src/trigger-engine.ts`
- Tests: `npm test` → `test/01-boundary.test.mjs` (6/6, zero deps, offline)

Status: **VERIFIED** (Phase 4-13). Zero Rust, UI untouched.
