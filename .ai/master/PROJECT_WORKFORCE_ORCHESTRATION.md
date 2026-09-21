# Project workforce orchestration

**Status:** specification (governance). **Owner:** manager; this document records the model so a new
worker agent does not need the historical chat. **It defines no runtime** — the workforce is humans and
coding agents, not the product's Agent Machine.

---

## 1. Two worlds, kept separate

| | **Product/runtime agents** | **Development workforce agents** |
| :--- | :--- | :--- |
| Act on | user workloads inside n8n | the repository (n8n LEGO itself) |
| Examples | Agent Machine, AI Node, Hermes / Claude Code / Gemini CLI / OpenClaw adapters | Arena Manager, Arena workers, agent-01 (frontend), agent-02 (backend) |
| Contract | `ai.agent-runtime`, `ai.agent-delegation`, `ai.agent-events` | branch + task + job protocol (this document) |
| Authority | the user's policy, per delegation | project governance, per assignment |
| Lifecycle | create → start → … → close | assign → work → test → evidence → commit → report |

Never mix them: a workforce agent must not appear in a product capability, and a product agent must
not be given repository authority.

## 2. Source of truth

- **GitHub** is authoritative for code, branches, commits, PRs, review and history. No wiki, vault,
  chat, local note or database is a second code registry.
- A **control plane** (where one exists) holds *state*: job/task status, agent coordination, worker
  state, task claims, orchestration metadata, evidence references. It never duplicates git history,
  and "the control plane is operational" is never claimed when the activation it needs is absent
  (`KNOWN_BLOCKERS.md B-12`).
- **This repository** is the durable memory: `.ai/master/` is written for exactly that purpose.

## 3. Roles

**Manager** — plans work, routes tasks, owns cross-domain integration, arbitrates architecture, manages
GitHub (branches, PRs, protection), manages job/task state, coordinates build/test infrastructure,
resolves ownership questions, reviews contracts, coordinates merges, owns external-runtime policy and
workforce governance.

**Worker** — enters the assigned branch, reads the repository state (`.ai/` pack, then the relevant
`.ai/master/` document), reads the current task, understands the owner and boundary of the area,
performs the work, runs the relevant gates, records evidence, commits, reports status. A worker does
not self-select unrestricted work when an assignment system exists.

**Authority is not inherited.** Nesting a worker under a manager does not confer manager authority —
the same principle as `ai.agent-delegation.authorityRule` in the product. A worker's scope is its
assigned branch, assigned task, workspace, permitted capabilities and test execution.

## 4. Job and task model

A **job** contains **tasks**. Every task carries: task id · job id · owner · status · scope ·
dependencies · blockers · evidence · branch · expected outputs · validation gate. If a task moves to
another job, its state changes **explicitly** — a task's job is never silently reinterpreted. A broad
task may nominate a lead/orchestrator only if the manager protocol allows it. Ownership is partitioned
so that two workers cannot destructively edit the same artifact; shared files change minimally and are
documented.

## 5. The worker protocol (what a new agent does)

1. **Read** `.ai/README.md` → `.ai/constitution.md` → the level the task needs (card / index /
   recipe) → the relevant `.ai/master/` document for a design task.
2. **Locate the owner** of the area being changed. If the change crosses an owner boundary, it is not
   a worker decision.
3. **Change minimally** inside the assigned paths; never touch another agent's branch, never rewrite
   another agent's work to make a tree look synchronized, never force-push `main`.
4. **Reconcile, don't adopt**: another agent's declarations are *read*; only a recorded decision or an
   explicit contract change makes them adopted.
5. **Test**: run the relevant gate(s) — architecture tests, conformance, evidence, audit, and the
   project's verification commands. A gate that cannot run is reported as *not run*, never as passed.
6. **Record**: update the decision register if a decision was made; update the pack/index if a
   declaration changed; add a blocker row if a blocker was discovered.
7. **Commit** on the assigned branch with an honest message, push it, and **report** what was added,
   what remains open, and which authoritative source owns each unresolved question.

## 6. Build/test gate (a controlled capability boundary)

Trusted execution is a **capability**, not a shell. What the gate exposes, and what it does not:

| Concern | Rule |
| :--- | :--- |
| gate health | a gate that cannot run is reported as *not run* — never as passed (`KNOWN_BLOCKERS.md B-10`) |
| allowed operations | the declared build / test / format / check commands and the project's gate scripts — nothing else |
| workspace boundary | the repository inside the sandbox; no path outside it, and no unrestricted host filesystem |
| authentication boundary | the environment's own authentication; a credential is never carried inside a task, a prompt or a payload |
| secret sanitization | credentials stay outside agent-visible payloads wherever possible; a gate result reports outcomes, never secrets |
| manager / worker policy | a worker may request the declared operations; changing the gate's policy is a manager decision |
| remote execution | an explicit lifecycle (requested -> running -> finished/failed -> collected); only artifacts and results return |
| audit | every execution is attributable: who asked, which branch, which command, which result |

A worker reports **gate results**, never gate credentials, and never edits the gate to make a run
green.

## 7. Handover between agents

Cross-agent work is reconciled through **declarations**, not through conversation:

1. The owning agent publishes (registry entry, contract row, module constant).
2. The consuming agent quotes it with provenance and records the version it read.
3. Where the consumer needs something unpublished, it records an **open decision** with owner, current
   interpretation, blocking level and evidence — and fails closed until it is published.
4. A merge is preceded by the manager's review; a protected branch is never written directly.

`docs/n8n-lego/decisions/cross-agent-decisions.json` is the machine-readable register; nothing in a
branch may close a Manager-owned row.

## 8. What makes a handover good

A worker's report must let the next agent continue **without the chat**: what changed and why, which
declarations were read and at which commit, what was tested and with which command, what was *not*
tested, what is blocked and who owns the blocker, and the next concrete step.
