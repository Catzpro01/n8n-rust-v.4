<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../REFERENCE_AGENT_SCENARIOS.md`](../REFERENCE_AGENT_SCENARIOS.md). Where the two disagree on a *number*, the canonical
> document wins: its figures are generated from the manifests at build time,
> whereas this view was hand-written against backend baseline `6f7b66da` (P2.10)
> and is **not** updated by regeneration.
>
> Known differences at the time of reconciliation: XA-5 is **closed** (the eleven
> `lego.*` codes are published), the operation count is **not 173**, and gate rules
> run through **F17**.
>
> This banner deliberately names no live totals. Counts move every phase (P2.12
> published `ai.skill` and added an error code), and a correction notice that
> hardcodes them goes stale exactly like the text it corrects. For current
> figures read the generated [`CURRENT_STATUS.md`](../CURRENT_STATUS.md) and
> [`AI_CONTRACT_MATRIX.md`](../AI_CONTRACT_MATRIX.md), which are derived from
> the manifests; where this snapshot disagrees with them, they win.
>
> It is preserved because it carries frontend reasoning, UX consequences and
> cross-agent reconciliation notes that no backend manifest derives.

# Reference agent scenarios

**Status:** specification (canonical examples). **Owner:** agent-01 for the frontend narrative;
contracts referenced are manager/agent-2-owned. Every scenario below is **contract-compatible with the
general Agent Machine** (`AGENT_MACHINE_PLAN.md`) — none of them invents a second mechanism, a second
engine or a second vocabulary. Scenarios are planning; nothing here runs today.

---

## 1. "Create a company website." (multi-agent, full loop)

**Flow.** Understand -> Plan -> select Skills -> create Workspace -> create Project -> delegate UX ->
delegate frontend -> delegate content -> delegate testing -> build -> browser inspect -> fix -> test ->
review -> GitHub PR -> optional deployment -> artifacts -> memory update -> Obsidian projection -> Work
Trace completed.

**Capabilities:** filesystem (`read`, `write`, `patch`, `list`), terminal (`execute`), browser
(`open`, `inspect`), project (`build`, `test`, `preview`), git (`status`, `diff`, `commit`, `branch`,
`push`), github (`search`, `create_pr`).
**Skills (XA-11):** web-development, accessibility, SEO, GitHub.
**Possible agents:** research, UX, frontend, backend, QA, review — all children of one Main agent,
each with its own granted capabilities, workspace, artifacts and budget.

**What the user sees.** A conversation, a status bar (`● Agent Working │ Session 03 │ Context 61% │
3 Skills │ 2 Agents`), a trace of operational rows, artifacts as references (a preview, a diff, a
screenshot, a test report), an approval card before anything destructive, and one final line:
`✓ Completed │ 1 artifact │ 0 approvals │ 4,218 tokens`.

**What the user never sees.** Chain-of-thought, raw tool payloads, credentials, the workspace's host
paths, or a hundreds-of-tools MCP dump.

## 2. "Why did this workflow fail?" (Execution AI = Copilot mode)

**Flow.** Load workflow context -> identify the failed execution -> inspect the failed node -> inspect
the event/error -> retrieve relevant memory -> analyze -> create a decision summary -> propose a fix ->
approval if required -> modify -> test -> artifact -> report.

**Scope:** `EXECUTION`, then `EVENT` for the failing event. **No fourth engine:** Execution AI is the
Copilot with a seeded scope, and `Analyze Execution` is the same entry point as `Ask AI` with a
different context. The decision summary carries evidence references and a risk level; the fix is a
workflow operation behind an approval, and the canvas changes only after it is applied.

## 3. Multi-agent coding (research -> build -> test -> review)

Main -> Research -> Builder -> Tester -> Reviewer, with shared **task state, capability boundaries,
workspace, artifacts, memory, work trace and budget**. Parallel branches stay independently
observable; the join happens only after the declared conditions are satisfied. Every child shows its
own grants; nothing is inherited; a denied approval stops that branch cleanly while the others report
their own state.

## 4. Node creation

Describe -> select a creation method -> generate -> validate -> test -> conformance -> package ->
preview -> approval if needed -> install. **Artifacts:** generated source, test result, manifest,
documentation. Validation never bypasses the published workflow validation; Rust/WASM is never the
default; installation is a write action (`NODE_CREATOR_PLAN.md`).

## 5. External runtime

Agent Machine -> Runtime Adapter -> Hermes / Claude Code / Gemini CLI / OpenClaw. The runtime stays
external and replaceable; n8n keeps ownership of task, policy, workspace boundary, approval, artifact
references, event normalization, the context contract and resource accounting. A runtime that cannot
cancel says so; the UI shows no cancel action rather than a lie.

## 6. Memory and Obsidian projection

A meaningful decision is made -> the decision, its evidence, its artifact, its task and its
relationships are stored in the memory graph (XA-12) -> Obsidian receives a human-readable projection
-> a later Copilot retrieves the decision **without loading the entire vault**. The graph is the
source; the vault is a view (`MEMORY_GRAPH_OBSIDIAN_PLAN.md`).

## 7. Token accounting and context rollover

Message arrives -> accounting distinguishes **message** (1 token), **model input** (1,847), **output**
(8) and **total**, with `source: reported | estimated` -> the Context Manager observes `NORMAL` -> at
the prepare threshold it moves to `PREPARE` -> a continuation package is built -> context is compacted
-> the next session/window is created -> `continuation.linked` -> objective, constraints, pending
actions, decisions, artifact references and permissions are restored and verified -> work continues.

**The user experiences one continuous conversation** (`Session 04 · Continuation linked`), never a
truncated one and never an error because a window filled.

## 8. Where the two agent worlds meet (and where they must not)

Scenarios 1–7 are **product** agents (`ai.agent-runtime` contracts). The workforce that builds n8n
LEGO is a different world with different authority (`PROJECT_WORKFORCE_ORCHESTRATION.md §1`): it uses
branches, tasks and gates, not agent sessions, and it never appears in a product capability list.
