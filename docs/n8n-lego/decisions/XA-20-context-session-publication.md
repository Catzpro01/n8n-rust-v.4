# XA-20 — Context & Session: what is published, and what the frontend must render as pending

**Status:** `open-for-manager` · **Blocking level:** milestone (blocks P2.13 completion; blocks P2.14+)
**Register row:** `docs/n8n-lego/decisions/cross-agent-decisions.json#decisions[id=XA-20]`
**Affected domains:** `ai-foundation`, `frontend`
**Measured against:** `main @ e754c5df35b41b0ff2ac769519f05f056835411c` (the P2.13 baseline) and
`arena/01a0c6b4-n8n-rust-v-4` (the agent-1 frontend branch). Every number below was read from the
tree, not remembered; §7 shows how to re-measure.

> **2026-09-22 UPDATE — §1–§6 below describe the pre-publication state and are kept as measured.**
> Agent-2 has since executed **Option A** on `arena/01a0c6b5-n8n-rust-v-4 @ fb254f32`: both lock rows
> published, five context operations registered, and the phase machine and verification results
> declared in `manifest/ai-foundation.json`. Agent-1's branch (`e9648997`) now **quotes that
> publication** — `PENDING_PUBLICATIONS` is empty, 55 quoted sets — and the row stays **open** because
> the publication is on a peer branch, not on protected main, and because the backend still disagrees
> with itself about two continuation sections. Read **§9** for the current state and the five items
> still required from the manager.

The question, in one line: **`ai.context` and `ai.agent-session` are declared at four places and
locked at none — so which vocabulary is the frontend allowed to render, and what must it keep
saying "pending" until the manager publishes it?**

---

## 1. The declarations in play

| # | Source | What it declares | Publication weight |
|---|--------|------------------|--------------------|
| 1 | `apps/n8n-lego/src/lego/manifest/ai-foundation.json#context` | `contract: "ai.context"`, the rule ("hierarchical and selectively loadable"), **7 scopes**, **9 fields**, `selectiveLoadRule`, `compactionRule` | Foundation manifest. No version, no lock row. |
| 2 | `apps/n8n-lego/src/lego/manifest/ai-foundation.json#agentSession` | `contract: "ai.agent-session"`, the rule ("identity plus references"), **10 fields**, **3 references**, **7 states**, `sizeRule` | Foundation manifest. No version, no lock row. |
| 3 | `apps/n8n-lego/src/lego/manifest/domains.json#domains[id=ai-foundation].capabilities` | `ai.context` **contract-only** — operations `load`, `compact`; permissions `ai:context:read`, `ai:context:write`. `ai.agent-session` **contract-only** — operations `create`, `status`, `close`; permissions `ai:agent:create`, `ai:agent:read`, `ai:agent:control` | Domain registry, contractVersion 1.1.0. Registers ids, not versions. |
| 4 | `apps/n8n-lego/src/lego/manifest/ai-lego-set.json#lego[id=context-session]` | status `contract-only`; `versioning: "ai.context@1.0.0, ai.agent-session@1.0.0"`; **6 lifecycle states** `declared, active, prepare, compacting, rolled-over, closed`; **14 continuation sections**; **5 operation verbs** `load, compact, rollover, rehydrate, verify`; `rolloverRule` (a threshold, never at the limit); `distinction` (5 concepts); `nonScope` (not persistent memory, no transcripts); `tests: ["test/lego-ai-foundation.test.mjs", "planned: rollover, rehydration fidelity"]` | A **claim**. A version string in a manifest is not a contract-lock row. |
| 5 | `apps/n8n-lego/src/lego/manifest/reference-scenarios.json#scenarios[id=context-rollover]` | `status: contract-only`; **3 token kinds** (`message`, `modelInput`, `output`) with meanings; `rolloverRule`; `failureRule` ("if rehydration fails, surface the failure — a silently degraded session is worse than a visible one") | Prose + an object map. Quotable, unregistered. |
| 6 | `apps/n8n-lego/src/lego/contracts/contract-lock.json` | **15 rows**: `compat.http, lego.error-contract, lego.domain-registry, kernel.platform, reference.lego, lego.contract-compat, reference.validation, reference.validation.schema, reference.repository, auth.identity, lego.envelope, lego.interaction, lego.negotiation, ai.foundation, ai.skill` | The only source that *publishes* a contract version. **No `ai.context` row. No `ai.agent-session` row.** |
| 7 | Manager brief, *P2.13 Context & Session* (2026-09-22), §B2–§B6 | The ruled shapes: `ai.context@1.0.0`, `ai.agent-session@1.0.0`, the phase machine `NORMAL → PREPARE → ROLLOVER`, the continuation package, and verification `verified / degraded / failed` | A ruling. It states what the architecture *is*; it does not itself add a lock row. |

---

## 2. What agrees (checked, not assumed)

- **The scopes.** 7 in `ai-foundation.json#context.scopes`, 7 in the brief, 7 quoted by the
  frontend: `GLOBAL, WORKFLOW, NODE, EXECUTION, EVENT, AGENT, TASK`. No difference.
- **The context fields.** 9 in the declaration, 9 in the brief, 9 quoted:
  `contextId, scope, parent, snapshot, version, source, dependencies, size, checksum`.
- **The session fields, references and states.** 10 + 3 + 7 in `agentSession`, identical in the
  brief, identical in the frontend quotes. The seven states are exactly
  `created, running, waiting, paused, completed, failed, cancelled`.
- **The five concepts stay five.** `ai-lego-set.json#lego[id=context-session].distinction` and the
  brief both say Conversation ≠ Session ≠ Context window ≠ Memory ≠ Execution, and the frontend
  refuses a record that merges them.
- **The rollover rule.** "Never wait for the exact context limit" is stated in the AI set, repeated
  in the reference scenario, and enforced by the frontend: a threshold at or above 100% is refused.
- **Bounded state.** `agentSession.sizeRule` ("a transcript inside it would make session size grow
  without limit") and `nonScope` ("no transcripts") agree with the frontend refusal of an inlined
  payload and of a chain-of-thought section.
- **The 14 continuation sections** in the AI set are the 14 the frontend quotes, including the
  spelling `refs` — the brief's prose word "references" is *not* a published spelling and is not
  used as one.

So there is **no vocabulary conflict**. The gap is entirely about **publication**: what exists as a
declaration versus what exists as a locked, versioned contract the frontend may render a version
for.

---

## 3. What differs — the publication gap, row by row

| Vocabulary | Where it exists today | Lock row? | Frontend treatment | Needs a ruling? |
|---|---|---|---|---|
| `ai.context@1.0.0` | claimed in `ai-lego-set.json#versioning`; id registered in `domains.json` | **no** | quoted fields/scopes/operations/permissions; version rendered as `declaredVersion`, never as a published version | **yes** |
| `ai.agent-session@1.0.0` | claimed in `ai-lego-set.json#versioning`; id registered in `domains.json` | **no** | same | **yes** |
| 7 scopes, 9 fields, 7 states, 10 fields, 3 references | `ai-foundation.json` | n/a (fields are not rows) | quoted with provenance `ai-foundation.json#context` / `#agentSession`, `contract: null` | no — quotable now |
| 2 context operations (`load`, `compact`) + 3 session operations (`create`, `status`, `close`) | `domains.json` capabilities | **no** | quoted; **none offered by the UI** | no |
| 5 permissions (`ai:context:read/write`, `ai:agent:create/read/control`) | `domains.json` | **no** | quoted; the surface grants nothing | no |
| 6 context lifecycle states (`declared, active, prepare, compacting, rolled-over, closed`) | `ai-lego-set.json#lifecycle` | **no** | quoted with `publicationPending: XA-20` | **yes** (quote-with-pending, or promote into the foundation manifest) |
| 14 continuation sections | `ai-lego-set.json#continuationPackage` | **no** | quoted with `publicationPending: XA-20` | **yes** |
| 5 operation verbs (`load, compact, rollover, rehydrate, verify`) | `ai-lego-set.json#operations` | **no** — and only 2 of the 5 are registered as operations in `domains.json` | quoted; `rollover`/`rehydrate`/`verify` are answered `operation-unpublished` | **yes** (are the last three operations at all?) |
| 3 token kinds (`message`, `modelInput`, `output`) | `reference-scenarios.json#tokenKinds` | **no** | quoted with `publicationPending: XA-17` | XA-17, not XA-20 |
| **`NORMAL → PREPARE → ROLLOVER`** | **the brief only.** No backend file declares a phase machine; `ai-foundation.json#context` has no `lifecycle` and no `rollover` key | **no** | `PENDING_PUBLICATIONS`, rendered as pending | **yes** |
| **`verified / degraded / failed`** | **the brief only** (`reference-scenarios.json#failureRule` states the *rule*, not the three words) | **no** | `PENDING_PUBLICATIONS`, rendered as pending | **yes** |
| `ai.memory.*`, `ai.agent-runtime.*`, `continue`, `pause`, `resume` | nowhere | no | refused as unpublished; `pause`/`resume` belong to `ai.agent-runtime` | no — must stay absent |

Two of those rows are the ones that actually block the milestone: the **phase machine** and the
**verification results**. Everything else is quotable today and only needs a lock row for the
frontend to render a version number.

Note the near-miss that must not be papered over: the backend *does* publish lifecycle words that
describe a rollover — `prepare`, `compacting`, `rolled-over` — while the brief rules a three-state
machine named `NORMAL`, `PREPARE`, `ROLLOVER`. These are two vocabularies for one behaviour, in
different cases, with different granularity (6 states vs 3 phases). The frontend renders the
published words and reports the ruled phases as pending, with an explicit mapping
(`PREPARE → prepare`, `ROLLOVER → compacting → rolled-over`, `NORMAL → no published word`). It does
not silently treat them as synonyms, because a rename decided in a UI is a rename nobody ratified.

---

## 4. What the difference means, read carefully

1. **A claim is not a publication.** `versioning: "ai.context@1.0.0, ai.agent-session@1.0.0"` in a
   manifest is exactly the kind of string that turns into a rendered "v1.0.0" badge six months
   later, with no row behind it. The frontend therefore renders `declaredVersion` and keeps
   `version: null` until a lock row exists.
2. **Contract-only is a real status, not a placeholder.** Both capabilities are registered
   `contract-only`, the LEGO is `contract-only`, and the reference scenario is `contract-only`. P2.13
   shipping without a runtime is consistent with the baseline; what is *not* consistent is a UI that
   renders a rollover button for an operation nobody registered.
3. **Three declared verbs have no operation.** `rollover`, `rehydrate` and `verify` appear in
   `ai-lego-set.json#operations` but not in `domains.json` capabilities. Until that is reconciled,
   `Continue session`, `rehydrate` and `verify` are answered `operation-unpublished` — a declared
   outcome of the interaction vocabulary, not an invention.
4. **The pending list is a promotion trigger, not a permanent state.** `PENDING_PUBLICATIONS` is
   checked by `packages/frontend-lego/test/32-context-session.test.mjs`: if the backend ever
   declares `NORMAL/PREPARE/ROLLOVER` or `verified/degraded/failed` as one enumeration, the test
   fails until the frontend quotes it. Pending cannot outlive publication.
5. **XA-12 stays separate.** Publishing `ai.context` must not imply a Memory store. Memory is what
   survives context replacement; context is what is loaded now. The frontend refuses any record
   carrying a `memory` payload and names the fifth concept as absent.
6. **P2.14+ all consume this vocabulary.** Memory, Token & Usage and Agent Machine each take a
   `contextRef` / `sessionId` and each would render a lifecycle or a usage figure. Leaving the gap
   open pushes the same question into three later milestones, where it will be answered three
   different ways.

---

## 5. Options for the manager

**Option A — publish both rows and declare the two missing vocabularies (recommended).**
Add `ai.context@1.0.0` and `ai.agent-session@1.0.0` to `contracts/contract-lock.json` (owner
`manager`, domain `ai-foundation`, status `contract-only` or `implemented` as the tests justify,
with the 5 operations and 5 permissions already registered in `domains.json`), and add to
`ai-foundation.json#context` two keys the frontend can quote:
`rolloverPhases: ["NORMAL","PREPARE","ROLLOVER"]` and `verificationResults: ["verified","degraded","failed"]`
(plus, if the manager prefers one vocabulary over two, an explicit mapping from phases to the six
lifecycle states already declared).
*Consequence:* `PENDING_PUBLICATIONS` empties, the manifest's `publication.rows` fills, the surface
reports `published`, and the promotion test in §7 goes green without a code change. P2.14+ inherit a
quotable vocabulary.

**Option B — publish the two rows only.**
Lock both contracts, and leave the phase machine and the verification results as brief-level rules.
*Consequence:* the frontend renders a version and `published: true`, but keeps two pending sets and
keeps rendering `prepare`/`compacting`/`rolled-over` instead of `NORMAL`/`PREPARE`/`ROLLOVER`, and
keeps answering verification as pending while still computing the three results locally for display.
Cheap now; the same question returns at P2.14 (Memory) and at Phase D (Token & Usage).

**Option C — split the pair.**
Lock `ai.agent-session@1.0.0` now (its states, fields and references are fully declared in
`ai-foundation.json` and need nothing new) and defer `ai.context@1.0.0` until the rollover
declaration exists.
*Consequence:* the surface becomes half-published: `published` stays `false` because the pair is one
LEGO, but the session half renders a version. The frontend already supports this shape — contract
state is computed per contract — though the manifest must then record one row, not two.

**Option D — ship P2.13 contract-only (status quo).**
No rows, no new declarations.
*Consequence:* the frontend keeps everything pending, `availability: capability-unavailable` with
nothing handed over, and P2.13 completes as a vocabulary-and-presentation milestone only. This is a
legitimate outcome and it is what the branch does today; it must be recorded as such in the register
so nobody later reads "P2.13 complete" as "Context & Session published".

**Not an option:** the frontend coining the phase names or the verification results locally to make
the UI look finished. That is drift with a good story attached, and `test/29-alignment.test.mjs`
keeps `REGISTERED_DRIFT` empty precisely so it cannot happen quietly.

---

## 6. What the frontend does in each case (no new work either way)

The surface derives its state; it does not hardcode it. Under **A**, the same code reports
`published: true`, renders the locked versions, quotes the two new sets (they move out of
`PENDING_PUBLICATIONS` into the vocabulary lock with provenance pointing at
`ai-foundation.json#context.rolloverPhases` / `.verificationResults`), and the manifest's
`publication.rows` records the two rows. Under **B/C/D** nothing changes in the code — only the
manifest's `publication.status` and the register row's status move.

The one edit that is required under A/B/C is bookkeeping, not behaviour: fill
`packages/frontend-lego/manifest/context-session.json#publication.rows` and flip `status` to
`published`, because `test/32` asserts the manifest and the lock agree.

---

## 7. How to re-measure this package

```bash
# the lock: 15 rows, and neither contract among them
node -e "const r=require('./apps/n8n-lego/src/lego/contracts/contract-lock.json');const x=Array.isArray(r)?r:r.contracts;console.log(x.length, x.map(e=>e.id).join(', '))"

# what is declared, and what is only claimed
node -e "const f=require('./apps/n8n-lego/src/lego/manifest/ai-foundation.json');console.log(Object.keys(f.context),Object.keys(f.agentSession))"
node -e "const s=require('./apps/n8n-lego/src/lego/manifest/ai-lego-set.json');const c=s.lego.find(l=>l.id==='context-session');console.log(c.status,c.versioning,c.lifecycle.length,c.continuationPackage.length,c.operations.join(','))"
node -e "const d=require('./apps/n8n-lego/src/lego/manifest/domains.json');const a=d.domains.find(x=>x.id==='ai-foundation');console.log(a.capabilities.filter(c=>/^ai\.(context|agent-session)$/.test(c.id)).map(c=>[c.id,c.status,c.operations.join('|'),c.permissions.join('|')].join(' :: ')).join('\n'))"

# the frontend's own report: quoted sets, pending sets, pending rows
cd packages/frontend-lego && node -e "import('./index.mjs').then(m=>console.log('quoted',m.CONTEXT_SESSION_QUOTED_VOCABULARIES.length,'pending',m.PENDING_PUBLICATIONS.map(p=>p.id).join(','),'rows',m.PENDING_CONTRACT_ROWS.map(r=>r.contract).join(',')))"

# the gate that fails if the backend publishes what is still pending (or if it drifts)
npm run frontend-lego:test -- --test-name-pattern "pending vocabulary is promoted"
node --test packages/frontend-lego/test/29-alignment.test.mjs packages/frontend-lego/test/32-context-session.test.mjs

# the same frontend suite pointed at the PEER tree — the only honest way to compare two branches
mkdir -p /tmp/peer && git archive origin/arena/01a0c6b5-n8n-rust-v-4 apps/n8n-lego/src/lego | tar -x -C /tmp/peer
N8N_BACKEND_LEGO_ROOT=/tmp/peer/apps/n8n-lego/src/lego node --test packages/frontend-lego/test/*.test.mjs

# both observations at once: runs, quoted-set counts, divergences, scope honesty
N8N_PEER_BACKEND_LEGO_ROOT=/tmp/peer/apps/n8n-lego/src/lego \
  node packages/frontend-lego/scripts/capture-context-session-evidence.mjs
```

Under option A the last two commands are the acceptance check: the promotion test must pass with the
sets quoted, and `test/29` must report zero differences with an empty `REGISTERED_DRIFT`.

---

## 8. Status

**Open — awaiting the manager's ruling.** `resolution` stays `null` in the register until then; this
package records the measurement, the options and their consequences, and nothing else. The frontend
branch does not resolve XA-20 by implementing around it: it renders the published vocabulary, names
the publication it waits for, and keeps the six continuation affordances and the three verification
outcomes visible as pending.

Related, still open, deliberately not merged into this row: **XA-12** (Memory is not context — no
store may be implied), **XA-17** (which contract publishes token usage — the three token kinds are
quoted from the reference scenario with that row as their decision), **XA-11** (where Skill is
modelled — unaffected: P2.13 adds no domain and creates no `ai-context` / `ai-session` top-level
LEGO).

---

## 9. Update 2026-09-22 — the publication happened on a peer branch

**What agent-2 published** (`arena/01a0c6b5-n8n-rust-v-4 @ fb254f32`, contract-lock 15 → **17 rows**):

| Vocabulary | Published as | Frontend treatment now |
|---|---|---|
| `ai.context@1.0.0` | lock row, owner `manager`, status `implemented`, domain `ai-foundation` | quoted; version rendered from the lock, `agreesWithClaim: true` |
| `ai.agent-session@1.0.0` | lock row, same owner/domain | quoted |
| 5 context operations | `load, compact, rollover, rehydrate, verify` in `domains.json#capabilities[id=ai.context]` | quoted (2 → **5**); the published list is derived from the lock, not hardcoded |
| 3 session operations | `create, status, close` (unchanged) | quoted |
| phase machine | `CONTEXT_MANAGER_STATES = NORMAL, PREPARE, ROLLOVER` in `ai-foundation.json#context` | **promoted** out of `PENDING_PUBLICATIONS` into `contextRolloverPhase` |
| verification results | `CONTINUATION_VERIFICATION = verified, degraded, failed` | **promoted** into `continuationVerification` |
| 14 continuation sections | `CONTINUATION_FIELDS` in the locked contract surface | `continuationSection` re-pointed from the AI-set manifest at the contract |
| 6th status word | `statusVocabulary` gained `in-progress` | `aiLegoStatus` 5 → **6**, adopted with the commit that moved it recorded |

Result: **53 → 55 quoted sets, 2 → 0 pending publication rows.** `PENDING_PUBLICATIONS` is empty, which
is exactly what §4.4 said pending was for.

**What is still not published, and stays refused:** `ai.context.execute`, `ai.context.continue`,
`ai.agent-session.continue`, `.pause`, `.resume`, `.execute`, `ai.memory.*`, `ai.agent-runtime.*`.
`Continue session` therefore still renders `operation-unpublished` in *both* trees — and now names the
published path it does not trigger (`ai.context.rollover → rehydrate → verify`).

**The two registered divergences** (neither averaged away, neither silently tolerated):

1. **The backend contradicts itself.** Locked `ai.context@1.0.0` publishes
   `continuationPackage: [toolStateReferences, importantReferences]`;
   `ai-lego-set.json#lego[id=context-session].continuationPackage` still says `[toolState, refs]` — on
   the peer branch exactly as on protected main. The frontend quotes the **contract**, records the
   manifest spelling verbatim as a registered divergence, and reports it as drift data. It closes when
   the manifest moves to the published spelling: **no frontend edit required.**
2. **Protected main has 2 context operations; the peer branch has 5.** Visible only while the trees
   differ. Closes at merge.

**Why the manifest's `publication.rows` is still empty.** `publication.rows` is what *this* tree
publishes and it feeds the surface (`contract: publication.rows.length > 0 ? publication.rows : null`).
Filling it from a peer branch would make a surface with no declaration handed over report `published` —
a fail-closed violation. So the peer rows are recorded verbatim in a separate
`publication.publishedOnPeerBranch` block, beside `publication.protectedMain`. Both observations,
neither averaged.

**Measured both ways, one code path, no edit in between:**

| Run | This tree (`e754c5df` backend copy) | Peer tree (`fb254f32`) |
|---|---|---|
| focused (test/32, 29, 31, 24, 33, 19) | **102/102** | **102/102** |
| full frontend suite | **363/363** | **363/363** |
| `test/32` Context & Session | 46/46 | 46/46 |
| `test/29` cross-agent alignment | 8/8 | 8/8 |

Evidence: `docs/n8n-lego/evidence/frontend-context-session-p213.json`, produced by
`packages/frontend-lego/scripts/capture-context-session-evidence.mjs` (which refuses to run if a focused
test file is missing, so a smaller count cannot look like a pass).

**Still required from the manager (five items, unchanged in substance):**

1. Rule the canonical spelling of the two continuation sections — the recommendation is that the
   **locked contract wins** over the AI-set manifest, and agent-2 moves the manifest.
2. Confirm the five context operations as the public surface (and that `execute`/`continue` stay absent).
3. Confirm `status: implemented` on both rows against the P2.13 boundary (no runtime, no provider calls).
4. Confirm `AGENT_SESSION_TRANSITIONS` is quoteable by the frontend.
5. Settle the **merge order**: agent-1's lock quotes rows that are not on protected main, so both
   branches must land in one reconciliation (or agent-2's first), otherwise main holds a frontend lock
   quoting a publication that does not exist there.

**Status: still `open-for-manager`.** A worker does not close a manager-owned decision, and quoting a
peer's publication is not the same as the manager ratifying it. `resolution` stays `null`.
