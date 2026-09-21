# Master plan — the frontend AI experience

**Status:** specification (durable). **Owner:** agent-01 (frontend + compatibility).
**Backend authority:** Agent 2's AI/LEGO foundation — `ai.foundation@1.0.0`, `lego.domain-registry@1.1.0`,
`lego.interaction@1.0.0`, `lego.negotiation@1.0.0`, `lego.envelope@1.0.0` on
`arena/01a0c521-n8n-rust-v-4 @ 6f7b66da`. **Reconciled frontend baseline:** `bdd0f1d2`.

This document says **how the AI experience is supposed to work**. It is a product and interaction
specification, not an implementation: nothing here calls a model, ships a provider client, or
executes a workflow. Every backend-visible word in it is either quoted from a published contract
or marked `publicationPending` with an owner and a decision id
(`docs/n8n-lego/decisions/cross-agent-decisions.json`).

**How to read this area.** The `.ai/` pack (card, glossary, indexes, recipes) is what an agent
loads to *work* in this repository; it stays small and budget-enforced. This area is what an agent
reads to *design* the AI experience. Load one document at a time:
`knowledge.mjs → productContextFor({ kind: 'ai-surface' | 'ai-contract' | 'ai-disclosure' | 'ai-state' | 'ai-accessibility' | 'ai-phase' })`.

| Document | Answers |
| :--- | :--- |
| `AI_UI_EXPERIENCE_MASTER_PLAN.md` (this) | What the experiences are, which LEGO they touch, where each surface lives, what it shows first. |
| `AI_FRONTEND_CONTRACT_MATRIX.md` | Which canonical contract, vocabulary and operation each surface consumes — and what it must never read. |
| `AI_UX_PROGRESSIVE_DISCLOSURE.md` | What is visible at each disclosure level, what is paged or virtualized, what is never rendered. |
| `AI_UI_STATES_AND_FLOWS.md` | Every state each surface must render, and the flows through them, fail-closed. |
| `AI_ACCESSIBILITY_AND_LOCALIZATION.md` | Keyboard, screen reader, RTL, the six locales, message keys. |
| `AI_UI_IMPLEMENTATION_PHASES.md` | The order to build it in, what each phase depends on, and what proves it. |

---

## 1. One AI Foundation, three experiences — and Execution AI is a mode

There is **one** AI foundation in the product and **three** experiences on top of it. Nothing in
this plan creates a fourth engine, a second model path or a second chat implementation.

| Experience | Scope | Where it is entered | Canonical contracts consumed |
| :--- | :--- | :--- | :--- |
| **AI Assistant** | `GLOBAL` — n8n itself: settings, workflow help, project help, credential guidance, system questions | Global AI entry in the shell (`AI Assistant`), command palette, help affordances | `ai.foundation@1.0.0` (`ai.model-gateway` for inference, `ai.artifact`, `ai.approval`, `ai.agent-events`), frontend capability `ai-assistant` |
| **AI Copilot** | context ladder `GLOBAL → WORKFLOW → NODE → EXECUTION → EVENT` | Right-side panel on the workflow canvas; drawer on a small laptop; full screen on mobile | as above plus `ai.context`, `ai.agent-session`, `ai.agent-delegation`, `ai.decision`, `ai.artifact` |
| **AI Node** | one workflow step that delegates work | The node itself: `Ask AI` / `Open Copilot` | `ai.agent-runtime` (lifecycle + metadata), `ai.agent-delegation`, `ai.tool-gateway`, `ai.approval` |
| **Execution AI** *(a Copilot mode, not an experience of its own)* | one execution, its failures and its data | `Analyze Execution` on an execution view | `execution.*` domain operations, `ai.context` scoped to `EXECUTION`, `ai.agent-events` for the run |

Rules that follow from this:

1. **One foundation.** Assistant, Copilot, the node and Execution AI resolve to the same
   `ai.foundation` contracts. There is no second model gateway, no second event stream, no
   second approval path.
2. **A mode is not an engine.** Execution AI sets the Copilot's context scope to `EXECUTION` and
   seeds it with the execution's declared facts (`execution.history.inspect`, the run's trace rows).
   It adds no capability of its own — the frontend capability `execution-ai-mode` is a *mode* with
   declared operations (`execution.escalate`), never a runtime.
3. **The node does not need a chat panel.** `AI Node` is configuration plus two entry points into
   the Copilot. A permanent chat surface inside a node canvas is explicitly not part of this plan.
4. **The context ladder is the same object.** Assistant is the ladder at `GLOBAL`; Copilot lets the
   user descend; the scope names are the canonical `ai.context` scopes
   (`GLOBAL`, `WORKFLOW`, `NODE`, `EXECUTION`, `EVENT`, `AGENT`, `TASK`).

## 2. The fifteen official AI/Agent LEGO

The plan covers all fifteen. "Published" means a contract-lock row exists in the backend
foundation; "publicationPending" means the concept is required by this plan but **no contract
publishes it yet** — it carries owner, decision and reason, and the frontend must not invent a
version for it.

| # | LEGO | What it is | Backend status | Frontend surface | Disclosure |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **AI Foundation** | the contract layer: kinds, events, sessions, approvals, artifacts, context, transport ladder | **published** `ai.foundation@1.0.0` (manager, `contract-only`) | everything below | background |
| 2 | **Skill** | a named procedure with capabilities, validators, references and a token budget | `publicationPending` — **XA-20** (`ai.skill` proposed, manager) | chip → Skills list → detail | L1 → L2 → L3 |
| 3 | **Agent Machine** | the runtime that executes delegated tasks | **partially published**: `ai.agent-runtime` (contract), `ai.agent-delegation`, `ai.agent-session`; the Rust machine is not built and is out of scope here | agent tree, agent detail | L1 → L3 |
| 4 | **Memory** | what the run remembers beyond the window: decisions, tasks, artifacts, references | `publicationPending` — **XA-21** (`ai.memory` proposed, manager); today the honest source is `ai.context` (what is loaded) + `ai.artifact` + `ai.decision` | chip → Relevant memory → `Open Memory Graph` | L1 → L2 → L3 |
| 5 | **Workspace** | where an agent works outside the chat: project, tree, terminal state | domain exists (`workspace`, agent-2, **planned**, contract `0.0.0`, `workspace.projects` **unsupported**) — per-agent sandbox semantics are `publicationPending` — **XA-22** | workspace view inside agent detail | L2 → L3 |
| 6 | **Context & Session** | the window, its budget, its rollover; the session that carries continuity | **published** `ai.context` + `ai.agent-session` | header chip `Context 61%`, session line | L1 → L2 |
| 7 | **Universal Translation** | response language, request/response translation | `publicationPending` — **XA-23** (no translation domain or capability; the frontend capability `translation` is `declared`) | compact language control | L1 → L3 |
| 8 | **Node Creator** | node catalog and creating a node, with or without AI | **published** `node-registry@0.1.0` (`catalog` resolve/describe/list, `icons.read`); AI drafting is `publicationPending` — **XA-15** | node editor + `Create with AI` | L1 → L2 |
| 9 | **Capability** | the identity/status/operations/permissions vocabulary every LEGO publishes | **published** `lego.domain-registry@1.1.0` + the `ai.foundation` taxonomy (capability → contract → operations → interaction → implementation → provider → transport → runtime) | Capabilities list, source labels | L1 → L2 |
| 10 | **MCP Adapter** | interoperability at the edge: server/client roles, tools, resources, prompts | vocabulary **published** in `ai.foundation` (`mcp.*`, mapping rule: MCP concepts map *onto* the tool gateway); a capability of its own is `publicationPending` — **XA-16** (`ai.mcp-adapter` proposed, manager) | capability first, `— MCP` suffix; advanced details | L1 → L3 |
| 11 | **Runtime Adapter** | how a runtime is reached and what it supports | **published** `ai.agent-runtime` (`runtimeMetadata`: kind, version, availability, transport, locality, supports) | runtime line in agent detail | L1 → L3 |
| 12 | **Artifact** | generated work: patch, diff, log, report, screenshot, file, model-output, simulation-result | **published** `ai.artifact` (kinds, retention, `storageRef` opaque, checksum) | Files tab, artifact rows | L1 → L2 |
| 13 | **Approval** | the human gate: request, resolve, expire | **published** `ai.approval` (fail-closed: expired or unanswered = deny) | inline approval card, trace rows | L0 → L1 |
| 14 | **Agent Event & Work Trace** | the operational record of agent work | **published** `ai.agent-events` (26 types, 7 namespaces) + frontend capability `agent-work-trace` | Trace tab, status bar | L1 → L2 |
| 15 | **Token & Usage** | what a message, a run and a session cost | `publicationPending` — **XA-17** (`ai.usage` proposed, manager); today: `ai.model-gateway.countTokens` and declared costs `estimated` | per-message chip, usage details | L1 → L3 |

**Never a permanent panel.** At most four LEGO are visible at any moment (status bar + the open
tab). The rest are reached through expansion, the `More` menu, or a deep link. A surface may not be
promoted to a permanent panel without an amendment to this plan.

## 3. Surface map

```
n8n shell
├── global AI entry ────────────► AI Assistant        (GLOBAL scope)
│                                   └── approvals when an action is risky
├── workflow canvas
│    ├── right-side panel ──────► AI Copilot          (context ladder)
│    │                               ├── Chat · Trace · Agents · Files · More
│    │                               └── More: Memory · Skills · Capabilities · Context ·
│    │                                        Session · Token usage · Runtime · MCP · Approvals
│    ├── node ──────────────────► Ask AI / Open Copilot   (node-bound context)
│    └── execution view ────────► Analyze Execution        (Copilot in EXECUTION scope)
├── AI status bar ──────────────► one compact line for the whole AI layer
├── node editor ────────────────► Create with AI (Describe → Draft → Validate → Test → Preview → Install)
└── language control ───────────► response language / Translate response
```

### 3.1 AI Assistant

A native assistant, not a debugger. It answers questions about the instance (settings, workflows,
projects, credentials guidance, "where do I…"), and it can propose actions. Proposing an action is
an `ai.decision` with an approval state; nothing runs because a sentence was friendly.

The user never needs to know what an Agent Machine is to use the Assistant. There is no "agent
mode" switch in its UI, no runtime picker and no provider form outside settings.

### 3.2 AI Copilot

Tabs: **Chat · Trace · Agents · Files · More**. The tab strip is stable; a tab with nothing to show
is *disabled with a reason*, not hidden (hidden-then-appearing controls are how users lose trust).

- **Chat** — the conversation. Context scope shown as a chip in the header, never as a modal.
- **Trace** — operational rows (`Understand`, `Inspect`, `Observe`, `Decision`, `Approval`,
  `Artifact`, `Completed`), newest at the bottom, ordered by `(timestamp, sequence)`.
- **Agents** — one agent: `Agent: Working`; several: `Agents 5` → tree on demand.
- **Files** — artifacts, reference-based, with per-kind preview.
- **More** — the remaining surfaces, each one line until expanded.

Responsive behavior is normative, not aspirational:

| Width | Behavior |
| :--- | :--- |
| desktop (≥ 1280 px) | canvas + side panel side by side; panel 360–420 px, resizable, remembers its width per user |
| small laptop (1024–1279 px) | panel becomes a drawer over the canvas; the canvas keeps its scroll position; `Esc` closes |
| mobile (< 640 px) | Copilot is full screen; tabs become the primary navigation; the canvas is reached by "*Back to canvas*" |

### 3.3 AI Node

Configuration order, reflecting the canonical model: **model → instructions → skills →
capabilities → context → memory → runtime → approval behavior**. Every field is a reference to a
declared thing:

- `model` — a model **id** from `models.list`, never a vendor URL, key or header field;
- `capabilities` — capability ids + the operation each step may call;
- `runtime` — a runtime id whose declared `supports` covers what the node needs (streaming,
  cancellation, delegation);
- `approval` — which actions need a human gate (fail-closed default: the risky ones do).

Two entry points: `Ask AI` (a question about this node) and `Open Copilot` (a conversation with
this node as context). Both are the Copilot; the difference is the seeded scope.

### 3.4 AI status bar

One compact line that unifies the LEGO states, so ten panels are not needed:

| Shape | Example |
| :--- | :--- |
| working | `● Agent Working │ Session 03 │ Context 61% │ 3 Skills │ 2 Agents` |
| completed | `✓ Completed │ 1 artifact │ 0 approvals │ 4,218 tokens` |
| blocked | `⚠ Approval required │ Production workflow` |
| unavailable (zero-install) | `AI Foundation ready │ no provider configured` — a **valid** state, never an error banner |

Every segment is a button that opens the surface it summarizes. Segments are keyboard reachable and
carry their meaning in text (see the accessibility document): the coloured dot is decoration, the
word is the status.

### 3.5 Runtime, MCP, workspace, node creator, translation

- **Runtime** (`ai.agent-runtime`): agent detail shows `Runtime · Hermes · Remote · Connected`.
  Locality, health, resource cost and version live in advanced details. No external runtime is ever
  required: `Local` is a legitimate answer.
- **MCP** (`ai.foundation` mcp block): capability first — `github.search — MCP`. Server, transport,
  health, tools-loaded and availability are advanced details, discovered lazily. Hundreds of MCP
  tools are never listed at once.
- **Workspace**: shown when work happens outside the chat — project name, status, runtime, terminal
  state, file tree. Scope is explicit (`Workspace · project-name`), and the UI never implies
  unrestricted host access.
- **Node Creator**: `Create with AI` follows Describe → Draft → Validate → Test → Preview →
  Install. Creation methods stay peers: Visual, Declarative, OpenAPI, Script, Subworkflow, Native,
  Rust/WASM. Nothing pushes a user toward Rust.
- **Translation**: one compact control (`Language · Bahasa Indonesia`, `Response language: Auto`,
  and an optional `Translate response`). No permanent panel.

## 4. Progressive disclosure (summary)

Five levels, described in full in `AI_UX_PROGRESSIVE_DISCLOSURE.md`:

| Level | Where | What |
| :--- | :--- | :--- |
| **L0** | the message/row itself | one line of prose or one operational row |
| **L1** | inline chips | `· 8 tokens`, `Context 61%`, `Skills 3 active`, `Memory 12 relevant`, `Agents 5` |
| **L2** | the panel or tab | the list that belongs to the chip |
| **L3** | details / advanced | runtime, MCP, session mechanics, usage breakdown, memory graph |
| **L4** | source | the canonical declaration, the contract, the module — a deep link, never inlined text |

**Never rendered, at any level:** chain-of-thought or reasoning transcripts, raw prompts,
credentials or tokens, unredacted tool payloads, full model outputs inline, the whole memory store,
every MCP tool, or a complete session transcript. The trace carries summaries and references
(`payloadRef`, `artifactRef`, `decisionRef`) — never the payload.

## 5. One visual AI language

| Context | Label | Resolves to |
| :--- | :--- | :--- |
| shell / global | `AI Assistant` | Assistant, `GLOBAL` scope |
| workflow | `Copilot` | Copilot, `WORKFLOW` scope |
| node | `Ask AI` | Copilot, `NODE` scope (this node) |
| execution | `Analyze Execution` | Copilot, `EXECUTION` scope (this run) |

The same entry point looks the same everywhere: one icon family, one placement rule (top-right of
the owning surface), one keyboard shortcut, one loading behavior, one empty state shape.

## 6. Chat principles

The conversation is the product; everything else is available on demand.

- **The transcript is prose, not telemetry.** A message shows text, an optional token chip
  (`· 1 token` / `· 8 tokens`), and inline cards only when the message *is* a decision, an artifact
  or an approval.
- **Token chips are small and honest.** Detailed usage (Message / Context / Output / Total /
  Source) opens on demand; `Source` is `reported` or `estimated` and never invented. A count that
  nobody reported is shown as `estimated`, or not at all.
- **Context continuity is visible, mechanics are not.** `Context 61%` and
  `12.4k / 32k`; clicking opens Used, Budget, Remaining, Session, Previous session, Continuation,
  Memory loaded, Tools loaded, Conversation, Reserved output. Context Manager states are `NORMAL`,
  `PREPARE`, `ROLLOVER` — the user sees continuity (`Session 03 · Continuation linked · current
  context window`), not an abrupt failure.
- **Actions are declared before they are taken.** Anything with side effects becomes an
  `ai.decision` with `risk`, an `approvalState`, and — if needed — an approval card with
  `Action`, `Scope`, `Risk`, `Reason` and `Deny` / `Review & Approve`.
- **Assistant tone, not developer tone.** No provider names, no endpoint names, no token-limit
  jargon in the main flow.

## 7. Performance and payload rules

- **Lazy expansion.** Nothing beyond level L1 is computed, fetched or rendered until opened:
  memory, skills, MCP tools, agent trees, artifacts, usage details.
- **Subscriptions over polling.** Agent state, trace and approvals arrive as events
  (`ai.agent-events`); the UI subscribes once per open surface and unsubscribes on close. There is
  no interval polling of agent or trace state.
- **Bounded structures.** Trace rows are capped and virtualized; a trace keeps its declared
  capacity with a dropped-count, never an unbounded array. Artifact lists page.
- **Never block the editor.** AI metadata loads after the canvas is interactive; a slow or absent
  AI layer degrades to the status bar, and the workflow editor keeps working with zero AI
  (this is the zero-install state, not an error state).
- **No full transcript copies.** Messages are referenced, not duplicated into state, events, logs
  or artifacts.
- **Reported payload budgets.** The boot descriptor stays what it is today (18,126 B JSON; budget
  32 KB) and carries *no* AI metadata — no event names, no provider kinds, no capability metadata.
  The AI layer is loaded after boot, on demand.

## 8. Accessibility and localization

Pointer: `AI_ACCESSIBILITY_AND_LOCALIZATION.md`. Non-negotiables: keyboard reachable everything; the
Arabic locale renders RTL; statuses are never colour-only; icons carry labels; the six locales
(`id`, `en`, `ar`, `zh`, `ru`, `jv`) share one key space with a deterministic fallback; new UI copy
is a message key plus parameters, never a hard-coded sentence.

## 9. Product consistency

The AI layer extends n8n; it does not replace its identity. Explicitly **not** the goal: a generic
chat app, a terminal, a monitoring dashboard, or a vendor-specific agent shell. If a surface would
look the same in any product, it is not finished: it must read as n8n — same spacing, same
typography, same node vocabulary, same restraint.

## 10. Boundaries — what this plan does not build

Per the phase brief and §23 of the foundation gate, the following are **out of scope for the
frontend**, and nothing in this plan may quietly implement them: model inference; provider clients
(9Router-style gateways, Composio-style tool gateways, GitHub clients); the six external agent
runtimes; a simulation runtime; the Rust Agent Machine; Copilot UI *implementation* (this document
specifies it, no screen is built); agent node execution; translation dictionaries.

The frontend's job is the **contract surface**: consume declarations, render states, refuse
unknowns. `AI_UI_IMPLEMENTATION_PHASES.md` turns that into ordered work.

## 11. Cross-references

| Kind | Where |
| :--- | :--- |
| backend vocabulary authority | `arena/01a0c521-n8n-rust-v-4 @ 6f7b66da`: `manifest/ai-foundation.json`, `manifest/domains.json`, `contracts/contract-lock.json`, `ADR-0009`, `ADR-0010` |
| frontend vocabulary lock | `packages/frontend-lego/src/vocabulary.mjs` (38 canonical + 22 local sets) |
| seam & identity | `packages/frontend-lego/src/seam.mjs` (13 inputs, 7 forbidden sources, 16 identity fields) |
| AI declaration | `packages/frontend-lego/src/agents.mjs`, `src/agent-events.mjs`, `manifest/capabilities.json` |
| negotiation | `packages/frontend-lego/src/negotiation.mjs` (12 operation outcomes) |
| decisions awaiting an owner | `docs/n8n-lego/decisions/cross-agent-decisions.json` — **XA-5, XA-8, XA-9, XA-10** (open from the foundation gate), **XA-20 … XA-17** (proposed by this plan) and **XA-18** (the external action families, from `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md`) |
| rule enforcement | `contracts/frontend.contract.md` §19.9–§19.17, `src/conformance.mjs` (26 rules), `test/30-master-plan.test.mjs` |

## 12. Beginner mode and advanced mode

One product, two depths — the *same* declarations, never two implementations. Beginner is the
default; advanced is an opt-in that reveals what is already there.

| | Beginner (default) | Advanced (opt-in) |
| :--- | :--- | :--- |
| language | plain, no contract names, no identifiers | the project's own vocabulary, with provenance |
| what is visible | what is happening, whether it needs a decision, what changed | tokens, context %, session, skills, capabilities, MCP, runtime, permissions, agent tree, work trace, artifacts |
| configuration | none required; declared defaults | per-surface expansion, filters, deep links |
| failure wording | "this is not available yet, and here is what still works" | the declared outcome (`capability-unavailable`, `operation-unpublished`, ...) and its owner |
| switching | one control, remembered per user, never modal | the same control; switching creates no hidden state |

Rules:

- Advanced detail is the progressive disclosure of `AI_UX_PROGRESSIVE_DISCLOSURE.md`, not a second
  screen: nothing is computed only for advanced users, and beginners are never denied information
  they need in order to act.
- A beginner never sees a raw identifier, a vendor name used as a capability, or a count presented as
  exact when its source is `estimated`.
- An advanced user sees no more than the declaration allows: the advanced view may show *that* a
  capability is missing, never an invented implementation detail behind it.
- Mode changes presentation only — never behaviour, permissions, budgets or approvals.
- The default stays simple. A feature that only makes sense in advanced mode is still documented in
  both, with the advanced description naming the declaration it reads.

## 13. AI Foundation — what it is, and what it is not

One AI Foundation serves **AI Assistant, AI Copilot, AI Node, Agent Machine, the Execution AI mode
and every external runtime adapter**. There is never a separate AI engine per experience.

| It is not | Because |
| :--- | :--- |
| the agent loop | the loop belongs to a runtime behind `ai.agent-runtime` |
| a model vendor | models arrive through `ai.model-gateway`, from a provider |
| MCP itself | MCP is an edge interop adapter mapped onto the tool gateway |
| an external agent runtime | external runtimes stay external and replaceable |
| a filesystem or terminal implementation | those are workspace-scoped capabilities |
| a memory database | memory is its own LEGO (`XA-21`); context is not memory |

The frontend consumes the AI Foundation's declarations and renders their state. It never assumes an
implementation exists behind them: the whole `ai.*` family is **contract-only**.
