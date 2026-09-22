# P2.13 — Context & Session foundation

**Status:** implementation in progress on Agent 2; not complete until Manager reconciliation, merge validation, and post-merge verification on protected `main`.

**Canonical contracts:** `ai.context@1.0.0`, `ai.agent-session@1.0.0`.

**Implementation:** `apps/n8n-lego/src/lego/context-session.mjs` with the public contract surfaces `context.mjs` and `agent-session.mjs`.

**Canonical milestone state:** `docs/n8n-lego/milestones.json`.

## Why this LEGO exists

The system keeps these concepts permanently distinct:

```text
Conversation != Session != Context Window != Memory != Execution
```

A conversation can span several bounded sessions. A session is bounded identity and control state. A context window is the selected material loaded for the current work. Memory is the separate future store for knowledge that survives context replacement. Execution is the future Agent Machine/runtime concern.

Context & Session is one LEGO. `ai.context` and `ai.agent-session` are two contracts in that LEGO, not two new top-level domains.

## Context contract

`ai.context@1.0.0` publishes the established fields:

- `contextId`
- `scope`
- `parent`
- `snapshot`
- `version`
- `source`
- `dependencies`
- `size`
- `checksum`

The allowed scopes are:

```text
GLOBAL, WORKFLOW, NODE, EXECUTION, EVENT, AGENT, TASK
```

A context is created with an explicit scope and a bounded snapshot. A parent must already exist and, when supplied, its checksum must match. The snapshot has its own identity and version; the context checksum includes the parent checksum, snapshot data, version, source, dependencies, and bounded size. Compaction therefore creates a verifiable descendant rather than overwriting history.

Loading is selective. Metadata loading does not expose snapshot data, and data loading requires an explicit list of keys. Wildcard loading is refused. No transcript dump and no eager load of every memory, tool or skill is implemented.

## Session contract

`ai.agent-session@1.0.0` publishes:

- `sessionId`
- `agentId`
- `parentSessionId`
- `taskId`
- `workflowId`
- `executionId`
- `runtimeId`
- `status`
- `createdAt`
- `updatedAt`
- `contextRef`
- `artifactRef`
- `traceRef`

The states are explicit:

```text
created, running, waiting, paused, completed, failed, cancelled
```

Invalid transitions fail closed. A session contains references and bounded control state; it does not contain a transcript, raw model output, hidden prompts, private reasoning, credentials, tokens, cookies, or capability grants.

The published session operations are `create`, `status`, and `close`. `close` has one explicit terminal outcome: it defaults to `completed`, and accepts `failed` or `cancelled` when the caller has that outcome. Repeating close with the same terminal outcome is idempotent; attempting to change an already terminal outcome fails as an interaction mismatch. The operation does not execute, cancel, or retry external work — it records bounded lifecycle state only.

The backend transition table is declarative in `manifest/ai-foundation.json` and executable as `AGENT_SESSION_TRANSITIONS`. The allowed transitions are:

```text
created  -> running | waiting | cancelled
running  -> waiting | paused | completed | failed | cancelled
waiting  -> running | paused | completed | failed | cancelled
paused   -> running | cancelled
completed, failed, cancelled -> terminal
```

## Published operation matrix

The contract lock publishes these operation sets and permissions without adding a runtime/provider authority path:

| Contract | Operations | Permissions |
| --- | --- | --- |
| `ai.context@1.0.0` | `load`, `compact`, `rollover`, `rehydrate`, `verify` | `ai:context:read`, `ai:context:write` |
| `ai.agent-session@1.0.0` | `create`, `status`, `close` | `ai:agent:control`, `ai:agent:create`, `ai:agent:read` |

The context manager operations are bounded local state mechanics. `rollover` serializes before the declared threshold reaches the exact limit, creates a compacted descendant, rehydrates a linked child session and exposes `verified`, `degraded`, or `failed`; it never silently repairs missing required state.

## Context manager state machine

The manager uses the declared lifecycle:

```text
NORMAL -> PREPARE -> ROLLOVER
```

- **NORMAL:** utilization is monitored without interrupting work.
- **PREPARE:** the declared utilization threshold is reached while there is still serialization headroom.
- **ROLLOVER:** the manager builds a continuation package, compacts the context, creates the next context/session representation, links the parent/child lineage, rehydrates required state, and verifies continuity. A successful operation returns to monitoring (`NORMAL`) while its result records that it passed through `ROLLOVER`.

The trigger is a declared utilization ratio, not an exact token limit. The implementation refuses token-limit counters as a source of fabricated truth and never waits for 100 percent.

## Continuation package

The package is structured and bounded. It preserves:

- identity and source context checksum,
- objective,
- plan,
- completed work,
- unfinished work,
- constraints,
- decisions,
- active entities,
- `toolStateReferences`,
- artifacts,
- `importantReferences`,
- errors,
- unresolved questions,
- compressed history.

The package has a deterministic checksum and size envelope. It does not contain chain-of-thought, raw hidden prompts, or an unbounded transcript. Missing required identity/state, a checksum mismatch, a size mismatch, an unsafe field, or an unavailable required context fails closed.

## Verification outcomes

Rehydration always exposes a verification result:

- **`verified`** — identity, checksum, bounded size and lineage checks pass.
- **`degraded`** — integrity remains valid but an optional reference is explicitly unavailable/degraded; no payload is silently substituted.
- **`failed`** — required identity, checksum, size, safety, or lineage verification fails. Rehydration does not repair or reset state silently.

A rollover result includes the previous session/context, continuation package, next context/session, parent checksums, and verification status.

## Security and bounded state

The implementation rejects credential/secret/token/password/cookie/authorization fields, private model reasoning and chain-of-thought fields, raw prompts/transcripts/messages, arbitrary host paths, filesystem/terminal authority, and unrestricted capability/permission grants. References are preferred over payloads. Context, continuation, and total local registry sizes have explicit configurable limits.

This is bounded local state. It is not a persistence backend or a scale-out implementation.

## Explicit non-scope

P2.13 does **not** implement:

- model inference or provider API calls;
- Agent Machine or a multi-agent execution loop;
- Skill execution;
- Memory persistent storage;
- Workspace executor, filesystem authority, or terminal authority;
- MCP runtime;
- Runtime Adapter runtime;
- Node Creator or Translation runtime;
- token provider integration;
- external agent runtime integration;
- Rust implementation.

AI runtime remains **NOT IMPLEMENTED**. Memory remains **NOT IMPLEMENTED**. Agent Machine, Workspace, MCP, Runtime Adapter and all later runtime/provider work remain outside this milestone. Rust remains **NOT STARTED** and scale-out remains **NOT READY**.

### Final scope status report

| Area | Status in P2.13 |
| --- | --- |
| AI runtime | **NOT IMPLEMENTED** |
| Model inference | **NOT IMPLEMENTED** |
| Agent Machine runtime | **NOT IMPLEMENTED** |
| Memory persistent store | **NOT IMPLEMENTED** |
| Workspace runtime | **NOT IMPLEMENTED** |
| MCP runtime | **NOT IMPLEMENTED** |
| Runtime Adapter runtime | **NOT IMPLEMENTED** |
| Node Creator runtime | **NOT IMPLEMENTED** |
| Translation runtime | **NOT IMPLEMENTED** |
| Token-provider integration | **NOT IMPLEMENTED** |
| Rust | **NOT STARTED** |
| Scale-out | **NOT READY**; existing declared storage/process-local exceptions remain |

## Reconciliation boundary

Agent completion is not merge approval. Agent 1's frontend consumer and Agent 2's backend implementation must be compared against the same protected-main baseline. The Manager must reconcile vocabulary, fields, operations, permissions, errors, boundaries, tests, and generated documentation before merging.

The register records two separate gates:

1. **RECONCILIATION PASS** — both agent outputs are mutually consistent and architecturally valid.
2. **MERGE PASS** — the reconciled candidate passes validation against protected `main`; post-merge verification then runs before P2.13 can become complete.

A conflict in contract or architecture is not a formatting conflict. It is recorded as `RECONCILIATION_FAILED` until corrected.
