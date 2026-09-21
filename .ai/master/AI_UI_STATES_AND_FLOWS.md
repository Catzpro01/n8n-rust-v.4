# AI UI — states and flows

**Status:** specification. **Owner:** agent-01. Companions: `AI_UX_PROGRESSIVE_DISCLOSURE.md`
(what is visible) and `AI_FRONTEND_CONTRACT_MATRIX.md` (what is read).

Two rules hold this document together:

1. **Every surface renders all ten states.** A surface that only has a happy path is not finished.
2. **A missing answer is never a guess.** The UI shows the canonical outcome it was given —
   including "I cannot verify this" — and never invents availability, a count, a status or a cost.

---

## 1. The ten states

| # | State | Canonical source | What the user sees |
| :--- | :--- | :--- | :--- |
| 1 | `normal` | `available` / `agentSessionState: running` | the surface's content |
| 2 | `empty` | nothing declared, nothing loaded | one sentence explaining what would appear here + the action that produces it |
| 3 | `loading` | request in flight | the surface's skeleton, same layout as `normal`, no spinner-only blanks |
| 4 | `error` | `frontend.*` error code | what failed, what was preserved, a retry, and the code in L3 (never the stack) |
| 5 | `unavailable` | `capability-unavailable`, `optional-absent` | the capability is not here; if `optional-absent`, this is not an error and says so |
| 6 | `degraded` | `degraded` (+ the declared reduction) | the reduced guarantee in words ("answers may be shorter; tools still work") |
| 7 | `permission-denied` | `operation-denied`, `permission-missing`, `permission-unknown` | which grant is missing, and that the surface is not going to work around it |
| 8 | `approval-required` | `ai.approval` (`pending`) | Action, Scope, Risk, Reason, `Deny` / `Review & Approve`; the work is paused, not failed |
| 9 | `responsive` | viewport | the layout per breakpoint (`AI_UI_EXPERIENCE_MASTER_PLAN.md` §3.2) |
| 10 | `accessibility` | keyboard, screen reader, locale, colour | reachable, labelled, announced, RTL-correct, never colour-only |

Additional canonical outcomes that must stay distinguishable wherever an operation is attempted:
`version-incompatible`, `dependency-disabled`, `migration-required`, `feature-unsupported`,
`operation-unpublished`. Each has its own sentence; none may be folded into "unavailable".

## 2. Coverage matrix

`✓` = the surface renders this state today (by specification). Blank is a defect to fix before the
surface ships.

| Surface | empty | loading | error | unavailable | degraded | denied | approval | responsive | a11y |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| AI Assistant | ✓ | ✓ | ✓ | ✓ (no provider) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copilot · Chat | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copilot · Trace | ✓ | ✓ | ✓ | ✓ (no events) | ✓ | ✓ | ✓ | ✓ (virtualized) | ✓ |
| Copilot · Agents | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copilot · Files | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (apply gate) | ✓ | ✓ |
| Copilot · More rows | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Context chip & panel | ✓ | ✓ | ✓ | ✓ (no session) | ✓ | ✓ | — | ✓ | ✓ |
| Session line | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Skills | ✓ | ✓ | ✓ | ✓ (XA-20) | ✓ | ✓ | ✓ (skill action) | ✓ | ✓ |
| Memory | ✓ | ✓ | ✓ | ✓ (XA-21) | ✓ | ✓ | — | ✓ | ✓ |
| Capabilities | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (permission) | ✓ (write action) | ✓ | ✓ |
| Approval | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MCP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (`permission-required`) | — | ✓ | ✓ |
| Runtime | ✓ | ✓ | ✓ | ✓ (none connected) | ✓ | ✓ | — | ✓ | ✓ |
| Workspace | ✓ | ✓ | ✓ | ✓ (XA-22) | ✓ | ✓ | ✓ (destructive ops) | ✓ | ✓ |
| Node creator | ✓ | ✓ | ✓ | ✓ (XA-15) | ✓ | ✓ | ✓ (install) | ✓ | ✓ |
| Translation | ✓ | ✓ | ✓ | ✓ (XA-23) | ✓ | ✓ | — | ✓ | ✓ |
| Token & usage | ✓ | ✓ | ✓ | ✓ (`estimated`) | — | — | — | ✓ | ✓ |
| Status bar | ✓ (idle) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (blocked) | ✓ | ✓ |

Two states deserve their exact wording:

- **Zero-install (state 5, not an error).** `AI Foundation ready · no provider configured`. The
  canonical declaration is `zeroInstall` (`aiFoundation: ready`, providers `not-configured`) and
  the reported outcome is `capability-unavailable` with reason *no inference provider configured*.
  The UI must never show an error banner for a valid installation, and must never fake an answer.
- **Approval required (state 8, a pause).** The trace row and the agent tree both carry the
  approval state, so a paused run is never confused with a slow one.

## 3. Flows

Each flow lists its steps, the canonical outcome that can interrupt it, and what the user sees at
that point. Bold outcomes are the ones that must not be collapsed.

### 3.1 Ask the Assistant (`GLOBAL`)

1. User opens the global entry (or the shortcut) → surface mounts in `loading`.
2. Session: `ai.agent-session.create` → `sessionId`; scope `GLOBAL`.
3. Context: `ai.context.load` with the declared scope; the chip shows used/budget.
4. Request: `ai.model-gateway.generate` / `stream` with the declared permission
   (`ai:model:invoke`). No provider configured → **`capability-unavailable`** (zero-install copy).
5. Answer streams; the message carries `· n tokens` with `source: reported | estimated`.
6. If the answer proposes an action → `ai.decision.record` + `ai.approval.request`
   (state 8) before anything is applied.

### 3.2 Copilot in a workflow (`WORKFLOW` → `NODE`)

1. Panel opens with the canvas context (`workflow.inspect`), scope `WORKFLOW`.
2. Descending into a node seeds scope `NODE` and the node's declared facts; the chip reflects it.
3. Operations offered are the capability's published `operations[]`; an operation the capability
   does not publish → **`operation-unpublished`** and the UI does not guess that it exists.
4. A mutation is a workflow operation (`workflow.patch` / `workflow.validate`) behind an approval
   card; the canvas shows the change only after it is applied.

### 3.3 Delegate to an agent (`ai-agent-node`)

1. Node executes → `ai.agent-runtime.create`/`start`, `ai.agent-delegation.delegate`.
2. Trace rows arrive as events; the agent tree fills in as children are created.
3. A child receives **only** its `grantedCapabilities` — the UI never shows an inherited permission
   because there is none (`authorityRule`: a delegation is a subset of its parent's authority).
4. Cancellation is offered only if the runtime's `supports.cancellation` is true; otherwise the
   action is absent with a reason, not disabled silently.

### 3.4 Approve or deny

1. `ai.approval.request` → status bar shows `⚠ Approval required`, the trace row shows `approval`.
2. The card shows Action, Scope, Risk, Reason; **deny** resolves the decision as rejected and the
   run stops cleanly; **approve** resumes it.
3. Expired or unanswered → `denied` (fail-closed). The UI says the request expired; it never
   assumes consent.

### 3.5 Apply an artifact

1. Files tab shows the artifact with a kind-appropriate preview (`patch`, `diff`, `log`, `report`,
   `screenshot`, `file`, `model-output`, `simulation-result`).
2. `Apply` (or `Revert`) is a write action → approval when the declaration says so.
3. Failure keeps the previous state visible and reports which step failed; a partial apply is
   reported as such, never as success.

### 3.6 Context rollover (`NORMAL` → `PREPARE` → `ROLLOVER`)

1. At `NORMAL` the chip shows a percentage; no interruption.
2. `PREPARE` announces a rollover in the status bar and offers `Continue session` when the work is
   at a natural boundary.
3. `ROLLOVER` compacts (`context.compact`), emits `context.compacted`, and the session line shows
   `Session 04 · Continuation linked`. The conversation continues; the user never sees a raw error
   because a window filled.

### 3.7 Provider absent, runtime offline, capability unsupported

| Situation | Outcome shown | Never |
| :--- | :--- | :--- |
| no provider configured | `capability-unavailable` — "AI Foundation ready · no provider configured" | an error banner, a retry loop, a fake answer |
| runtime unreachable | `runtime.unavailable` event + `degraded` on the affected surfaces | silently switching to another runtime |
| capability marks the operation `feature-unsupported` | `feature-unsupported` (the 501 path through the compatibility layer) | hiding the operation without explanation |
| version drift | `version-incompatible` with the two versions named | adapting silently |
| migration needed | `migration-required` with the migration named | running anyway |

## 4. Fail-closed rules (the UI's half of the contract)

1. An unknown capability, operation, permission, interaction class, transport or event type is
   refused **by name**, in the surface that needed it.
2. A count, status or cost with no declared source is shown as `estimated` or not shown.
3. A write action with no declared approval rule does not run: it asks.
4. A paused (approval) or expired run is never rendered as completed.
5. An AI surface never blocks the editor: if the AI layer is unavailable, the canvas, the node
   editor and the workflow operations keep working with zero AI.

## 5. Determinism

- Ordering is `(timestamp, sequence)` for trace rows and `createdAt` for artifacts — never
  insertion order of a network response.
- The same declaration + the same event stream renders the same state; nothing depends on load
  order, locale or viewport.
- Re-rendering a surface does not re-request what it already has; a refresh is explicit and
  cancels the previous request.
