# Context, session and memory

**Status:** specification. **Canonical contracts:** `ai.context`, `ai.agent-session`
(`ai.foundation@1.0.0`, manager). **Frontend owner:** agent-01 for the UI half.
Memory as a *store* is **XA-12** (`publicationPending`); everything below is planning for the
published parts plus the frontend's rendering of them.

---

## 1. The permanent invariant

```
Conversation  !=  Session  !=  Context window  !=  Memory  !=  Execution
```

- One **conversation** may contain many sessions (`Session 001`, `002`, `003`).
- One **session** may have one or more **context windows / continuations**.
- **Memory survives context replacement.** It is not the window; loaded context is what the window
  currently holds.
- **Execution state is not conversation history.** A run's state comes from `execution.*`, not from a
  transcript.

Any design that stores the transcript as "memory", or treats a new window as a new conversation,
violates this invariant. It is recorded here so it cannot be rediscovered by accident.

## 2. Context

Published shape (`ai.context`): `contextId`, `scope`
(`GLOBAL`, `WORKFLOW`, `NODE`, `EXECUTION`, `EVENT`, `AGENT`, `TASK`), `parent`, `snapshot`,
`version`, `source`, `dependencies`, `size`, `checksum`. Rules: **selective load** (only what the
scope needs) and **compaction** (a compacted context emits `context.compacted` and preserves the
checksum chain, so a continuation can prove it descends from the previous window).

The frontend renders: `Context 61%`, `12.4k / 32k`, and on demand Used, Budget, Remaining, Session,
Previous session, Continuation, Memory loaded, Tools loaded, Conversation, Reserved output. It never
renders the window itself, and never computes a token count the provider did not report.

## 3. Session

Published shape (`ai.agent-session`): `sessionId`, `agentId`, `parentSessionId`, `taskId`,
`workflowId`, `executionId`, `runtimeId`, `status` (`created`, `running`, `waiting`, `paused`,
`completed`, `failed`, `cancelled`), `createdAt`, `updatedAt`, and references (`contextRef`,
`artifactRef`, `traceRef`). Sessions are **bounded by rule** — a session is not an unbounded
transcript.

The frontend renders `Session 03` with continuity (`Continuation linked`) and the current window; the
session *mechanics* live at disclosure level 3.

## 4. Context Manager: NORMAL -> PREPARE -> ROLLOVER

```
NORMAL     usage monitored; the chip shows a percentage; nothing interrupts
PREPARE    a rollover threshold is reached: the user is told, and offered `Continue session`
ROLLOVER   continuation package is built -> context compacted -> next session/window created ->
           continuation linked -> state restored -> continuity verified
```

The continuation package contains: identity · objective · plan · completed work · unfinished work ·
constraints · decisions · active entities · tool state · artifacts · important references · errors ·
unresolved questions · compressed history.

Two prohibitions: **never wait for an exact token limit** (rollover is about *state*, not about
hitting a wall), and **never silently lose task state**. If rehydration fails, the failure is
surfaced — a degraded continuation is announced, not hidden.

The user experience is one continuous conversation: `Session 04 · Continuation linked`, no error
state, no lost objective. Details: `AI_UI_STATES_AND_FLOWS.md §3.6`.

## 5. Memory

Memory is the layer that survives context replacement: decisions, evidence, artifacts, tasks,
relationships, project knowledge — retrieved **by relevance**, never dumped.

Publication state: no `ai.memory` capability exists at P2.10; the honest sources today are
`ai.context` (what is loaded), `ai.decision` (what was chosen, with evidence) and `ai.artifact` (what
was produced). The frontend therefore renders `Memory 12 relevant` as a *count of what is loaded plus
the decisions and artifacts in scope*, says so in advanced details, and waits for **XA-12** before
claiming a store. The graph view belongs to `MEMORY_GRAPH_OBSIDIAN_PLAN.md`.

## 6. What must never happen

- A transcript copy in an event, an artifact, a decision or memory.
- Memory rendered as a store dump; a graph rendered without relevance.
- A token counter invented to fill a percentage.
- A rollover that loses the objective, the constraints or the pending approvals.
- "New session" used as a silent way to forget an approval or a denial.
