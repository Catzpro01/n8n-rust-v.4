# Agent Machine

**Status:** planning. **Published today:** contracts only — `ai.agent-runtime`, `ai.agent-delegation`,
`ai.agent-session`, `ai.agent-events`, `ai.decision`, `ai.approval`, `ai.artifact`, `ai.context`
(all `ai.foundation@1.0.0`, status `contract-only`). **No runtime exists, and none is built by this
branch.**

---

## 1. What it is

Agent Machine is an **n8n-native execution and orchestration primitive**, not a chatbot with tools:

```
Trigger -> Agent Machine -> child agents -> join -> next workflow step

Main Agent
├── Research Agent
├── Builder Agent
│   ├── Frontend
│   └── Backend
├── Tester Agent
└── Reviewer Agent
        -> Aggregator
```

The graph must support: sequential · parallel · conditional · fan-out · fan-in · join · retry · pause ·
resume · cancellation · budgets · delegation · dependency tracking. This is the bridge between
traditional workflow orchestration and agent orchestration.

## 2. What is published, and what is not

| Concern | Published shape | Not published |
| :--- | :--- | :--- |
| lifecycle | `create`, `start`, `send`, `pause`, `resume`, `cancel`, `status`, `stream`, `artifact`, `close` | any implementation |
| declaration | `runtimeMetadata` (runtimeId, kind, version, availability, transport, locality, supports) | — |
| session | `sessionId`, agent/parent/task/workflow/execution/runtime ids, status, references | — |
| delegation | `delegationId`, parent/child session, task, `grantedCapabilities`, budget, deadline, status | — |
| observation | `ai.agent-events` (26 types, 7 namespaces) | — |
| graph semantics | — | **fan-in, join, retry policy, dependency tracking beyond parent/child** |
| decision/artifact/approval/context | contracts published | — |

The unpublished row is the reason this document states a **requirement** rather than a design:
join/aggregation semantics need a contract before a UI may render them. Until then the agent tab
renders a tree and a status, not a pipeline editor.

## 3. Delegation is authority-limited by construction

- A child receives a **subset** of the parent's grants (`grantedCapabilities`) and **never** an
  inherited permission — `authorityRule` published; the UI shows a child's own grants only.
- Budgets (`maxTokens`, `maxToolCalls`, `maxDurationMs`, `maxChildren`) are **limits**, clamped to the
  parent's; deadlines are clamped to the parent's deadline.
- Nesting does not grant authority, in any depth. This is the same principle the development workforce
  follows (`PROJECT_WORKFORCE_ORCHESTRATION.md §3`).

## 4. Execution AI is a mode, not an engine

`Execution AI` sets the Copilot's context scope to `EXECUTION` and seeds it with the run's declared
facts (`execution.history.inspect`, the run's trace rows). It adds no capability, no runtime and no
second model path. The frontend capability `execution-ai-mode` is a **mode**, never an engine.

## 5. Observation rules (what the UI may render)

- `Agent: Working` / `Agents 5` -> tree -> one agent's details (task, status, runtime, workspace,
  skills, capabilities, artifacts, token usage where reported).
- The trace is operational: Understand · Inspect · Observe · Decision · Approval · Artifact ·
  Completed — bounded (200 rows), ordered `(timestamp, sequence)`, reference-only.
- Decisions carry `decisionId`, timestamp, agent, task, selected option, alternative references,
  reason summary, evidence references, risk and approval state.
- **Never** chain-of-thought, private reasoning, another agent's context, or an inherited-permission
  claim that does not exist.
- A paused run (approval) is never rendered as slow; an expired approval is denied, not pending.

## 6. Reference scenarios

`REFERENCE_AGENT_SCENARIOS.md` carries the canonical end-to-end examples: website creation (multi-agent
with workspace, browser inspection and a PR), workflow debugging (Execution AI), multi-agent coding
(research -> build -> test -> review with an aggregator), node creation, external runtime, memory
projection, and token/context rollover. All of them are **contract-compatible with the general Agent
Machine** — none of them invents a second mechanism.
