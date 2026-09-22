# XA-19 — the Skill vocabulary, side by side

**Status:** arbitration package (agent-1, frontend). **Decision owner:** manager.
**Register row:** `docs/n8n-lego/decisions/cross-agent-decisions.json` → `XA-19`.
**Measured:** 2026-09-22, baseline `c1f8ca21` (this branch) vs agent-2 `729bb112` (P2.12).

This is the evidence a reader needs to decide `XA-19` without fetching anything: what the frontend
quotes, what the backend published, what agrees, what differs, and what each choice costs. Nothing
here is a decision, and nothing here changes a declaration.

## 1. The three declarations in play

| # | Declaration | Where | State |
| :- | :--- | :--- | :--- |
| 1 | The **quoted** Skill vocabulary | `packages/frontend-lego/src/vocabulary.mjs` (5 sets), read from `apps/n8n-lego/src/lego/manifest/ai-lego-set.json#id=skill` at the baseline | quoted, `publicationPending`, decision `XA-11` |
| 2 | The **LEGO-level** block in agent-2's P2.12 tree | `manifest/ai-lego-set.json#id=skill` (`status: implemented`, `versioning: ai.skill@1.0.0`) | published in the manifest, no lock row |
| 3 | The **contract manifest** from agent-2's P2.12 tree | `manifest/skill.json` (`contract: ai.skill`, `version: 1.0.0`) | published in the manifest, no lock row |

`contracts/contract-lock.json` has **14 rows in both trees** and **no `ai.skill` row in either** — the
quoted contract is unpublished on both sides. That is why the frontend renders the canonical
unsupported state today, and why it must not adopt words from the other two files before they are
locked.

## 2. What agrees (checked, not assumed)

| Field | Quoted (1) | P2.12 (2 + 3) |
| :--- | :--- | :--- |
| Contract id | `ai.skill` | `ai.skill` |
| Lifecycle states | `registered, available, selected, loaded, active, released` | identical |
| Disclosure levels | `L0, L1, L2, L3` | identical |
| Permission words | `ai:skill:read`, `ai:skill:select` | identical |
| Degradation | `available`, `optional-absent` | identical (`available`, `optional-absent`) |
| Status vocabulary | `aiLegoStatus` (`implemented, contract-only, planned, blocked, deferred`) | identical words, different value (`planned` → `implemented`) |

The six states and the four disclosure levels are the part the frontend renders most, and they do not
move. Nothing in this arbitration touches them.

## 3. What differs (four registrations, both directions)

| Vocabulary id | Quoted (1) | Declared in P2.12 | Shape of the move |
| :--- | :--- | :--- | :--- |
| `skillOperation` | `register, list, describe, select, load, release` | `list, resolve, describe, validate-selection` | drops `register, select, load, release`; adds `resolve, validate-selection` |
| `operations` (LEGO block) | `register, list, describe, select, load, release` | `list, resolve, describe, validate-selection` | same move at the block level |
| `versioning` | `publicationPending` | `ai.skill@1.0.0` | a version claim without a lock row |
| `aiFoundationCapability` | the `ai-foundation` capability list without `ai.skill` | list **with** `ai.skill` (`status: implemented`) | a new capability inside an existing domain |
| `aiPermission` | the AI Foundation permission set | plus `ai:skill:read`, `ai:skill:select` | two words arriving in a second vocabulary |

The quoted vocabulary is 43 sets (33 contract-pinned, 10 `publicationPending`); all 43 are compared.
The frontend reports these as data (`declarationDrift()`: field, quoted value, declared value, both
directions, owner, alignment decision) and the two alignment gates accept a difference **only** while
`XA-19` is in the register and still open (`test/29` `REGISTERED_DRIFT`, `test/31` drift test). An
unregistered difference fails both gates; adopting a word fails the drift rules. There is no third
state in which a word is quietly taken.

## 4. What the difference means, read carefully

* `resolve` and `validate-selection` are new *callable* operations. They are read-shaped: both are
  idempotent `call`s with `ai:skill:read` / `ai:skill:select`, and neither executes a procedure.
* `register`, `select`, `load`, `release` disappear **as operations**. Five of the six lifecycle
  states remain, so `selected`, `loaded` and `released` are still *states* — what the P2.12 contract
  drops is the claim that a caller invokes them by name. In the contract's own words: *"Selection of
  a skill grants nothing"* and *"lazy discovery is a contract requirement"*; the body loader is
  reachable only through `load`, and `load` is not a published operation in this revision.
* The permission namespace is unchanged in spelling (`ai:skill:read`, `ai:skill:select`) — the
  `aiPermission` drift is the two words appearing inside the AI Foundation's permission set. Which
  namespace owns them is `XA-8`, still open; this row does not decide it.
* No word in either version grants a permission, an authority, a tool, a filesystem, a terminal or a
  model, and no version implies execution. The frontend's refusals (`permissions`, `grants`,
  `authority`, `tools`, `filesystem`, `terminal`, `model`, `entry`, `load`, `execute`) hold against
  both.

## 5. Options for the manager

**A — lock the P2.12 shape (recommended).** Publish `ai.skill@1.0.0` in `contracts/contract-lock.json`
(owner `manager`), keeping the six lifecycle states, the four disclosure levels and the two
permission words, and confirm the four operations `skill.list`, `skill.resolve`, `skill.describe`,
`skill.validate-selection` as the canonical list. The frontend then makes **one** reconciliation
commit: the quoted sets move to the locked values, the `REGISTERED_DRIFT` entries are deleted, the
drift gates assert `in-sync`, and the Skill catalog stops rendering the unsupported state — while
still offering discovery only (`select`, `load`, `execute`, `tools` remain `false`; every declared
operation stays `offered: false`).
*Why this one:* it is the only option under which a real implementation exists behind the words —
`skill.mjs` is shipped and tested in agent-2's tree — and it keeps the frontend from quoting a
planning draft that describes an API nobody built.

**B — keep the planning shape.** Revert the P2.12 declarations to `register, list, describe, select,
load, release` and `publicationPending`. The frontend keeps quoting the words it already has.
*Cost:* it contradicts code that exists and is tested (`skill.list`, `skill.resolve`, `skill.describe`,
`skill.validate-selection`), and it re-opens every consumer of `manifest/skill.json`.

**C — do nothing.** The difference stays registered and both gates stay green-but-informed: the
frontend renders the canonical unsupported state, no skill is listed, and `XA-19` remains the record.
*Cost:* the Skill surface stays dark in the product even though the backend registry is implemented;
the drift entry becomes permanent furniture in the gate, which is how a registered difference rots
into a tolerated one.

## 6. What the frontend does in each case (no new work either way)

| Case | Discovery | Per-skill answer | Gates |
| :--- | :--- | :--- | :--- |
| A | lists skills from the locked declaration | `available` / `version-incompatible` / `dependency-disabled` / `capability-unavailable`, per the declarations | `in-sync`, no drift entries |
| B, C | empty catalog (`optional-absent`) | `capability-unavailable` + `lego.capability_unavailable`, decision `XA-11` | drift registered against `XA-19`, both gates green |

There is no case in which the UI selects, loads, releases, executes or reaches a tool, and no case in
which it grants or displays a permission it holds. That is rule `A27` and §19.18, and it does not
depend on how the manager decides.

## 7. How to re-measure this package

```bash
git archive 729bb112 | tar -x -C /tmp/a2p12           # agent-2's P2.12 tree
N8N_BACKEND_LEGO_ROOT=/tmp/a2p12/apps/n8n-lego/src/lego \
  node --test packages/frontend-lego/test/29-alignment.test.mjs packages/frontend-lego/test/31-skills.test.mjs
# → 22/22, 0 skipped: every difference in §3 is reported, registered and still open
```

---

## 8. Resolution (P2.12 finalize, 2026-09-22)

**Outcome: option A.** The manager adopted the implemented P2.12 shape, and agent-2 published it:

| | |
| :--- | :--- |
| Contract | `ai.skill@1.0.0` — `contract-lock.json`, owner `manager`, domain `ai-foundation`, status `implemented` |
| Published operations | `skill.list`, `skill.resolve`, `skill.describe`, `skill.validate-selection` |
| Not published | `skill.register`, `skill.select`, `skill.load`, `skill.release` — internal registry lifecycle methods |
| Execution | no execute operation and no `ai:skill:execute` permission at any layer |
| Backend reference | `arena/01a0c521-n8n-rust-v-4 @ d0a338e4` |
| Register | `XA-19` → `resolved`; `XA-11` stays `open-for-manager` for the modelling question only |

**What the frontend changed to consume it.**

- `src/vocabulary.mjs`: the four Skill sets are quoted as published by `ai.skill@1.0.0` (pinned
  version + owner from the lock row, no `publicationPending` record); `skillOperation` is the four
  caller operations; `aiFoundationCapability` gains `ai.skill` and `aiPermission` gains the two
  `ai:skill:*` words. The AI set's own maturity vocabulary stays unpublished and keeps its record.
- `src/skills.mjs`: `SKILL_CONTRACT_VERSION` and `SKILL_OPERATION_NAMES` (the lock's spelling) are
  quoted next to the declaration's verbs; `manifest/skills.json` carries the verified `publication`
  row; a `versioning` string in either spelling (`1.0.0` or `ai.skill@1.0.0`) is in sync with the
  quoted version, anything else is a difference.
- `test/29-alignment.test.mjs`: `REGISTERED_DRIFT` is **empty** — no difference is tolerated now.
  The machinery stays, and a tolerated difference would still have to name an open registered row.
- `test/31-skills.test.mjs` (19 tests): the lock row is asserted (version, owner, status, domain, the
  four operations, the two permissions); `register`/`select`/`load`/`release`/`execute` are refused
  in both spellings; discovery never calls a body loader; a difference is still reported as data.
- Evidence: **56/56** (`docs/n8n-lego/evidence/frontend-boundary-p25.json`), boot payload unchanged at
  18,126 B.

**Measurement.** `N8N_BACKEND_LEGO_ROOT=<published tree> node --test test/29-alignment test/31-skills`
→ **27/27 pass, 0 skipped, Skill drift = 0**. On a branch whose backend copy predates the lock row,
test/29 states which three sets it deferred (`aiFoundationCapability`, `aiPermission`,
`skillOperation`) instead of reporting a pass it did not perform; a pointed-at tree without the row
is a failure, never a skip.
