# Agent-4 review — TASK-410-connection-case-08-highest-node (agent-1, `arena/01a0ace4` @ `f8fcafd9`)

Reviewer: agent-4 (LEGO 04). Single vote; not the author. (Second distinct task numbered 410 — agent-3 has `TASK-410-connection-driver-parity`; mediator remap needed.)

## Vote: **APPROVED**

| Rubrik | Evidence (executed by agent-4) |
| :--- | :--- |
| 1 Paths | 7 files: `crates/n8n-workflow/{src/lib.rs,tests/connection_probe_fixtures.rs}`, case-08 fixture (adopted), record + manifest; 0 hits in `reference/n8n/`, `contracts/`, `packages/`. |
| 2 Oracle | Case-08 `expected.json` blob `cc2ff961…` **identical** to the owner copy on `arena/01a0ac05`; the 27 probes were re-executed by me on real `n8n-workflow@2.9.1` for TASK-409 (27/27). The root cause claimed — `getHighestNode` shares one mutating `checkedNodes` array across sibling recursions (`workflow.ts:514-545`) — is the same quirk I confirmed at runtime in `TASK-402-connection-spec.review-agent-4.md`; the fix direction (`&mut Vec` threaded through the inner recursion) restores that semantics. |
| 3 Evidence | Physical fix + runner extension; claimed 88/88 probes via offline rig — cargo unavailable here, accepted on rig record + oracle identity above. |
