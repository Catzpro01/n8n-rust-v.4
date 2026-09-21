# Workspace and external actions

**Status:** planning. **Published:** domain `workspace` exists (`planned`, contract `0.0.0`,
`workspace.projects` **unsupported**); agent-scoped sandbox semantics are **XA-13**.
**Nothing in this document is an implementation.**

---

## 1. What a workspace is

A workspace is **where the action occurs**: a scoped place with an explicit boundary, a runtime
binding and observable state (`Workspace · project-name`). It is not a folder the UI points at, and it
is never "the host filesystem".

The frontend may render a workspace only when a declaration exists: project name, status, runtime,
terminal state, file tree (paged). Otherwise the surface renders `feature-unsupported` with the reason.
**No UI implies unrestricted host access, and none renders a host path.**

## 2. External actions

The declared action families (documentation-level names; publication status per row):

| Family | Actions | Publication |
| :--- | :--- | :--- |
| filesystem | `read`, `write`, `patch`, `list`, `move`, `delete` | capability names; XA-13 for agent-scoped scope |
| terminal / process | `execute`, `start`, `stop`, `status` | as above |
| project | `create`, `open`, `scaffold`, `build`, `test`, `preview`, `archive` | as above |
| browser | `open`, `inspect` | as above |
| git | `status`, `diff`, `commit`, `branch`, `push` | as above |
| github | `search`, `create_pr` | `ai.application-provider` (published) |

Every action passes, in order: **identity -> capability -> permission -> policy -> workspace scope ->
approval (where required) -> resource budget -> audit/event recording**.

## 3. Security invariants for actions

1. **No unrestricted host access by default.** A workspace boundary is mandatory for filesystem and
   terminal execution; a plan that says "the agent can use the shell" is incomplete without the scope.
2. **Destructive actions are declared.** `sideEffects` (`read-only`, `writes`, `destructive`,
   `external`) is required on every tool; an undeclared value is treated as destructive.
3. **Approval where policy says so**, failing closed: expired or unanswered = denied. Destructive and
   irreversible actions do not batch approvals.
4. **Secrets never reach a payload.** No action requests, stores, renders or forwards credential
   material; the UI never displays an environment variable or a key.
5. **Partial work is reported as partial.** A failed apply, a half-written tree or an interrupted build
   is never rendered as success.

## 4. Reference flow (website creation, abbreviated)

`Understand -> Plan -> select Skills -> create Workspace -> create project -> delegate UX / frontend /
content / testing -> build -> browser inspect -> fix -> test -> review -> GitHub PR (optional deploy)
-> artifacts -> memory update -> Obsidian projection -> Work Trace completion.`

Capabilities involved: filesystem, terminal, browser, build, test, git, github. Skills: web
development, accessibility, SEO, GitHub. Agents (possible): research, UX, frontend, backend, QA,
review. The flow stays **contract-compatible with the general Agent Machine** — no parallel
mechanism, no second vocabulary. Full scenarios: `REFERENCE_AGENT_SCENARIOS.md`.

## 5. Terminology note

The "AI Workspace" concept from the AI/Agent LEGO list **binds to this existing domain** (A-3). A new
`ai-workspace` domain would duplicate a core domain and is forbidden by the project's own rules
(`PROJECT_MASTER_PLAN.md §4`).
