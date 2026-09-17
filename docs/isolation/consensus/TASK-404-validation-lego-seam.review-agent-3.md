# Consensus review — TASK-404-validation-lego-seam (agent-4)

| Field | Value |
|---|---|
| Reviewer | `agent-3` (LEGO 03 `connection`) |
| Reviewed artefact | branch `arena/01a0ac06-n8n-rust-v-4` @ `49e55ece` (36 commits ahead of main `b809399b`); `results/TASK-404-validation-lego-seam.md`; `packages/validation-lego/**` |
| Protocol | `docs/isolation/STANDING-WORKER-PROTOCOL.md` Tahap 2 — written rubric |
| **VOTE** | **APPROVED** |

## Rubric

### 1. Aturan jalur berkas — PASS
`git diff --name-only origin/main..49e55ece` outside the task's own areas yields only `contracts/validation.contract.md`
(agent-4's contract), `package.json` (3 script entries, additive) and `tasks/TASK-307-validation-audit-request.yaml`
(agent-4's manifest). No `crates/**`, `apps/**`, `reference/n8n/**`, no other agent's `packages/*-lego`.
`grep` over `packages/validation-lego/src` shows zero imports from `workflow-lego`/`connection-lego`/`reference/n8n` —
seam-only rule respected.

### 2. Integritas golden oracle (n8n 2.9.4) — PASS, independently re-executed
- Recomputed `sha256sum` of `reference/n8n/packages/workflow/src/{type-validation,type-guards,schemas}.ts` on my
  checkout: `e7a1fb31…`, `8d7853d4…`, `e6e43809…` — byte-equal to the pins in `manifest/ownership.json`.
- `src/validation-surface.ts` binds reference functions **by identity** (`export const validateFieldType =
  typeValidation.validateFieldType`), so no algorithm can have been rewritten (test 02 asserts `===`).
- `rules/` is correctly kept out of the reference surface and labelled NEW CAPABILITY (ISSUE-003 Option A), consistent
  with `contracts/connection.contract.md` §3.6 / CD-06 — cyclic graphs are not rejected by default.

### 3. Keberadaan bukti nyata — PASS
Reproduced in a detached worktree of `49e55ece`:
```
$ N8N_RUNTIME=tests/reference/harness node --test packages/validation-lego/test/*.test.mjs
# pass 13  # fail 0  # skipped 0
```
Matches the summary's claim (13/13). Physical deliverable: `manifest/`, `src/{adapters,rules,validation-surface.ts}`,
4 gate tests, README.

## Non-blocking notes
- `README`/summary say `52 exports, 45 owned, 7 execution/event-bus schemas excluded` — the excluded 7 should end up
  declared as a consumed port of LEGO 05 once `packages/core-lego/` exists; worth a row in `manifest/ownership.json`.
- Shared duplicate of the 13 `NodeConnectionTypes` values now lives in three places (validation rules,
  connection-lego kernel, workflow-lego snapshots). Fine while each is drift-checked; a single kernel package later.
