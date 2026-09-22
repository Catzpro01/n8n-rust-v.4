# Context, session and memory

**Status:** specification, re-measured at **P2.13** against `main @ e754c5df` (2026-09-22).
**Canonical contracts:** `ai.context`, `ai.agent-session` — both **declared and registered
`contract-only`, published by no `contract-lock.json` row** (`XA-20`). **Frontend owner:** agent-01
for the UI half; **milestone:** P2.13 (canonical row: `docs/n8n-lego/milestones.json`).
Memory as a *store* is **XA-12** (`publicationPending`); everything below is planning for the
declared parts plus the frontend's rendering of them.

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
violates this invariant. It is recorded here so it cannot be rediscovered by accident — and since
P2.13 it is enforced, not only written down: `assertDistinctConcepts()` refuses a record that merges
two of the five, naming the concept that collapsed (`context-session.mjs`, rule **A28**, `test/32`).

## 2. Context

Declared shape (`ai.context`, in `manifest/ai-foundation.json#context`): `contextId`, `scope`
(`GLOBAL`, `WORKFLOW`, `NODE`, `EXECUTION`, `EVENT`, `AGENT`, `TASK`), `parent`, `snapshot`,
`version`, `source`, `dependencies`, `size`, `checksum`. Rules: **selective load** (only what the
scope needs) and **compaction** (a compacted context emits `context.compacted` and preserves the
checksum chain, so a continuation can prove it descends from the previous window).

**Publication state, verified not assumed:** `domains.json` registers `ai.context` as `contract-only`
with operations `load`, `compact` and permissions `ai:context:read`, `ai:context:write`;
`ai-lego-set.json#lego[id=context-session]` *claims* `ai.context@1.0.0`; `contract-lock.json` holds
15 rows and **none** is `ai.context`. So the fields, scopes, operations and permissions are quotable
(with provenance), and the version is **not renderable** — the frontend reports `declared-not-locked`
and a `declaredVersion`, never a published version.

The frontend renders: `Context 61%`, `12.4k / 32k`, and on demand Used, Budget, Remaining, Session,
Previous session, Continuation, Memory loaded, Tools loaded, Conversation, Reserved output. It never
renders the window itself, and never computes a token count the provider did not report: a usage
figure is `reported`, `estimated`, `not-reported` or `over-budget`, carries one of the three declared
token kinds (`message`, `modelInput`, `output` — quoted from `reference-scenarios.json`, `XA-17`) or
is not drawn at all.

## 3. Session

Declared shape (`ai.agent-session`, in `manifest/ai-foundation.json#agentSession`): `sessionId`,
`agentId`, `parentSessionId`, `taskId`, `workflowId`, `executionId`, `runtimeId`, `status`
(`created`, `running`, `waiting`, `paused`, `completed`, `failed`, `cancelled`), `createdAt`,
`updatedAt`, and references (`contextRef`, `artifactRef`, `traceRef`). Sessions are **bounded by
rule** — a session is not an unbounded transcript, and an inlined payload is refused by name.

Registered `contract-only` in `domains.json` with operations `create`, `status`, `close` and
permissions `ai:agent:create`, `ai:agent:read`, `ai:agent:control`; claimed as `ai.agent-session@1.0.0`
in the AI set; **no lock row** (`XA-20`). Note what the published operations do *not* include:
`continue`, `pause`, `resume`. `pause`/`resume` belong to `ai.agent-runtime`, which has no runtime.

The frontend renders `Session 03` with continuity (`Continuation linked`) and the current window; the
session *mechanics* live at disclosure level 3. None of the seven states is an execution state, none
implies inference, and none grants anything.

## 4. Context Manager: NORMAL -> PREPARE -> ROLLOVER

```
NORMAL     usage monitored; the chip shows a percentage; nothing interrupts
PREPARE    a rollover threshold is reached: the user is told, and offered `Continue session`
ROLLOVER   continuation package is built -> context compacted -> next session/window created ->
           continuation linked -> state restored -> continuity verified
```

**This phase machine is ruled but unpublished.** No backend file declares `NORMAL`, `PREPARE` or
`ROLLOVER`; the six lifecycle states that *are* declared (`ai-lego-set.json#lego[id=context-session]
.lifecycle`: `declared`, `active`, `prepare`, `compacting`, `rolled-over`, `closed`) are the words the
UI renders today. The frontend keeps the three phases in `PENDING_PUBLICATIONS` under `XA-20`, maps
them explicitly (`PREPARE → prepare`, `ROLLOVER → compacting → rolled-over`, `NORMAL →` no published
word) and never treats the two vocabularies as synonyms: a rename decided in a UI is a rename nobody
ratified.

The continuation package contains the fourteen declared sections: `identity` · `objective` · `plan` ·
`completedWork` · `unfinishedWork` · `constraints` · `decisions` · `activeEntities` · `toolState` ·
`artifacts` · `refs` (the published spelling of "important references") · `errors` ·
`unresolvedQuestions` · `compressedHistory`. An envelope travels with it (`sourceContextId`, `target`,
`verification`, lineage ids) and is not a section.

Two prohibitions: **never wait for an exact token limit** (rollover is about *state*, not about
hitting a wall — the frontend refuses a threshold at or above 100%, because a rollover at the limit
has no room left to write the package), and **never silently lose task state**. If rehydration fails,
the failure is surfaced — a degraded continuation is announced, not hidden, and never repaired
silently: verification has exactly three results, `verified`, `degraded` and `failed` (also ruled but
unpublished, `XA-20`), and a section that is *absent* degrades a continuation while a section carried
as `[]` says "there were none".

The user experience is one continuous conversation: `Session 04 · Continuation linked`, no error
state, no lost objective. Details: `AI_UI_STATES_AND_FLOWS.md §3.6`.

## 5. The six continuation affordances (P2.13)

| Affordance | Renders from | State |
| :--- | :--- | :--- |
| `continue-session` | the PREPARE ruling + the published word `prepare` | `operation-unpublished` — `ai.agent-session` publishes create/status/close only, so no `continue` operation is wired |
| `rollover-preparing` | the published lifecycle word `prepare` | rendered from declaration |
| `continuation-linked` | `parentSessionId` / `nextSessionId` / `sourceContextId` references | rendered from declaration |
| `continuity-verified` | a verification result of `verified` | rendered from declaration (result vocabulary pending) |
| `continuation-degraded` | a result of `degraded`, with the missing sections named | rendered from declaration |
| `continuation-failed` | a result of `failed`, or a refused package | rendered from declaration |

Six, and no seventh: there is no `reset-session`, no `new-session` and no `forget`. Lineage is read
from references, never inferred from time, order or a shared agent.

## 6. Memory

Memory is the layer that survives context replacement: decisions, evidence, artifacts, tasks,
relationships, project knowledge — retrieved **by relevance**, never dumped.

Publication state at P2.13: **no `ai.memory` capability and no memory operation exists at any layer**
(`ai-foundation.json` declares no memory block; `domains.json` registers none). The honest sources
today are `ai.context` (what is loaded), `ai.decision` (what was chosen, with evidence) and
`ai.artifact` (what was produced). The frontend therefore renders `Memory 12 relevant` as a *count of
what is loaded plus the decisions and artifacts in scope*, says so in advanced details, names the
fifth concept as **absent**, and waits for **XA-12** before claiming a store. Publishing `ai.context`
must not create one: a record carrying a `memory` payload is refused. The graph view belongs to
`MEMORY_GRAPH_OBSIDIAN_PLAN.md`.

## 7. What the P2.13 frontend surface is, and is not

| It is | It is not |
| :--- | :--- |
| a vocabulary-and-state surface: identity, scope, lifecycle, usage honesty, rollover state, continuation, verification, lineage, degraded continuation | a token dashboard, a transcript view, a context editor |
| derived from what the application hands over (four declaration blocks, any lock rows, the records) | a reader of the backend tree at runtime, or a second source of truth |
| fail-closed: unknown scope/status/lifecycle/verification result refused by name, secrets and private model material refused by key and by pattern | fail-silent: nothing is mapped to the nearest known word, nothing is repaired |
| byte-neutral: the boot payload stays 18,126 B and the view is built on demand | part of the descriptor, or an execution affordance |

Explicitly **not** implemented in P2.13, and refused by the surface: model inference, provider calls,
the Agent Machine loop, multi-agent runtime, Skill execution, a Memory store, a Workspace executor,
filesystem or terminal authority, MCP runtime, Runtime Adapter runtime, Node Creator/Translation
runtime, token-provider integration, external agent runtime, Rust.

Code and proof: `packages/frontend-lego/src/context-session.mjs`, `manifest/context-session.json`,
contract §19.19, rule A28, `test/32-context-session.test.mjs` (46 tests: provenance, publication
honesty, backend alignment, lifecycle, rollover, continuation, verification, degraded and failed
paths, refusals, no fabricated tokens, no memory store, no execution affordance, boot payload
unchanged). The publication question itself is filed as
`docs/n8n-lego/decisions/XA-20-context-session-publication.md` (options A–D for the manager).

## 8. What must never happen

- A transcript copy in an event, an artifact, a decision or memory.
- Memory rendered as a store dump; a graph rendered without relevance.
- A token counter invented to fill a percentage.
- A rollover that loses the objective, the constraints or the pending approvals.
- "New session" used as a silent way to forget an approval or a denial.
- A version rendered for a contract no lock row publishes, or a phase name spelled locally because
  the backend has not published one.
