# L0 — Constitution

Hard rules for any agent or contributor touching this repository. If a task
appears to require breaking one of these, the task is mis-specified: stop and
raise it, do not work around it.

## 1. Boundaries that do not move

- **Rust is LOCKED.** No Rust migration, no Rust edits outside an explicitly
  assigned Rust task.
- **The stock editor UI is not redesigned.** The pinned bundle
  (`n8n-editor-ui@2.9.4`) renders exactly as before; the frontend LEGO adds
  descriptor metadata, never markup or styles.
- **Vue stays the reference implementation.** No React, no Svelte, no Web
  Components migration, no second framework.
- **Dependencies point inward:** component → frontend contract → compatibility /
  API boundary → public backend contract. A frontend module never imports backend
  internals; a backend domain never imports frontend internals.
- **No HTTP between local LEGO.** Communication is in-process or through the
  existing REST boundary — never a service call invented for convenience.
- **No new services, daemons, brokers or heavyweight frameworks** for the
  frontend LEGO. Every runtime dependency must justify its cost.
- **`main` stays runnable and green.** Never push to `main`; work on the assigned
  branch and open a PR.

## 2. What is out of scope until explicitly assigned

Hermes, Search, Accessibility implementation, Theme implementation, AI Assistant,
Node Registry, Workflow/Execution/Auth/Credentials features, microservices, a
dynamic plugin loader, an autonomous AI editing system. Architecture work
*prepares* for these; it never implements them.

**Universal Translation is no longer on this list.** It is an official AI/Agent
LEGO target (`.ai/master/TRANSLATION_PLAN.md`, decision A-2), it is still
unimplemented, and it is still blocked on a publishing contract (XA-14) — a target
is not a licence to build. The same applies to the other fourteen official
AI/Agent LEGO: `.ai/master/AI_AGENT_LEGO_MASTER_PLAN.md` records which are
published, which are `contract-only`, and which are `publicationPending`.

## 3. The LEGO rules

1. A LEGO exists only with: meaningful identity, owner, contract, version,
   dependency boundary, test boundary, lifecycle and upgrade path.
2. Components, buttons, icons, helpers and ordinary framework files are **not**
   LEGOs — they are internals of whatever unit owns them.
3. Depth is bounded: domain → feature → sub-feature. Nothing deeper.
4. A child unit cannot bypass an ancestor's restrictions, cannot be more trusted
   than its parent, and cannot import a sibling's private area. Sibling
   communication happens through published ports only.
5. A parent may compose its children's public contracts; it may never reach into
   their internals.
6. Upgrades are atomic: no half-applied hierarchy, no stale registry state, no
   partial activation. A breaking upgrade is refused until the dependents
   acknowledge it by name.
7. Declared ≠ installed ≠ loaded ≠ active. Registering metadata must never require
   loading implementation code.
8. Contracts are transport-neutral and framework-neutral: they do not encode Vue,
   HTTP verbs, DOM structure or display text.
9. Errors are identified by **semantic codes** (`credential.not_found`,
   `frontend.registry.upgrade-blocked`). Display text is presentation, produced by
   a translation layer later.
10. Optional capabilities are never mandatory: a missing optional feature degrades
    along its declared fallback. A missing **core** capability fails loudly — it is
    a broken instance, not a degraded one.

## 4. Ownership

| Area | Owner |
| ---- | ----- |
| Frontend architecture, compatibility boundary, UI capability registry, frontend regression gates | agent-01 (this LEGO) |
| Backend LEGO foundation, backend capability registry, backend error codes | agent-02 |
| Workflow / Execution / Auth / Credentials / Node Registry / Storage / Rust | their own agents — not this LEGO |
| Integration gates (`tests/integration/boundary_audit.py`, `tests/compatibility/contract_conformance.mjs`) | agent-05 — read-only for everyone else |

Shared files (`package.json`, root config, CI workflows, global registries, shared
schemas) change minimally and the change is recorded for the other agents.
Capability ids, error codes and contract versions crossing the frontend/backend
line are **coordinated**; an ambiguous shared contract stops for Manager/Integrator
arbitration rather than being invented twice.

## 5. Truth rules

- Report evidence, not intentions: name the command and its result.
- An honest gap beats a fake green. If something cannot be verified from this
  environment (a browser, egress), say so and route it to CI.
- A pack, manifest or document that disagrees with the code is a defect in the
  document; the tests that keep them aligned are part of the architecture.
