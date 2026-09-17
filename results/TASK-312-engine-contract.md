# TASK RESULT: TASK-312-engine-contract

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 12:05 UTC`
- **MANIFEST**: [`tasks/TASK-312-engine-contract.yaml`](../tasks/TASK-312-engine-contract.yaml)

---

### Summary (padat)

`PROJECT_RULES.md` rule 5 requires every module to have a clear boundary and a formal contract, and
after five tasks `packages/reconstructed-engine` was the one module in `packages/` with 49 passing
tests but **no contract at all**. It now has `contracts/execution-engine.contract.md` — scope,
public surface, result shape, 14 numbered behavioural guarantees each tied to a reference line and a
test, determinism, a failure contract, explicit non-goals, provenance and verification hooks — plus
the `package.json` and `README.md` the other LEGO packages have. Because an unchecked contract is
just prose, `test/contract-conformance.test.mjs` parses the contract's machine-readable blocks and
holds the implementation to them: exports, prototype methods, instance fields, result keys, the
status vocabulary (checked against the real `ExecutionStatusList` in `reference/`), the declared
non-goals (comments are stripped first, so mentioning a word in prose cannot satisfy the check), and
— the part that rots first — **every `file:line` citation is verified to still point inside the
referenced file in `reference/n8n/`**. Writing the check found two real drifts immediately: two
entries I had listed as engine accessors are actually instance fields, and `runner.mjs` cites
`execution-status.ts` and `workflow.ts`, which were not registered in the citation table. The central
harness now enforces the contract's presence too (`CONTRACTS += 'execution-engine'` → 22/22).

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 56 · # pass 56 · # fail 0 · # skipped 0` (49 behaviour + 7 contract) | 0 |
| ↳ negative control (citation moved to `workflow-execute.ts:9100-9200`) | `not ok 6`, 55/56 → restored 56/56 | 1 → 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 22/22 CHECKS PASSED` (was 21/21 before `execution-engine` was added) | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (22/22 · AUDIT PASS · 56/56), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

Drift the new check caught while it was being written (i.e. the contract was wrong, not the code):

| finding | fix |
| :--- | :--- |
| `connectionsByDestinationNode`, `nodeTypeDescriptions` declared under `engineAccessors` | they are instance fields — contract now declares `engineAccessors: ["executionOrder"]` + an `instanceFields` list, both checked |
| `runner.mjs` cites `execution-status.ts` and `workflow.ts` | registered in the citation table; unknown files now fail the check, and all problems are collected in one run instead of failing on the first |

### Why the citation check matters

The whole premise of this repository is "never rewrite n8n from guesswork". That premise is only
true while the citations still point at the code they claim. The check turns a stale citation into a
build failure: if `reference/n8n` is ever bumped and `workflow-execute.ts` moves, every affected
`file:line` in `runner.mjs` and `graph.mjs` is reported at once, with the file's new line count.

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.
* No behaviour changed in this task: the 49 pre-existing cases pass unmodified, and the diff to
  `runner.mjs` is **zero lines** (only the contract, its test, packaging and docs).

### Handed to the next worker

1. The contract lists what is still out of scope (§7): `waitTill` resume, sub-workflows, credentials,
   expressions `{{ … }}`, the `sourceOverwrite` branch (`:1530-1541`, AI tool executions), and
   `requiredInputs` given as an expression string. Each needs its own LEGO's contract first.
2. `docs/isolation/` has no isolation blueprint for this module (`workflow.md`, `node.md`, … exist for
   the others); §1 of the contract covers the boundary, but a blueprint in the house format is still
   owed if the module is ever swapped or split.
3. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
