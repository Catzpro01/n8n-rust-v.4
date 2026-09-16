# N8N-RUST V4 RULES

1. **Do not rewrite large sections blindly.** Every step is derived from concrete anatomy and verification.
2. **n8n original is the behavioral reference.** Truth comes from n8n source code + runtime observation + tests.
3. **Every module must have a clear boundary.** No monolithic spaghetti.
4. **Every module must have a contract.** Formal LEGO rules (`contracts/*.contract.md`).
5. **Every Rust replacement must have compatibility tests.** Reference tests against original n8n must pass.
6. **Never modify another module without explicit dependency justification.**
7. **No hidden cross-module dependencies.** All contracts and data transfers are explicit.
8. **Prefer modular monolith before microservices.** Keep latency low, maintain clean crate boundaries.
9. **Optimize RAM/CPU only after behavior is correct.** Correctness first, performance second.
10. **A module is DONE only after live verification.** Real-world runtime check against original workflows.

---

## Agent Arena Operational Protocol
- **Agent 1**: System & Package Anatomy (`00-system-map.md`, `01-package-map.md`, `02-dependency-map.md`)
- **Agent 2**: Workflow & Node Anatomy (`03-workflow.md`, `04-node-system.md`)
- **Agent 3**: Execution & Data Flow (`05-execution.md`, `06-execution-data.md`, `07-expression.md`, `11-queue.md`)
- **Agent 4**: Triggers, Webhooks, Scheduler, Persistence & API (`08-trigger.md`, `09-webhook.md`, `10-scheduler.md`, `12-persistence.md`, `13-credentials.md`, `14-events.md`, `15-api.md`, `16-realtime.md`, `17-editor.md`)
- **Agent 5**: Test & Verification, Consistency Guardian across all contracts and reference tests.

## Lifecycle of Every LEGO Component
```text
DISCOVERED ──► ISOLATED ──► CONTRACTED ──► REFERENCE TESTED ──► RUST IMPLEMENTED ──► COMPATIBILITY TESTED ──► LIVE VERIFIED ──► REPLACED
```
