# TASK-UTILS-01 — Node LEGO: `utils.ts` helper surface + mechanical coverage audit (gate `N08`)

**Status:** VERIFIED · **Lane:** `packages/node-lego` (node) · **Deltas:** DELTA-01 (renamed lodash
predicate), DELTA-06 (injected logger for the `utils.ts` call sites)

## What the slice found, and what it closed

The contract claimed in prose that only workflow validation remained out of scope. Measuring that
claim (the audit that this slice also ships) showed **18 of the 120 symbols** exported by the 17
pinned boundary files were neither ported nor classified — mostly `utils.ts` helpers the Node Model
boundary owns, all of them oracle-pinned in `test/utils.test.ts` and all of them exported by the
published build, i.e. measurable.

Ported into the new `src/utils.mjs` (line-cited per helper):

| Helper | Reference | Differential |
| :--- | :--- | :--- |
| `isObject` (plain-object guard) | `utils.ts` L29-35 | port-only (not in the published surface); oracle + tests |
| `isObjectEmpty` | L37-49 | `N27` — shape matrix incl. FormData/Set/Map/views/streams/classes |
| `base64DecodeUTF8` | L195-209 | `N27` — ASCII + multi-byte UTF-8 + empty |
| `replaceCircularReferences` / `jsonStringify` | L211-237 | `N27` — circular, duplicate-reference and `toJSON` cases |
| `fileTypeFromMimeType` | L261-270 | `N27` — 15 MIME shapes |
| `assert` | L272-289 | `N27` — message + frame-hiding behaviour |
| `isTraversableObject` / `removeCircularRefs` | L290-314 | `N27` — in-place marker shape |
| `randomInt` / `randomString` | L337-361 | `N27` — **exact values** under a stubbed `crypto.getRandomValues` |
| `hasKey` | L364-366 | port-only; oracle ported (own-property semantics) |
| `isSafeObjectProperty` / `setSafeObjectProperty` | L367-412 | `N27` — banned set + `__proto__` protection |
| `isDomainAllowed` | L415-466 | `N27` — 17 URL/allow-list shapes (wildcards, trailing dots, ports, junk input) |
| `isCommunityPackageName` | L468-475 | `N27` — incl. consecutive calls (the reference resets `lastIndex`) |
| `sanitizeFilename` | L496-511 | `N27` — traversal, Windows paths, null bytes, dot-only names |

## The audit instrument (new gate `N08`)

`tools/node-lego-coverage.mjs` extracts every exported symbol of the 17 pinned files and requires
each to be classified in one manifest:

* **ported** — must exist in `src/index.mjs` **and** be named in `contracts/node.contract.md`;
* **internal** — implemented but deliberately not exported (`isValidResourceLocatorParameterValue`);
* **out-of-scope** — with the owning package or the delta that excludes it (DELTA-02 error
  hierarchy, TypeScript-only types, `dedupe` → workflow lanes, five guard helpers → validation-lego);
* **deferred** — with the task that closes it (`sleep`, `sleepWithAbort`, `updateDisplayOptions` →
  TASK-UTILS-02; timer/merge seams).

Current state: **120 reference symbols — 102 ported · 1 internal · 14 out-of-scope · 3 deferred**.
Unclassified symbols, stale manifest entries and ported-but-undocumented symbols all fail the gate.

## Evidence

| Check | Result |
| :--- | :--- |
| `node --test packages/node-lego/test/*.test.mjs` | **136 pass / 0 fail** (122 + 14 new in `test/utils.test.mjs`) |
| `node tools/node-lego-differential.mjs` | **1797 agree / 0 diverge / 1797 comparisons** (2 NOT-DIFFABLE, 0 harness errors) across **27 groups**; `N27` = 12 comparison batches |
| `node tools/node-lego-coverage.mjs` | **OK — 120 symbols classified** (102/1/14/3) |
| `node tools/node-lego-gate.mjs` | **8/8 PASS** — N02 21 source files, N03 136 tests, N05 1797/0, N07 117 symbols, N08 classified |
| `npm run verify:all` | exit 0 (12 lane gates green) |
| Falsifiability | `isSafeObjectProperty` relaxed → **1 DIVERGE**; `sanitizeFilename` null-byte strip dropped → **1 DIVERGE** (exact diff shown); ported export removed from `src/index.mjs` → `N08` **FAIL "neither ported, internal, deferred nor out of scope"**; bogus manifest entry → `N08` **FAIL "stale entry"**. All probes reverted byte-identical (`cmp`), tree back at 1797/0 and coverage OK |

## Pinned quirks (do not "fix")

* `isTraversableObject` returns the falsy **input** (`null`, `0`, `''`), not `false` — the
  reference's `value && …` short-circuit. Pinned by test and by `N27` through `removeCircularRefs`.
* `sanitizeFilename` **strips** null bytes rather than treating them as separators
  (`'dir\0file.txt'` → `'dirfile.txt'`).
* `isObjectEmpty` must not touch `Object.keys` for arrays/Buffers/streams (oracle spy case).
* `hasKey` is own-property only: `hasKey([1, 2], 'length') === true`, `'toString' === false`.
* `isCommunityPackageName` keeps a module-level `/g` regex but resets `lastIndex` per call, so
  consecutive calls do not drift (`n8n-nodes-base` stays `false` after a `true`).

## Contract / doc sync

`contracts/node.contract.md` §12 (new module row, DELTA-01 `lodashIsObject` note, §12.2 item 8
replaced by the audited scope manifest, §12.3 = 27 groups/1797/136 cases, §12.4 = 117 symbols) ·
`docs/isolation/node.md` §5 · `README.md` NODE row · `docs/isolation/LEGO-MASTER-MAP.md` ·
`packages/node-lego/README.md` · `tools/node-lego-gate.mjs` (N03 pin 122 → 136, new N08).

## Boundary

No file under `reference/n8n/**` (gate `N04` PASS — 15050 files, root `f8da35180669d798…`),
`crates/**`, `apps/**`, the frontend or a peer package was touched. The three deferred helpers are
visibly owned by `TASK-UTILS-02` in gate `N08`'s output, so they cannot be forgotten silently.

## Consensus review sweep (dual phase, offline — ISSUE-019)

| Phase | What was checked | Finding |
| :--- | :--- | :--- |
| 1 — before starting | review queue | Drained before this slice: `TASK-422`…`TASK-427` and `TASK-AGENT4-RUNTIME-01` verdicts recorded (sweeps 18/19), `TASK-429` verdict recorded (sweep 21). No open `NEEDS_CORRECTION`. |
| 2 — after finishing | full node lane re-run + surrounding gates | suite 136/136, differential 1797/0 (27 groups), coverage OK (120 classified), Node gate 8/8, `verify:all` exit 0. No peer result was unreviewed at that moment. |

**No self-approval:** this result is left for a peer vote. Reviewer recipe: `node --test
packages/node-lego/test/*.test.mjs` (136), `node tools/node-lego-coverage.mjs`,
`node tools/node-lego-gate.mjs` (8/8), `node tools/node-lego-differential.mjs` (1797 agree /
0 diverge).
