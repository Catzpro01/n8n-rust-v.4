# P3 Slice H — Workflow DNA — Evidence (Issue #97, planning #75/#91)

- **Milestone:** P3.7 · **Slice:** H — bounded Workflow DNA (§30 workflow DNA; oracle fast-path + stress identity for #75)
- **Branch:** `feat/p3-workflow-dna` · **Baseline (frozen):** protected main `a3a0237bfa35a678f8bd679e40099a89255604bb` (post-Slice-G #120; open PRs `[]` at fork)
- **Slice boundary:** DNA summary only. NOT caching policy (K), NOT oracle logic (L — DNA is its fast-path input), NOT the graph (A), no executor.

## §1 Deliverable

New module `apps/n8n-lego/src/lego/workflow-dna.mjs` — contract **`workflow.dna@0.1.0`** (lock row **36**, owner `agent-1`, domain `workflow`, no capability/REST):

- **Exact identity:** `dna.checksum` IS `calculateWorkflowChecksum` (n8n-editor contract checksum — order-sensitive; asserted equal).
- **Morphology block (order-insensitive by design):** `nodeCount`, `edgeCount`, `type@typeVersion` histogram (sorted keys), `rootCount`/`leafCount` + **first-64 samples**, `maxFanOut`, `maxFanIn`, orphan connection keys (count exact + first-64), sorted `headerFields`.
- **Bounded summary:** every name list capped at `WORKFLOW_DNA_LIST_CAP = 64` → a 5,000-node all-roots graph yields a **< 4 KB** DNA (asserted); 1M-node run measured at **1,143 bytes**.
- **Single pass**, no adjacency retained; only import = `../checksum.mjs` (same workflow domain seam — asserted import list); no clock/fs/network/timers/randomness (source-scanned); one error family.
- **Structural truth:** orphan-source edges count toward fan-in (Ghost→Start ⇒ zero roots — asserted); duplicate/missing names fail closed like the graph (identity rule family).
- **Metamorphic (#91 flavor):** node-array shuffle changes only `checksum`; histogram/counts/degrees/leaf-set preserved (asserted).

## §2 Governance edits

- lock row 36 `workflow.dna@0.1.0` (R9: workflow 0.1.0); **count-pins 35 → 36 in 11 files** (the 9 carry-forwards + frontier + state-stream row-test pins — per-file anchored replacements, one anchor corrected from the ORIGINAL line after a first-pass miss, verified zero stale pins afterward).
- `domains.json#workflow.paths` += `src/lego/workflow-dna.mjs` (capabilities 4, status `partial` untouched).
- `BACKEND_LEGO.md` changelog +1 · `.ai` regenerated (64/37/101).

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `lego-workflow-dna.test.mjs` | **6/6 PASS** (combined focused run with graph/frontier/state: **58/58**) |
| 7 gates | **7/7 PASS** |
| backend full | **956 · 953 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |

## §4 Performance gate — measured (single-run)

| metric | measurement |
| :--- | :--- |
| DNA of 1,000,000-node workflow | **4,369 ms** one pass · output **1,143 bytes** · root sample 64/1,000,000 |
| DNA of 5,000 all-root nodes | **< 4,096 bytes** (asserted upper bound in-suite) |

## §5 Non-scope held

No cache/oracle/optimizer logic (their slices), no graph changes, no capability/REST, no P4+.

**Milestone P3.7 remaining:** none — completion recorded on Issue #97 post-merge.
