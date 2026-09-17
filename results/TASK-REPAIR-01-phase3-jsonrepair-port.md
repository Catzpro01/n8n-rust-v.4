# TASK-REPAIR-01 — Node LEGO: `jsonrepair` port (DELTA-05's `repairJSON` path, closed)

**Status:** VERIFIED · **Lane:** `packages/node-lego` (node) · **Delta class:** DELTA-05 (revised)

## Why this slice

`contracts/node.contract.md` §12.2 item 5 recorded a real behaviour gap rather than a scope
decision: the reference's `jsonParse(..., { repairJSON: true })` branch calls the `jsonrepair`
package (`utils.ts` L5, L164-170), while the port left the branch empty — "no adapter → the
recovery is skipped". Three facts made that fixable rather than merely documentable:

1. the oracle pins 25 repair cases (`test/utils.test.ts` `describe('JSON repair')` L162-290);
2. the published `n8n-workflow@2.9.1` build ships a **working** jsonrepair, so the gap is
   measurable through the same entry point the port exposes (`jsonParse`);
3. the exact code the reference runs is resolvable locally at
   `packages/workflow-lego/node_modules/jsonrepair` (v3.13.1, ISC, UMD bundle 903 ln).

## What was built

* **`src/json-repair.mjs`** — verbatim port of that bundle: only the UMD wrapper was replaced by
  ESM named exports (`jsonrepair`, `JSONRepairError`) and the body dedented. Character constants,
  the scanner, the repair pipeline (`stripMarkdownCodeFence`, quote/key normalisation, missing
  commas/colons, unclosed structures, number and Python-constant handling) and the error
  positions are upstream byte-for-byte; the docblock cites the upstream project, version, licence
  and the resolved bundle path.
* **`src/type-validation.mjs`** — `jsonParse`'s `repairJSON` branch is now
  `JSON.parse(repairJSONParser(jsonString))` with `repairJSONParser = jsonrepair` as the default
  and the injected adapter still winning when supplied. DELTA-05 is restated as "injectable
  adapter with a faithful dependency-free default" instead of "no-op".

## Evidence

| Check | Result |
| :--- | :--- |
| `node --test packages/node-lego/test/*.test.mjs` | **122 pass / 0 fail** (116 + 6 new in `test/json-repair.test.mjs`) |
| `node tools/node-lego-differential.mjs` | **1771 agree / 0 diverge / 1771 comparisons** (2 NOT-DIFFABLE, 0 harness errors) across **26 groups**; `N26` = **76 comparisons** |
| `node tools/node-lego-gate.mjs` | **7/7 PASS** — `N02` 20 source files, `N03` 122 tests, `N05` 1771/0, `N07` 98 symbols |
| `npm run verify:all` | exit 0 (12 lane gates green) |
| Falsifiability probe | Python-constant branch dropped → **2 DIVERGE**; trailing-comma repair disabled at its 4 sites → **14 DIVERGE** (and the new test file drops to 4/6). Port restored byte-identical (`cmp` vs the pre-mutation copy) → 1771/0 |

`N26` drives the comparison through `jsonParse(text, { repairJSON: true })` on **both** sides, so
every case is an end-to-end repair + parse comparison against the reference build's own bundled
jsonrepair. Corpus: the oracle's 25 repair cases (citation per case in the results of the group
labels) plus jsonrepair's wider feature list — Python constants, `NaN`/`Infinity`, hex and
leading-zero numbers, line/block comments, missing commas and colons, unclosed braces/brackets/
strings, markdown fences, JSONP, ellipsis, smart quotes, non-breaking spaces, escaped quotes,
newline-delimited JSON, duplicate keys, nested unquoted keys, and controls where the input is
already valid JSON.

## Reference behaviour pinned by this slice (do not "fix")

* jsonrepair **preserves the input's whitespace style** where it re-emits tokens:
  `{a: True, b: False, c: None}` → `{"a": true, "b": false, "c": null}` (not the minified
  `{"a":true,...}`); `{a: 1 /* note */, b: 2}` → `{"a": 1 , "b": 2}`.
* A missing value repairs to `null`: `{"a": }` → `{"a": null}`; `{,}` → `{}`.
* `#` is a comment marker only inside an object — `{a: 1} # trailing` throws
  `Unexpected character "#" at position 7`, and `Here is the JSON: {"a": 1}` throws
  `Unexpected character "{" at position 18` (stray text is not silently stripped).
* A markdown fence is replaced by newlines: `` ```json\n{"a": 1}\n``` `` → `\n{"a": 1}\n`.
* When the repair itself fails, `jsonParse` rethrows the **original `JSON.parse` error**, not the
  `JSONRepairError` — the repair branch swallows its own exception (reference `catch (e)`), which
  the ported tests assert both ways.

## Contract / doc sync

`contracts/node.contract.md` §12 (new module row, DELTA-05 revised, §12.2 item 8 reduced to the
`validation-lego` note, §12.3 = 26 groups/1771/122 cases, §12.4 = 98 symbols) ·
`docs/isolation/node.md` §5 · `README.md` NODE row · `docs/isolation/LEGO-MASTER-MAP.md` ·
`packages/node-lego/README.md` · `tools/node-lego-gate.mjs` (N03 pin 116 → 122).

## Boundary

No file under `reference/n8n/**` (gate `N04` still PASS — 15050 files, root
`f8da35180669d798…`), `crates/**`, `apps/**`, the frontend or any peer package was touched. With
this slice, every module named by the Node Model boundary — `node-helpers.ts`, `filter-parameter.ts`,
`node-reference-parser-utils.ts`, `utils.ts` `jsonParse` (both recovery paths) and `errors/**` —
is runnable inside the dependency-free LEGO; the only remaining out-of-scope item is workflow
validation, which belongs to `packages/validation-lego`.

## Consensus review sweep (dual phase, offline — ISSUE-019)

| Phase | What was checked | Finding |
| :--- | :--- | :--- |
| 1 — before starting | local pool + review queue | The review queue was **drained first**: `TASK-422`…`TASK-427` and `TASK-AGENT4-RUNTIME-01` were re-run and verdicted (sweeps 18/19, 7 × APPROVE, 0 × NEEDS_CORRECTION) before this slice started. Open items unaffected by this task: ISSUE-023 (trigger surface, ownership), ISSUE-024 (dual-home `NodeOperationError`, orchestrator decision). |
| 2 — after finishing | fresh re-run of everything this slice touched + the pool | node suite 122/122, differential 1771/0 (26 groups), Node gate 7/7, `verify:all` exit 0 on the slice tip; no other agent had an unreviewed result at the time of the sweep. |

**No self-approval:** this task's own result awaits a peer vote (recorded as pending in
`results/REVIEW-SWEEP-2026-09-18.md`). Reviewer recipe: `node --test
packages/node-lego/test/*.test.mjs` (122), `node tools/node-lego-gate.mjs` (7/7),
`node tools/node-lego-differential.mjs` (1771 agree / 0 diverge).
