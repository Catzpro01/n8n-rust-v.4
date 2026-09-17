# Execution Data LEGO — pure-core reconstruction record

**Lane:** POOL-005 (self-claimed, unclaimed lane)
**Executor:** Arena session `arena/01a0aff7-n8n-rust-v-4` (continuing the POOL-001 line)
**Date:** 2026-09-17
**Reference:** n8n `2.9.4`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`
**Reference runtime:** `n8n-workflow@2.9.1`, `n8n-core@2.9.1`, `n8n-nodes-base@2.9.1` (the n8n 2.9.4 dependency set)
**Rust:** NONE introduced. `crates/` and `apps/` contain only `.gitkeep`; both harnesses assert it.
**UI:** untouched. No `editor-ui`, CSS, theme or asset path appears in the diff.

---

## 1. Why this lane

| Lane | State at claim time | Taken? |
| :--- | :--- | :--- |
| Workflow / Node / Connection / Validation | contracts + isolation docs + acceptance packs delivered | no |
| Execution engine + node execution data proxy | **actively being reconstructed** by session `arena/01a0aff8` (`packages/reconstructed-engine`) | **no — collision** |
| Persistence | pure core delivered (PR #13, `arena/01a0af71`) | no |
| Expression | partially covered by the peer proxy work | no |
| **Execution Data** | contract complete, 7 reference fixtures recorded, **no reconstructed package** | **YES** |

The Execution Data LEGO is the seam the engine work depends on (`INodeExecutionData`,
`IRunData`, `pairedItem`, `ISourceData`), it is fully specified by
`contracts/execution-data.contract.md`, and it is the only lane whose *rules* can be
verified against recorded engine output **without** an engine.

---

## 2. Scope

### Reconstructed (8 modules, 100% pure — no I/O, no DB, no engine)

| Module | Reference (n8n 2.9.4) |
| :--- | :--- |
| `constants.mjs` | `workflow/src/constants.ts:6,137,139,140`; `core/src/binary-data/utils.ts:7` |
| `errors.mjs` | `@n8n/errors/dist/application.error.js` |
| `deep-copy.mjs` | `workflow/src/utils.ts:53-89` |
| `pretty-bytes.mjs` | `pretty-bytes@5.6.0` (the version pinned by n8n-core 2.9.1) |
| `item-helpers.mjs` | `core/.../node-execution-context/utils/{return-json-array,normalize-items,construct-execution-metadata,copy-input-items}.ts` |
| `paired-items.mjs` | `core/src/execution-engine/workflow-execute.ts:1514-1557` (I3), `:1741-1764` (I9), `:2581-2637` (I4), `:499-503/733-741/804-812` (I6/I7), `.../utils/resolve-source-overwrite.ts` |
| `run-execution-data.mjs` | `workflow/src/run-execution-data-factory.ts:52-163`; `run-execution-data/run-execution-data.v1.ts:59-76`; `run-execution-data/run-execution-data.ts:26-41` |
| `binary.mjs` | `workflow/src/utils.ts:261-270`; `core/src/binary-data/utils.ts:7-10`; `core/src/binary-data/binary-data.service.ts:70-126,234-236`; `core/.../binary-helper-functions.ts:256-341` |

### Deferred by design (declared boundary, not unfinished work)

- `BinaryDataService` + the `filesystem` / `filesystem-v2` / `s3` / `database`
  managers. Everything *above* the manager call (id minting, payload clearing,
  size metadata) is reconstructed; the managers need a configured service.
- `FileType.fromBuffer()` content sniffing and `IncomingMessage` handling inside
  `prepareBinaryData` (async + HTTP-bound).
- The `WorkflowExecute` loop. Contract §7 gives this LEGO the **rules**, not the
  loop — the loop belongs to the execution-engine lane.

---

## 3. Frozen quirks (each pinned by a named test)

| ID | Quirk | Found by |
| :--- | :--- | :--- |
| E-01 | `ApplicationError.name` stays `'Error'` — upstream never assigns it | source + A/B |
| E-02 | `ApplicationError` stamps `tags.packageName` from the **caller's** path via `/packages\/([^\/]+)\//` two frames up (`callsites()[2]`) | A/B (reproduced, not dropped) |
| E-03 | `extra` is always assigned → own enumerable key even when `undefined` | A/B |
| DC-1 | `deepCopy` replaces any object with `toJSON()` by its JSON value (a `Date` becomes a string) | source + A/B |
| DC-2 | functions are returned by reference | source + A/B |
| DC-3 | a plain-object clone is `Object.create(Object.getPrototypeOf({}))` → custom prototypes dropped, arrays stay arrays | source + A/B |
| DC-4 | cycles resolve through a shared `WeakMap` and point at the **clone** | source + A/B |
| H-01 | `returnJsonArray`'s double-wrap guard is a **truthiness** test → `{json: null}` / `''` / `0` double-wrap | source, pinned |
| H-02 | sibling keys (`binary`, …) survive `returnJsonArray` via the spread | source, pinned |
| H-03 | `normalizeItems` unwraps a bare object with the same truthiness test | source, pinned |
| H-04 | mixed json/raw → `ApplicationError('Inconsistent item format')` | source + A/B |
| H-05 | an all-`binary` array is reshaped (everything except `binary` moves under `json`); a mix throws | source + A/B |
| **H-06** | **`null` members THROW** `TypeError: Cannot use 'in' operator to search for 'json' in null` — `typeof null === 'object'` passes the guard. Non-null primitives are wrapped normally. | **differential test vs n8n-core@2.9.1** |
| **H-07** | **`itemData` LOSES to an existing `pairedItem`.** Only `json` is destructured out, so `...rest` still holds the item's own `pairedItem` and overwrites the value written one line earlier. | **differential test vs n8n-core@2.9.1** |
| H-08 | `copyInputItems` turns a missing property into `null`, not `undefined` | source, pinned |
| H-09 | `copyInputItems` deep-copies values, so DC-1 leaks through | source + A/B |
| P-01 | I3 writes `input: inputIndex \|\| undefined` → input 0 loses the key on serialisation | source + fixture |
| P-02 | a `null` input branch is passed through untouched | source, pinned |
| P-03 | `sourceOverwrite` is threaded in only for tool executions | source, pinned |
| P-04 | the first unfixable item `break`s the whole assignment loop — later items stay `undefined` | source, pinned |
| P-05 | rule (b) requires a single output branch → two branches never get index pairing | source + fixture |
| P-06 | `assignPairedItems` mutates in place and returns the same array | source, pinned |
| P-07 | `buildSourceData` normalises `null` → `undefined` (`?? undefined` fires on `null`) | source, pinned |
| P-08 | I9 writes `input: inputIndex` **unconditionally** → `{item:0, input:0}`, unlike the I3 rewrite | source + fixture |
| R-01 | `executionData: null` / `runData: null` opt out; omitting the key does not | source + A/B |
| R-02 | `error`/`pinData`/`lastNodeExecuted`/`metadata` are written unconditionally → explicit `undefined` keys | source + A/B |
| R-03 | `waitingExecutionSource` defaults to `{}` although the type allows `null` | source + A/B |
| R-04 | `createErrorExecutionData` hard-codes one start item `{json:{}, pairedItem:{item:0}}` | source + A/B |
| R-05 | the error record scopes itself: `destinationNode.mode='inclusive'`, `runNodeFilter=[node.name]` | source + A/B |
| R-06 | all error-record timings are `0`, `source` is `[]` | source + A/B |
| R-07 | the v0→v1 lift **always** creates `startData`, adding both destination keys as `undefined` when absent | source + A/B |
| R-08 | the lift is a shallow spread — every other key is carried by reference | source + A/B |
| R-09 | the migration `switch` has no `break` between `case 0` and `case undefined` | source + A/B |
| R-10 | an unknown version raises a **plain** `Error`, message `Unsupported IRunExecutionData version: <n>` | source + A/B |
| B-01 | `prepareBinaryData` falls back to `'text/plain'`, never to `undefined` | source + fixture |
| B-02 | `filePath` wins over the mime-derived extension (it is applied after `returnData` is built) | source, pinned |
| B-03 | `directory` is set only when the parsed dir is non-empty | source, pinned |

---

## 4. Verification

### 4.1 LEGO suite — 77/77 PASS

| File | Tests | What it pins |
| :--- | :--: | :--- |
| `test/01-deep-copy.test.mjs` | 8 | DC-1 … DC-4, cycles, prototypes |
| `test/02-item-helpers.test.mjs` | 13 | H-01 … H-09 |
| `test/03-run-execution-data.test.mjs` | 8 | R-01 … R-10, factory key order |
| `test/04-paired-items.test.mjs` | 19 | I3/I4/I5/I9, P-01 … P-08 |
| `test/05-binary.test.mjs` | 11 | B-01 … B-03, I10, `prettyBytes` |
| `test/06-parity.test.mjs` | 9 | A/B against the real n8n packages (skips loudly if `.runtime/` is absent) |
| `test/07-reference-fixtures.test.mjs` | 9 | contract invariants + rule replay over `tests/reference/execution-data/*` |
| **total** | **77** | — |

### 4.2 A/B parity surfaces (all green)

`deepCopy`, `returnJsonArray`, `normalizeItems`, `constructExecutionMetaData`,
`copyInputItems`, `createRunExecutionData`, `createEmptyRunExecutionData`,
`createErrorExecutionData`, `runExecutionDataV0ToV1`, `migrateRunExecutionData`,
`fileTypeFromMimeType`, `prettyBytes` — each diffed against the installed
`n8n-workflow@2.9.1` / `n8n-core@2.9.1` / `pretty-bytes@5.6.0`, comparing
**values and thrown errors** (`message`, `level`, `tags`, own-key shape) with
`assert.deepStrictEqual`.

### 4.3 Fixture replay (no engine)

The 7 recordings in `tests/reference/execution-data/` are replayed:

- **03-item-pairing** — all seven node transitions (`MapNoPair`, `Aggregate`,
  `ExplodeNoPair1`, `ExplodeNoPairN`, `ExplodePaired`, `Echo`, plus the start
  node) reproduce their recorded `pairedItem` sequence exactly from
  `assignPairedItems` alone.
- **07-item-helpers** — `normalizeItems` + `returnJsonArray` + pairing reproduce
  the recorded `json` **and** `pairedItem` of the `Norm` and `RJA` tasks.
- **05-empty-data** — the `alwaysOutputData` synthesis (`[{json:{}, pairedItem:[{item:0,input:0},{item:1,input:0}]}]`)
  is reproduced, and the downstream `AfterAlways` / absent `After` split follows.
- **06-binary-reference** — every `IBinaryData` satisfies invariant I10 and
  decodes back to `hello <i>`.
- **01/02/04** — envelope, `source` shape (I6/I7) and name-keying (I14)
  conformance across all 7 fixtures.

### 4.4 Meta-tests — the suite fails when the port is broken

The parity suite was mutation-tested in both directions; every mutant is caught:

| Mutant | Result |
| :--- | :--- |
| M1 — `returnJsonArray` truthiness guard → `'json' in data` | **FAIL** (parity) |
| M2 — `constructExecutionMetaData` destructures `pairedItem` out (i.e. "fixes" H-07) | **FAIL** (unit + parity) |
| M3 — `buildSourceData` drops the `?? undefined` normalisation | **FAIL** (unit) |

M2 is the important one: it proves the suite would reject the *intuitive*
reading of the source and accepts only the behaviour n8n actually exhibits.

### 4.5 Repository gates (after the change)

| Gate | Result |
| :--- | :--- |
| `node tests/compatibility/contract_conformance.mjs` | **21/21 PASS** |
| `python3 tests/integration/boundary_audit.py` | **PASS** (all edges documented; Rust guard clean) |
| `npm run verify:fast` | **10/10 PASS** — G09: 252 comparisons, 0 differences |

`reference/n8n/**` is byte-identical (G04: 15050 files, root `f8da35180669…`).
No contract, no frontend path and no `crates/`/`apps/` path was touched.

---

## 5. Known divergences (declared, not defects)

1. **`tags.packageName`** is reproduced *mechanically*, so it reports
   `execution-data-lego` instead of `core`. It is a diagnostic tag derived from
   the caller's directory; the derivation itself is 1:1 (E-02).
2. **`prepareBinaryData`'s mime table** is a pinned subset of `mime-types`
   (`lookup`/`extension`), covering the extensions the recorded fixtures use.
   It is injectable (`mimeLookup`, `extensionFor`) so the full table can be
   swapped in without touching a rule.

---

## 6. Coordination

See `docs/isolation/execution-data-bus-outbox.json`:

- **APPROVE** for peer lane `arena/01a0aff8` (execution engine + node execution
  data proxy) — 28/28 reproduced independently from the branch tip.
- **APPROVE** for `arena/01a0aff7` `809d9f05` (gate evidence re-recorded after
  the Phase-2 Rust removal: 20/21 → 21/21, audit FAIL → PASS).
- **AUDIT REQUEST** to agent-5 for POOL-005.
- **NOTE** that PR #13's branch (`arena/01a0af71`) no longer exists upstream, so
  the persistence pure core could **not** be re-verified here; the vote is
  withheld rather than fabricated.
