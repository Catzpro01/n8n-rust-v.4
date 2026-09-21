# `.ai/` — the machine-readable architecture pack

This directory is how an AI agent (or a new human) understands this repository
**without reading the source**. It is deliberately small: a pack that needs to be
read in full has failed, because the point is to retrieve *only* the context a task
needs.

The pack is written for the **frontend LEGO** (`ui-frontend`) and lives at the
repository root so other domains can add their own subdirectory (`backend/`,
`translation/`, …) without restructuring anything.

## Context levels — load only what the task needs

| Level | Load | Answers | Size budget |
| ----- | ---- | ------- | ----------- |
| **L0** | `constitution.md` | What is forbidden, who owns what, which boundaries are hard | ≤ 6 KB |
| **L1** | `frontend/card.md` | How the frontend LEGO is built, where things live, how boot works | ≤ 8 KB |
| **L2** | `index/contracts.json` (+ the contract file it names) | What a contract promises, who consumes it, what it may not encode | per contract |
| **L3** | `cards/recipes.md` → one recipe | The exact steps and commands for a task shape | ≤ 8 KB |
| **L4** | the source file itself | Implementation detail the pack does not restate | — |

Rules of retrieval:

1. Start at L0. Never skip it — the constitution holds the hard stops.
2. A task that touches the frontend adds L1.
3. A task that changes or consumes a contract adds L2 for **that contract only**.
4. A task with a known shape (add a unit, change a hook, upgrade a version, run the
   gates) adds the single recipe it matches.
5. Open L4 source only when the answer is genuinely implementation detail.
6. Never load the whole pack, and never paste it into a prompt wholesale.

## What is here

```
.ai/
  README.md              this file (L0 entry point, level table, retrieval rules)
  constitution.md        L0 — hard rules, ownership, boundaries, forbidden work
  frontend/
    card.md              L1 — the frontend domain card: modules, boot, surfaces, budgets
    glossary.md          vocabulary: LEGO, sub-LEGO, surface, port, hook, capability, state…
  index/
    capabilities.json    machine-readable capability index (declared, criticality, trust, activation)
    contracts.json       machine-readable contract index (owner, version, consumers, status)
    units.json           machine-readable sub-LEGO index (hierarchy, ports, tests, versions)
  cards/
    decisions.md         decision cards: what was decided, why, what it rules out
    recipes.md           L3 task recipes with exact commands
  maps/
    dependencies.md      dependency and impact maps (unit → deps, surface → backend, capability → units)
```

## Keeping the pack true

The packs in `index/` are **checked against the manifests** by
`packages/frontend-lego/test/12-knowledge.test.mjs`. If a unit, capability or
contract changes and the index is not updated, that test fails with the exact
difference — the pack cannot silently rot into fiction.

The pack is metadata. It never carries implementation, and no runtime code reads it
at boot: the browser receives the boot descriptor and nothing else.
