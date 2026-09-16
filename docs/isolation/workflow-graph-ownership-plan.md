# `graph/**` + `connections-diff` — decision-ready ownership plan (MSG-02)

| Field | Value |
| :--- | :--- |
| Purpose | Give Agent 3 (Connection / LEGO 03) everything needed to answer `MSG-02` in one reply, and to execute the chosen option without re-deriving the analysis |
| Author | `agent-1` — Workflow Domain Engineer (current owner of both modules) |
| Question (verbatim, MSG-02) | `LEGO-MASTER-MAP.md` §3 assigns `graph/graph-utils.ts` + `connections-diff.ts` to **Connection**; `packages/workflow-lego/manifest/ownership.json` lists both under **Workflow**. Which wins? |
| Verified at | `main @ eb1c1195` (merged into `arena/01a0ac62-n8n-rust-v-4` as merge commit `ca37ab0d`) |
| Reference | n8n `2.9.4` — `reference/n8n/packages/workflow/src` |
| Status | **OPEN** — Agent 1 keeps both modules until Agent 3 answers (no change is executed here) |

> Answer with a `DEPENDENCY_RESPONSE`: **A** (Connection takes them; plan in §3) or **B** (Workflow keeps
> them; declaration in §4). Either way the reply is what closes MSG-02 — silence keeps both documents
> "correct about content, inconsistent about ownership".

---

## 1. What is actually at stake (measured, not assumed)

Two files, 360 lines total:

| File | LOC | Exports | Runtime imports |
| :--- | ---: | :--- | :--- |
| `graph/graph-utils.ts` | 273 | 7 functions + 3 types (below) | **none** — line 1 is the file's only import: `import type { IConnection, IConnections } from '../interfaces'` |
| `connections-diff.ts` | 87 | `compareConnections` + `ConnectionsDiff`, `INodeConnectionsDiff` | `import type { … } from '.'` — the package barrel (deviation `D-01`, normalized to `P-KERNEL-TYPES`) |

Symbols, with the source line each declaration sits on:

| Symbol | Kind | Line | In the frozen 15-symbol surface? |
| :--- | :--- | ---: | :--- |
| `getInputEdges` | function | `graph-utils.ts:41` | yes (`graph` group) |
| `getOutputEdges` | function | `:62` | yes |
| `getRootNodes` | function | `:103` | yes |
| `getLeafNodes` | function | `:123` | yes |
| `hasPath` | function | `:145` | yes |
| `buildAdjacencyList` | function | `:170` | yes |
| `parseExtractableSubgraphSelection` | function | `:209` | yes |
| `ExtractableErrorResult` | type | `:29` | yes (types group) |
| `IConnectionAdjacencyList` | type | `:36` | yes (`AdjacencyList` via the barrel) |
| `ExtractableSubgraphData` | type | `:165` | yes |
| `compareConnections` | function | `connections-diff.ts:15` | yes (`content` group) |
| `ConnectionsDiff`, `INodeConnectionsDiff` | types | `:10`, `:8` | yes |

**Consumers — the whole list** (grep over `reference/n8n/packages/workflow/src`):

| Consumer | Kind | Note |
| :--- | :--- | :--- |
| `index.ts:74-80` | re-export | exposes `parseExtractableSubgraphSelection`, `buildAdjacencyList`, `ExtractableErrorResult`, `ExtractableSubgraphData`, `IConnectionAdjacencyList as AdjacencyList` on the public `n8n-workflow` barrel |
| `workflow-diff.ts:11` | value import | `compareConnections`, `ConnectionsDiff` — and `workflow-diff` is itself re-exported by the barrel (`index.ts:85`) |
| the deep paths themselves | — | `getRootNodes`/`getLeafNodes`/`hasPath`/`getInputEdges`/`getOutputEdges` are reachable only via the deep module path (that is why `tools/reference-model-api.mjs` requires `dist/cjs/graph/graph-utils.js`) |
| **nothing else** | — | no file inside LEGO 01's ten owned files imports them; `Workflow` never calls them |

---

## 2. Why this is a clean cut (if Agent 3 wants it)

1. **No runtime coupling to `Workflow`.** Both modules are pure functions over `IConnections` +
   node-name sets. They do not import the aggregate, the indexes, node-helpers or the expression runtime.
2. **No internal consumer inside LEGO 01.** `common/*` traversal (which `Workflow` *does* use) is a separate
   file set and stays with Workflow either way.
3. **The cut is a re-export rewiring, not a refactor.** The only in-package edges are the barrel
   (`index.ts:74-80`) and `workflow-diff.ts:11`.
4. **Public paths are preserved by construction** — the barrel keeps exporting the same names, so the
   6 318 `n8n-workflow` import sites never notice. Only `manifest/ownership.json` and the port table move.

---

## 3. Option A — Connection owns `graph/**` + `connections-diff` (recommended)

### 3.1 What each agent writes

| Step | Owner | Deliverable |
| :--- | :--- | :--- |
| A1 | **agent-3** | `contracts/connection.contract.md`: a "Provided: graph & diff surface" section declaring all 12 symbols verbatim (functions with parameter/return types, types with their shapes) plus the invariant "pure over `IConnections`; no `Workflow` import; deterministic ordering". `MSG-02` reply = `DEPENDENCY_RESPONSE / accepted: A`. |
| A2 | **agent-1** | `contracts/workflow.contract.md`: declare a **new port `P-CONNECTION-GRAPH`** (11 → 12 ports) as *consumed*, list the 14 symbols it re-exports, and record that `Workflow` itself never calls them. `docs/isolation/workflow-port-contract.md`: add the port row + the "affects" note. |
| A3 | **agent-1** (mechanical) | `manifest/ownership.json`: remove `graph/graph-utils` + `connections-diff` from `owns.files` (10 → 8 files), add `P-CONNECTION-GRAPH` to `ports[]` and its specifier mapping to `extraction.portSpecifiers`. **`publicSurface` stays at 15** — the barrel keeps re-exporting. |
| A4 | **agent-1** | Regenerate `manifest/boundary-map.json`, `manifest/port-surface.json`, `docs/isolation/workflow-dependency-map.md`; update `manifest/boundary.expectations.json` (the two files leave the compile closure, the port joins the crossings). |
| A5 | **agent-3** | Provide an adapter that maps `P-CONNECTION-GRAPH` onto either the pinned reference runtime (reference mode) or a standalone implementation (strict mode) — the same two-adapter pattern `packages/workflow-lego/src/adapters/{reference,strict}` already uses. |
| A6 | **agent-5** | Re-run `npm run verify` (11 gates) + `compat` + `boundary_audit`, then re-confirm both LEGOs' verdicts. |

### 3.2 The piece everyone will otherwise forget (predicted, with evidence)

Moving those modules behind a port changes which digest sections are **port-dependent**. Today
`PORT_DEPENDENT = {nodeParameters, rename}` (`packages/workflow-lego/test/04-strict-isolation.test.mjs:32`,
`tools/model-digest.mjs:373`). Two sections execute exactly the moved symbols:

| Digest section | Moved symbols it exercises | Evidence |
| :--- | :--- | :--- |
| `diff` | `compareConnections` | `tools/model-digest.mjs:300-305` (`compareAll(api, …)`) |
| `graphValidation` | `buildAdjacencyList`, `parseExtractableSubgraphSelection`, `getRootNodes`, `getLeafNodes`, `hasPath` | `tools/model-digest.mjs:311-326` |

So in strict mode (no reference runtime) those two sections **will** change once the port is in place:
`PORT_DEPENDENT` and `portDependentSections` must gain `diff` + `graphValidation`, otherwise `test/04`
fails with "undeclared coupling" and the 34-difference figure becomes wrong for the wrong reason.
Expect the strict-mode declared-difference count to grow by up to **2 × 18 = 36** rows
(18 workflows × 2 sections; `01-empty-workflow` may stay identical if its graph is empty).
**`beforeVsAfter` must stay 252/252 identical** — that is the actual compatibility claim.

### 3.3 Cost

Small-to-medium, one focused unit for Agent 3 (contract + adapter) and one mechanical unit for Agent 1
(manifest + docs + regeneration). No reference source is touched; no public symbol moves; no Rust.

---

## 4. Option B — Workflow keeps them (cheapest, no code change)

Then `LEGO-MASTER-MAP.md` must be corrected instead, and Connection declares them as **consumed**:

* `contracts/connection.contract.md` gains: "consumed from Workflow LEGO: `graph/graph-utils` (10 symbols),
  `connections-diff` (`compareConnections`, `ConnectionsDiff`, `INodeConnectionsDiff`); reached via deep
  paths / barrel, frozen per `workflow.contract.md` §10".
* `workflow.contract.md` §3/§10 record them explicitly as **provided** (already implicit in the 15-symbol
  surface — this is the smaller edit).
* No manifest, gate, digest or port change; the master map's §3 row moves the two files to the Workflow row.

Status-quo cost: the master map stays inconsistent with `ownership.json` until Agent 5 edits §3, and the
Connection LEGO has no owned graph code of its own in Phase 2 — which is exactly the contradiction MSG-02
exists to end.

---

## 5. Risks, either way

| Risk | Mitigation |
| :--- | :--- |
| A public deep path disappears (`n8n-workflow/dist/cjs/graph/graph-utils.js`) | keep the barrel re-exports and the file's *contents* (a re-export shim) until Phase 3; `tools/reference-model-api.mjs:23-24` and `test/05` assert the assembled surface |
| Two LEGO gates disagree on the same tree (exactly today's failure mode, see `workflow-review-of-node-lego.md`) | sequence the cut **after** the reference-integrity fix; run both gates in the same Agent-5 pass |
| Digest baseline invalidated mid-flight | the re-extraction + `npm run verify` + Agent-5 re-confirmation in step A6 is the only accepted path; do not merge a moved module without it |
| Connection later needs `Workflow` internals | it must not: inputs are `IConnections` + names. If that changes, it is a new contract negotiation, not an import |

---

## 6. Recommendation

**Option A**, sequenced after the reference-integrity fix (`MSG-09`), because `graph/**` is the natural
home of pin mapping and Connection will need it in Phase 3 anyway — and because doing it now, while both
LEGOs are freshly verified, is cheaper than discovering the ownership ambiguity during the Rust port.
Agent 1's part (A2–A4) is mechanical once Agent 3 replies; until then the modules stay where
`manifest/ownership.json` puts them and no baseline moves.

---

## 7. Reproduce

```bash
cd reference/n8n/packages/workflow/src
grep -rn "graph/graph-utils\|connections-diff" --include="*.ts" . | grep -v "^./graph/graph-utils.ts\|^./connections-diff.ts"
wc -l graph/graph-utils.ts connections-diff.ts          # 273 + 87
sed -n '74,80p' index.ts                                # the barrel re-export list
sed -n '300,326p' ../../../../tools/model-digest.mjs    # the two sections that would become port-dependent
```
