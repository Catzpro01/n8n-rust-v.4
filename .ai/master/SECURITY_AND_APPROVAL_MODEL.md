# Security and approval model

**Status:** specification. **Owner:** agent-01 for the frontend/UI half; the backend half is
agent-2/manager-owned (`ai.foundation@1.0.0` security rules, `auth.identity@1.0.0`).
This document states the **invariants** every AI surface of this project obeys. It grants nothing and
implements nothing.

---

## 1. The ten invariants

| # | Invariant | Where it holds |
| :-- | :--- | :--- |
| 1 | **Nesting does not grant authority** | a child agent receives a subset of its parent's grants (`ai.agent-delegation.authorityRule`); the UI shows a child's own grants only |
| 2 | **Delegation does not imply permission inheritance** | the same rule; the delegation node carries `grantedCapabilities`, never an inherited set |
| 3 | **Unknown fails closed** — capability, operation, permission, owner, transport, event type, interaction class | `negotiation.mjs` (12 outcomes), `vocabulary.mjs` (undeclared term refused by name), conformance rules A1–A26 |
| 4 | **Credentials never enter ordinary envelopes** | a declaration or event carrying credential material is refused; no AI surface accepts, stores, renders or forwards a key |
| 5 | **No large or secret payloads in summaries** | trace carries `summary` (≤ 280 chars) + `references` (`payloadRef`, `artifactRef`, `decisionRef`), never payload bodies |
| 6 | **External runtimes are not automatically trusted** | runtime declarations carry availability, locality and supports; the UI never auto-selects a remote runtime |
| 7 | **MCP is not automatically trusted** | MCP concepts map onto the tool gateway; exports are explicit; tools are called through declared operations with declared permissions |
| 8 | **Destructive actions require explicit policy** | `sideEffects` is required on every tool (`read-only`, `writes`, `destructive`, `external`); unknown is treated as **destructive** |
| 9 | **Approval requirements fail closed** | `ai.approval`: an expired or unanswered request resolves as **denied**; the seven declared categories (execute workflow, modify credential, change system setting, delete resource, push code, merge PR, send external message) always ask |
| 10 | **Workspace boundary is mandatory** | filesystem/terminal actions are scoped to a declared workspace; no surface implies unrestricted host access and none renders a host path |

## 2. Approval: the human gate

An approval is a first-class object (`ai.approval`): `approvalId`, `action`, `actor`, `risk`
(`low|medium|high|critical`), `requestedAt`, `resolvedAt`, `decision`
(`granted|denied|expired`), `reason`. Behaviour that follows:

- **Ask before acting**, never after: a proposed change is a decision with an approval state, and the
  work pauses at the card (Action / Scope / Risk / Reason · `Deny` / `Review & Approve`).
- **A pause is not a failure.** The status bar shows `⚠ Approval required`; the trace row and agent
  tree carry the approval state, so a paused run is never confused with a slow one.
- **No permanent dashboard.** The card appears where the work is (chat, trace, status bar) and
  disappears when resolved; approval status stays visible in the trace.
- **Deny is clean.** A denied decision stops the run; a partially applied change is reported as
  partial, never as success.
- **Approval is not permission.** An approval does not grant a capability the caller never had; an
  inherited grant does not exist, so there is nothing to inherit.

## 3. Capability and permission

Capability = *what can be done* (a declared, versioned contract with operations). Permission = *who
may invoke it* (a declared name, e.g. `ai:model:invoke`). Policy = *under which conditions*
(approval, budget, workspace scope, resource profile). A surface renders the missing grant
(`permission-missing`, `permission-unknown`, `operation-denied`) and never works around it.

## 4. External actions

Every action that leaves the chat passes, in order: **identity → capability → permission → policy →
workspace scope → approval (where required) → resource budget → audit/event recording.** Actions
declared by the project include filesystem (`read`, `write`, `patch`, `list`, `move`, `delete`),
terminal/process (`execute`, `start`, `stop`, `status`), project (`create`, `open`, `scaffold`,
`build`, `test`, `preview`, `archive`), browser (`open`, `inspect`), git (`status`, `diff`, `commit`,
`branch`, `push`), GitHub (`search`, `create_pr`). **None of them is unrestricted by default**, and
none of them exists in this frontend branch as an implementation: they are declared capability names,
several of them `publicationPending` (XA-8, XA-22, XA-15).

## 5. Observability layers stay separate

System logging (technical runtime events) · Agent Event (semantic lifecycle, 26 types) · Work Trace
(human-readable operational progress, 200-row bound) · Execution result · Artifact · Decision. They
are never merged into one giant log stream, and none of them carries reasoning: the trace records
**what happened**, the decision records **what was chosen, with evidence and risk**.

## 6. No chain-of-thought, ever

The project must never create a storage system whose purpose is to persist private model reasoning.
Stored: decision summaries, evidence references, selected actions, risk, approval state, artifacts,
operational events. **Not stored, not rendered, not logged**: hidden reasoning traces, raw prompts,
system messages, unredacted tool payloads. A "thinking" panel is a defect, not a feature —
`AI_UX_PROGRESSIVE_DISCLOSURE.md §4` is the frontend half of this rule, `ai-foundation.json`
`privacyRule` is the backend half.

## 7. What a security review checks

1. Every new surface consumes only a declared seam input, and every refusal is by name.
2. Every new action names its capability, permission and approval requirement — or it does not ship.
3. Every payload path is a reference; no blob, no secret, no transcript.
4. Every state in `AI_UI_STATES_AND_FLOWS.md` exists for the new surface, including
   `permission-denied` and `approval-required`.
5. Nothing claims a guarantee the declarations do not make.
