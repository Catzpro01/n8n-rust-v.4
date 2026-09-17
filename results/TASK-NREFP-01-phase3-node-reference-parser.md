# TASK-NREFP-01 — Node LEGO: node-reference parser (+ `OperationalError`, lodash subset)

**Status:** VERIFIED · **Lane:** `packages/node-lego` (node) · **Delta class:** DELTA-01 (lodash
subset), DELTA-02 (boundary-local errors), DELTA-03 (pinned `name` quirk)

## Scope

`reference/n8n/packages/workflow/src/node-reference-parser-utils.ts` (643 ln) — the last runnable
Node Model surface left by TASK-413/TASK-414 — plus the `lodash` helpers it pulls in and the
`OperationalError` it throws:

* `hasDotNotationBannedChar` (L16), `backslashEscape` (L17), `dollarEscape` (L30),
  `applyAccessPatterns` (L42), `extractReferencesInNodeExpressions` (L491-643) and every private
  helper (`LazyRegExp`, `ACCESS_PATTERNS`, `parseExpressionMapping`, `extractExpressionCandidate`,
  `resolveDuplicates`, `applyExtractMappingToNode`, `applyCanonicalMapping`).
* `lodash-lite.mjs` gains `escapeRegExp`, `mapValues`, `cloneDeep`. **`cloneDeep` ≠ `deepCopy`:**
  lodash keeps `Date`/`RegExp`/`Map`/`Set`/cycles, the reference `utils.ts` `deepCopy` is
  `toJSON`-first; both now coexist and the docblock says which call site wants which.
* `errors.mjs` gains `OperationalError` (`errors/base/operational.error.ts`): `level` defaults to
  `'warning'`, `tags` to `{}`, `name === 'Error'` (DELTA-03 — the base constructor never sets it).

New files: `packages/node-lego/src/node-reference-parser.mjs`,
`packages/node-lego/test/node-reference-parser.test.mjs`. Package is now **19 source modules /
96 exports**.

## Evidence

| Check | Result |
| :--- | :--- |
| `node --test packages/node-lego/test/*.test.mjs` | **116 pass / 0 fail** (74 node-model · 8 error-surface · 8 parameter-issues · 11 filter-execution · **15 node-reference-parser**) |
| `node tools/node-lego-differential.mjs` | **1695 agree / 0 diverge / 1695 comparisons** (2 NOT-DIFFABLE, 0 harness errors) across **25 groups**; `N25` = **80 comparisons** |
| `node tools/node-lego-gate.mjs` | **7/7 PASS** — `N02` 19 source files, `N03` 116 tests, `N05` 1695 agree / 0 diverge, `N07` 96 symbols documented |
| `npm run verify:all` | exit 0 (12 lane gates green) |
| Falsifiability probe | 3 injected mutations, each reverted → dropped `dollarEscape` **4 DIVERGE**, reordered `ITEM_TO_DATA_ACCESSORS` **1 DIVERGE**, disabled `cloneDeep` `Date` branch **2 DIVERGE** |

Reference oracle: `test/node-reference-parser-utils.test.ts` (788 ln) — 15 ported cases citing
L17/L30/L54/L155/L172/L195/L248/L265/L290/L319/L348/L383/L435/L454/L539/L623/L655/L704/L718/L746.

## Port-only surface handling

`cloneDeep`, `mapValues` and `escapeRegExp` are **not re-exported by the published build**, so
they cannot be compared through `EXAMINED_SURFACE`. The harness now has a `PORT_ONLY_SURFACE`
list compared against the reference build's own bundled **lodash**
(`requireFromWorkflowLego('lodash')`), and every `escapeRegExp`-family helper on the reference
side degrades to that lodash binding, so the comparison that matters is port-vs-lodash.
Routing these names through the normal surface produced the spurious
`api.escapeRegExp is not a function` harness error that is now covered by a regression check.

## Pinned quirks verified against REF (do not "fix")

* `hasDotNotationBannedChar('a_b') === true` (underscore is banned); `Né` is allowed.
* `$("A").item.json["x"]` yields variable name `''` — the bracket stops the path.
* `$("A").item.json.foo.bar()` **still** extracts `foo_bar`.
* A complex `itemMatching($("C")…)` extracts **both** `idx` and a truncated
  `A_itemMatching_unknown`.
* Special-character node names produce no name prefix unless there is a clash.
* `$`-sequences in the replacement survive `replace()` interpolation, i.e. `dollarEscape` is
  load-bearing: `('$("oldName")','oldName','new$1Name')` → `$("new$1Name")`,
  `('$node["oldName"].data','oldName','a$&b')` → `$node["a$&b"].data`,
  `('$items("oldName", 0)','oldName','x$`y')` → `$items("x$`y", 0)`.

## Harness robustness fix found by the probe

The `N25` clone probes originally called `value.getTime()` after an `instanceof Date` guard. A
`Date`-prototype object **without** the internal `[[DateValue]]` slot passes `instanceof Date`
and throws `this is not a Date object.` on every `Date` method — that turned the third mutation
into a harness error instead of a divergence. The probes now use slot-safe accessors
(`Date.prototype.getTime.call` in a `try/catch`) and never call `String()` on a candidate `Date`,
so a broken clone reports DIVERGE.

## Contract / doc sync

`contracts/node.contract.md` §12 (module row, DELTA-01/DELTA-02 updates, §12.2 item 8 now only
lists `repairJSON` + workflow validation, §12.3 = 25 groups/1695/116 cases, §12.4 = 96 symbols) ·
`docs/isolation/node.md` §5 · `README.md` NODE row · `docs/isolation/LEGO-MASTER-MAP.md` ·
`packages/node-lego/README.md` · `tools/node-lego-gate.mjs` pins (101 → 116 tests).

## Boundary

No file under `reference/n8n/**` (gate `N04` still PASS — 15050 files, root
`f8da35180669d798…`), `crates/**`, `apps/**`, the frontend or any peer package was touched.
Still explicitly out of scope after this task: the `jsonrepair`-backed `repairJSON` recovery
(DELTA-05) and workflow validation.
