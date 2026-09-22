<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../PROJECT_WORKFORCE_ORCHESTRATION.md`](../PROJECT_WORKFORCE_ORCHESTRATION.md). Where the two disagree on a *number*, the canonical
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

# Project workforce orchestration

**Status:** specification (governance). **Owner:** manager; this document records the model so a new
worker agent does not need the historical chat. **It defines no runtime** — the workforce is humans and
coding agents, not the product's Agent Machine. The machine-readable source for governance is
`docs/engineering-operations/workforce-governance.json`; for milestone status, boundaries and the
merge gate it is `docs/n8n-lego/milestones.json` (both outside the product manifests on purpose).

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

## 8. Milestone reconciliation and the merge gate

> Canonical source: `docs/n8n-lego/milestones.json#policy.mergeProtocol`, restated in
> `docs/engineering-operations/workforce-governance.json#milestoneMergeGate`. This section is the
> reading order for a worker; the register is what a test checks. The same rule applies to P2.13,
> P2.14 and every later milestone — it is governance, not product architecture, so no manifest or
> product contract may reference it.

**Agent completion is NOT merge approval.** "My branch is complete" means: the assigned
implementation is complete, its focused tests pass, the branch is internally consistent and its
evidence is published. It says nothing about whether the branch may be merged. An agent branch is
not the milestone; the reconciled, verified state on protected main is.

### 8.1 The sequence

1. agent-1 complete (frontend tests + evidence)
2. agent-2 complete (backend tests + evidence)
3. **manager reconciliation** — compare both branches against the *same* main baseline, inspect the
   shared contract surface, detect drift and conflicts, verify dependency assumptions, run the
   cross-agent alignment tests, regenerate `.ai` if required, verify documentation and status
4. **RECONCILIATION PASS**
5. merge into protected main
6. **post-merge verification** — same expected tree, same contract lock, same generated `.ai` state,
   tests pass on main HEAD
7. milestone status = `complete`

Two gates, not one: **RECONCILIATION PASS** means the two agent outputs are mutually consistent and
compatible with the architecture; **MERGE PASS** means the reconciled state passed the required
validation against the *actual* target main. "The branches were reconciled" is not "the milestone is
complete" — treating them as one gate is the failure mode this protocol exists to prevent.

### 8.2 What reconciliation checks

| Check | Rule |
| :--- | :--- |
| baseline | BASE = current protected main. Both branches are understood as BASE + agent-1 changes and BASE + agent-2 changes — never "merge whichever arrives first". |
| contract authority | backend contract → canonical schema / operations / errors / permissions → frontend consumer. The manager verifies agent-1 did not redefine anything agent-2 owns, and that the frontend is not a parallel interpretation of the same concept. |
| architecture drift | duplicate LEGO domains, duplicate contracts, renamed concepts diverging from canonical vocabulary, future-scope components implemented early, accidental runtime dependencies, new authority or permission paths, hidden coupling, architecture decisions made implicitly in code. |
| test reconciliation | agent-1 focused tests PASS, agent-2 focused tests PASS, shared contract tests PASS, cross-agent alignment PASS, full relevant suite PASS. **The last two are the gate; the first two are not sufficient.** |

### 8.3 Conflict taxonomy

| # | Kind | Example | Action |
| :-- | :--- | :--- | :--- |
| 1 | mechanical | the same file changed compatibly, an import or path conflict, formatting, a generated-artifact collision | the manager resolves it directly |
| 2 | contract | different field names, different operation names, different enum values — backend says `paused`, frontend expects `suspended` | **not** a normal merge conflict: the contract is reconciled first, then the code follows it |
| 3 | architecture | one agent assumes Memory exists, one implements state that belongs to Memory, a second context registry appears | an architecture decision is recorded and ruled **before** merging |
| 4 | scope-violation | Agent Machine execution inside a Context & Session milestone, a Memory store created, runtime integration appearing early, Rust started without authorization | **do not merge that scope** — not "merge now and clean it up later" |

On failure the state is **RECONCILIATION_FAILED**, recorded on the milestone row with six things:
the conflict, the affected contract, the affected agent, the reason, the required decision and the
blocking test. Then agent correction → reconciliation again. Never a silent merge, and never a merge
of a locked-contract disagreement.

**Merge authority:** only the manager turns agent branches into product state on main. Agents do not
merge to main, do not force-push, and do not reset another agent's branch to make a tree look
synchronized. A worker that believes a conflict is mechanical says so and waits; it does not resolve
a contract or architecture conflict by editing the other side's declaration.

## 9. What makes a handover good

A worker's report must let the next agent continue **without the chat**: what changed and why, which
declarations were read and at which commit, what was tested and with which command, what was *not*
tested, what is blocked and who owns the blocker, and the next concrete step. Since P2.13 it also
names the milestone it worked on and the register row that records it
(`docs/n8n-lego/milestones.json`), so a report can be reconciled against the canonical status instead
of against a chat transcript.
