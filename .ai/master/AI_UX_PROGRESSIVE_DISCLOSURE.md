# AI UX — progressive disclosure

**Status:** specification. **Owner:** agent-01. Companion to
`AI_UI_EXPERIENCE_MASTER_PLAN.md` (surfaces) and `AI_FRONTEND_CONTRACT_MATRIX.md` (contracts).

The rule this document enforces: **the user sees a conversation, an outcome and a next action — not
a control room.** Everything technical is one deliberate step away, and none of it is ever in the
main flow by default. Ten permanent panels is the failure mode this design exists to prevent.

---

## 1. The five levels

| Level | Name | Placement | Cost | Contains |
| :--- | :--- | :--- | :--- | :--- |
| **L0** | Line | the message or trace row itself | already rendered | prose, or one operational row (`Understand`, `Decision`, `Artifact`, `Completed`) |
| **L1** | Chip | inline, after the line | one small fetch or a derived count | `· 8 tokens`, `Context 61%`, `Skills 3 active`, `Memory 12 relevant`, `Agents 5`, `Capabilities 7` |
| **L2** | List | the open tab, drawer or popover | one scoped request | the list a chip summarizes (messages, trace rows, agents, artifacts, capabilities, decisions) |
| **L3** | Details | advanced section inside L2 | a second scoped request, on demand | runtime identity/health/cost, MCP servers and tools, session mechanics, usage breakdown, memory graph, workspace tree |
| **L4** | Source | a link out | none in the UI | the canonical declaration, the contract, the module, the decision record |

**Default state is L0 + L1.** A surface opens at L2 at most, keeps L3 collapsed, and only ever
*links* to L4.

## 2. Surface by surface

| Surface | L1 (always visible) | L2 (one gesture) | L3 (advanced) | L4 (link) |
| :--- | :--- | :--- | :--- | :--- |
| Chat message | text + `· 8 tokens` | per-message actions (copy, open artifact, apply) | usage breakdown (Message/Context/Output/Total/Source) | the artifact, the decision |
| Context | `Context 61%` | Used, Budget, Remaining, Session, Previous session, Continuation | Memory loaded, Tools loaded, reserved output, rollover state | `ai.context` declaration |
| Session | `Session 03` | continuity (`Continuation linked`) + window | session mechanics (index, started/updated, continuation chain) | `ai.agent-session` |
| Skills | `Skills 3 active` | active skill list | one skill: procedure, capabilities, validators, references, token budget, version | skill contract (when published) |
| Memory | `Memory 12 relevant` | relevant items by kind (project, decision, task, artifact, GitHub reference) | `Open Memory Graph` | the decision/artifact records |
| Agents | `Agent: Working` / `Agents 5` | agent tree | one agent: task, status, runtime, workspace, skills, capabilities, artifacts, token usage | `ai.agent-delegation` |
| Trace | the newest row | the row list (bounded, virtualized) | decision card detail (id, timestamp, agent, task, selected option, alternative refs, reason summary, evidence, risk, approval state) | `ai.agent-events` |
| Files / artifacts | `1 artifact` | artifact list with per-kind preview | compare, checksum, retention, owner, storage reference | the artifact itself |
| Approval | `⚠ Approval required` | the approval card: Action, Scope, Risk, Reason, `Deny` / `Review & Approve` | who requested it, the decision it belongs to | `ai.approval` |
| Capabilities | `Capabilities 7` | grouped list with `read`/`write`/`patch`/`execute` per group and a source label | permissions, interaction class, transport eligibility, migration state | the capability contract |
| MCP | capability first, `— MCP` | relationship state | server, transport, health, tools loaded, availability | the MCP mapping rule |
| Runtime | `Runtime · Remote · Connected` | kind, version, availability, supports | locality, resource cost, health history | `runtimeMetadata` |
| Workspace | `Workspace · project-name` | status, runtime, terminal state, file tree | scope boundaries | the workspace declaration |
| Node creator | `Create with AI` | the six-step flow | validation detail per step | `node-registry` operations |
| Translation | `Language · Bahasa Indonesia` | response language, `Auto`, `Translate response` | which parts were translated | the locale set |
| Status bar | one line | expands the segment that was clicked | the surface behind it | the declarations it projects |

## 3. Loading rules (lazy, scoped, cancellable)

1. **Nothing above L1 is fetched at boot.** Opening a tab fetches that tab's scope; expanding a row
   fetches that row's detail. Closing discards and unsubscribes.
2. **One subscription per open surface.** Agent state, trace and approvals arrive as events
   (`ai.agent-events`). There is no interval polling; a closed surface holds no subscription.
3. **Counts before lists.** A chip is a count from data already loaded; it must not trigger the
   list it summarizes.
4. **Expand in place.** L3 renders inside the surface that opened it, so the user keeps the context
   they were reading; L4 opens a new view and never replaces the conversation.
5. **Cancellable and idempotent.** Every load is cancellable, and re-opening a surface reuses the
   last result until the declaration changes.
6. **Bounded everywhere.** Trace rows are capped at the declared capacity with a visible
   dropped-count and virtualized; artifacts, memory items, MCP tools and agent trees page instead
   of loading whole; a long list never renders more than its viewport plus a small margin.

## 4. What is never rendered, at any level

| Never | Why | Instead |
| :--- | :--- | :--- |
| chain-of-thought, reasoning transcripts, "thinking" text | not a contract, not the user's business; the plan forbids storing it | `decision.reasonSummary`, `decision.evidenceRefs`, trace rows |
| raw prompts and system messages | they carry credentials and private context | the declared `messageKey` + parameters, the operation, the scope |
| credentials, tokens, API keys, headers | leaking one is unrecoverable | never accepted, never stored, never rendered |
| unredacted tool payloads and full model output | unbounded size and unbounded risk | `payloadRef`, artifact preview per kind |
| the complete memory store | unusable and private | `Memory 12 relevant` + `Open Memory Graph` |
| every MCP tool of every server | hundreds of rows nobody asked for | capability first; tools on demand under L3 |
| a full session transcript in one payload | memory and attention cost | windowed rows, referenced by `sequence` |
| provider/vendor names as fields | vendor lock in the vocabulary | vendor names are *data* — an example, a label — never a contract field |
| colour-only status | accessibility defect | word + icon + colour |

## 5. Presentation budgets (guidance, enforced by review)

| Element | Budget | Note |
| :--- | :--- | :--- |
| L0 line | one sentence, ≤ 280 characters in a trace summary | the trace field limit, quoted from `agent-events.mjs` |
| L1 chip | ≤ 4 words | a chip is a fact, not a sentence |
| L2 list | first page ≤ 25 rows | page, do not append forever |
| Trace | declared capacity (200 rows) with drop counting | virtualized |
| L3 block | no nested scroll inside a scrolling panel | one scroll container per surface |
| Boot descriptor | unchanged, 18,126 B JSON (budget 32 KB) | the AI layer is never in the boot payload |
| Copy | message key + parameters | no hard-coded sentences; see the accessibility document |

## 6. Expanding into chat

A user who wants prose rather than widgets types a question instead of expanding a tree. Every
surface therefore has an action that *hands its context to the chat* (`Ask about this`, `Explain
this row`, `Why was this denied?`), which seeds the Copilot with the current scope and the selected
reference. That is the escape hatch that keeps L3 genuinely optional: no surface needs to become a
dashboard, because the conversation can always explain it.
