# Agent-4 review (Tahap 2, STANDING-WORKER-PROTOCOL) — TASK-303-connection

| Field | Value |
| :--- | :--- |
| Reviewer | `agent-4` (LEGO 04 `validation`) |
| Reviewed task | `tasks/TASK-303-connection.yaml` — agent-3, `packages/connection-lego/` seam |
| Reviewed at | `arena/01a0ac05-n8n-rust-v-4` @ `a214cc40` (main `b809399b` merged), checked out in a throw-away worktree |
| Requested by | `request_review` in TASK-303 manifest (reviewers: agent-1, agent-4, agent-5) |
| Why agent-4 | Validation (`DanglingConnections`, D-rules) is the declared consumer of `P-CONNECTION-GRAPH`; contract §3.1–3.2, CD-06 |

## Vote: **APPROVED**

### Rubrik 1 — Jalur berkas ✅

```
$ git diff --name-only origin/main...a214cc40 | grep -E '^(reference/n8n/|crates/|apps/|tools/|packages/workflow-lego/|contracts/(workflow|node))'
(empty)   → forbidden hits: 0
```

All 28 commits touch only: `packages/connection-lego/**`, `docs/isolation/connection*`, `tests/reference/connection/**`,
`tests/reference/harness/{rust/**,tools/simulate-connection-port.py,connection.js}`, `tests/reference/README.md`,
`tasks/TASK-303-connection.yaml`, `results/TASK-303-connection.md` — every one inside `allowed_paths`.
`tools/**` hits are `tests/reference/harness/tools/` (agent-3 area), not root `tools/`.

### Rubrik 2 — Integritas golden oracle (n8n 2.9.4) ✅

| Check | Command / probe | Result |
| :--- | :--- | :--- |
| Existing goldens untouched | `git diff --stat origin/main...HEAD -- tests/reference/connection/0[1-5]*` | empty — cases 01–05 byte-identical |
| 06/07 `expected.json` | `git log --diff-filter=A` → `7037e3d5` | **new** cases (added, not mutated) |
| `reference/n8n/**` | name-only diff | 0 files |
| Vendored strict copies vs reference | `sha256sum` of 6 files, then `diff` after normalising the import path | content differs **only** by `'../interfaces'` → `'<kernel>/…​.ts'` rewrite, exactly as declared in `src/adapters/strict/index.ts:5` |
| Manifest `pinnedSha256` vs `reference/n8n/packages/workflow/src/*` | exercised by `test/01-boundary.test.mjs` | PASS (see Rubrik 3) |
| Fixture replay vs oracle | `test/02-fixture-conformance.test.mjs` reference **and** strict modes, cases 01–07 | 14/14 PASS |

No algorithm is rewritten; the seam re-exports the reference functions through the adapter. Behaviour claims in
`connection-workflow-members-spec.md` (destinationIndex = slot position, `disabled === false` quirk, `indicies` merge)
were already re-executed by me against the live runtime in `TASK-402-connection-spec.review-agent-4.md` — all matched.

### Rubrik 3 — Bukti nyata ✅

```
$ cd packages/connection-lego
$ LEGO_REFERENCE_PKG=/home/user/n8n-runtime/node_modules/n8n-workflow node --test test/*.test.mjs
# tests 17  # pass 17  # fail 0  # skipped 0

$ LEGO_REFERENCE_PKG=/nonexistent node --test test/04-strict-isolation.test.mjs
# pass 1 (strict module graph contains no n8n-workflow / node_modules)   # fail 1 (strict==reference comparison needs the oracle — expected)
```

Deliverable is physical: `src/model-surface.ts` (12 fn + `compareConnections`), `src/kernel/vocabulary.ts` (13
`NodeConnectionTypes`), reference + strict adapters, `manifest/ownership.json`, 4 test files, README. Matches the
17/17 claim in `results/TASK-303-connection.md`.

### Non-blocking notes (no vote impact)

1. **Default runtime resolution.** Without `LEGO_REFERENCE_PKG`, `_setup.mjs` falls back to
   `tests/reference/harness/node_modules` which is not committed; in a fresh sandbox this yields 8/17 with an opaque
   `TypeError: The argument 'filename' must be … absolute path string. Received 'n8n-workflow/package.json'`
   (`src/ports/runtime.ts:37`). Suggest failing loud with "reference runtime not installed — set LEGO_REFERENCE_PKG"
   (validation-lego does this via `REJECTED ERR_MODULE_NOT_FOUND`). Does not affect correctness.
2. Agent-3's note 1 in `connection-review-of-validation-lego.md` is accepted: when validation-lego consumes
   `P-CONNECTION-GRAPH`, the 13-value vocabulary should be imported from `connection-lego/src/kernel/vocabulary.ts`
   instead of duplicated in `workflow-rules.ts`. Tracked in results/TASK-404 as follow-up (not a scope change now).
