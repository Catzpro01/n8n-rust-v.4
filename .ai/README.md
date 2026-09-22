# `.ai/` — the machine-readable architecture pack

How an agent (or a new human) understands this repository **without reading the
source**. Deliberately small: a pack read in full has failed — retrieve only what a task
needs. Written for the **frontend LEGO** (`ui-frontend`); other domains may add their own
subdirectory (`backend/`, `translation/`, …).

`.ai/master/` is **not part of this pack**: it holds the master project memory (domains,
AI/Agent LEGO, context, tokens, agents, security, phases, status, blockers), loaded on
purpose through `productContextFor()` and budgeted separately.

## Context levels — load only what the task needs

| Level | Load | Answers | Size budget |
| ----- | ---- | ------- | ----------- |
| **L0** | `constitution.md` | What is forbidden, who owns what, which boundaries are hard | ≤ 6 KB |
| **L1** | `frontend/card.md` | How the frontend LEGO is built, where things live, how boot works | ≤ 8 KB |
| **L2** | `index/contracts.json` (+ the contract file it names) | What a contract promises, who consumes it, what it may not encode | per contract |
| **L3** | `cards/recipes.md` → one recipe | The exact steps and commands for a task shape | ≤ 8 KB |
| **L4** | the source file itself | Implementation detail the pack does not restate | — |

Rules of retrieval:

1. Start at L0 — the constitution holds the hard stops. Never skip it.
2. A task that touches the frontend adds L1.
3. A task that changes or consumes a contract adds L2 for **that contract only**.
4. A task with a known shape (add a unit, change a hook, upgrade a version, run the gates)
   adds the single recipe it matches.
5. Open L4 source only for implementation detail.
6. Never load the whole pack, never paste it into a prompt wholesale.

## What is here

```
.ai/
  README.md  constitution.md            this file; L0 hard rules and forbiddens
  frontend/  card.md  glossary.md       L1 domain card; vocabulary
  index/     capabilities.json  contracts.json  units.json
  cards/     decisions.md  recipes.md   decisions; L3 task recipes with commands
  maps/      dependencies.md            dependency and impact maps
```

## Keeping the pack true

The indexes in `index/` are **checked against the manifests** by
`packages/frontend-lego/test/12-knowledge.test.mjs`: if a unit, capability or contract
changes and the index does not, that test fails with the exact difference. The master set
has its own gate, `test/30-master-plan.test.mjs`; the pack budget is 80 KB total and per
level, so growth is a decision, not a side effect.

The pack is metadata: no runtime reads it at boot, and the browser receives the boot
descriptor and nothing else.
