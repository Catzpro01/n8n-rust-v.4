# TASK RESULT: TASK-306-node

- **STATUS**: `FAILED`
- **WORKER**: `arena-worker` (`arena/01a0ace3-n8n-rust-v-4`)
- **ROLE**: Node Model isolation/audit verifier
- **ALLOCATION NOTE**: dynamic task pool remained unreachable; local static-manifest fallback only, not a remote allocation.

## Ringkasan Inti
Memeriksa manifest Node Model dan subject branch `arena/01a0ac04-n8n-rust-v-4` pada tip `5d052dec` tanpa mengubah reference source, `crates/**`, atau `apps/**`. Subject commit yang diperiksa (`spec(node): acceptance pack wave 8`) hanya menambah enam artifact di `docs/isolation/**`; scan path menunjukkan nol perubahan pada forbidden paths. Recorded n8n 2.9.4 baselines dan fixture ledger berada di artifact subject (175 total fixtures; 11/11 live baseline is recorded), tetapi conformance/live smoke tidak dapat dijalankan dari sandbox ini, sehingga required acceptance and merge conditions remain unmet.

## Bukti Mesin

```text
$ git show --stat --oneline 5d052dec
5d052dec spec(node): acceptance pack wave 8 — displayParameterPath scoping + options required-issues; 165 -> 175 entries (MSG-19)
6 files changed, 433 insertions(+), 11 deletions(-)

$ git diff --name-only 5d052dec^ 5d052dec
 docs/isolation/node-bus-outbox.json
 docs/isolation/node-conformance-harness.md
 docs/isolation/node-fixtures.build.cjs
 docs/isolation/node-fixtures.json
 docs/isolation/node-golden-cases.md
 docs/isolation/node-results.md

$ for p in crates apps reference/n8n/packages/core reference/n8n/packages/cli; do
    git diff --name-only 5d052dec^ 5d052dec -- "$p"; done
# no output: PASS, no forbidden-path changes in the subject commit

$ git show 5d052dec:docs/isolation/node-results.md | grep -E 'golden:|TOTAL:'
golden: 168 | serde: 7 | TOTAL: 175

$ test -d /home/user/n8n-runtime && echo present || echo absent
absent
$ test -n "$N8N_URL" && echo set || echo unset
unset
```

The subject outbox records `n8n-workflow 48 files / 2015 PASS`, `8 files / 532 PASS` for the node subset, typecheck/build PASS, and an official `tests/reference/baseline/SMOKE_TEST_RESULTS.md = 11/11 PASS (VPS)`. Those are subject-worker records, not execution by this worker; the subject commit itself does not contain the listed baseline file, and the pinned runtime is unavailable here. The current branch also does not contain the subject's generator at `docs/isolation/node-fixtures.build.cjs`, so no local `--check` result is claimed.

## Operation Matrix

| Operation | Status |
| :--- | :--- |
| Read manifest/subject commit and path audit | PASS |
| Read subject Node artifacts and recorded evidence | PASS |
| Verify forbidden paths | PASS |
| `read_messages` / dependency response | NOT RUN — transport unavailable |
| Node conformance gate (target 21/21) | NOT RUN — subject generator/runtime unavailable in this checkout |
| Regression gate | NOT RUN — no remote allocation and no task-specific clean-room run |
| Live 11/11 smoke | NOT RUN — `N8N_URL` unset and pinned runtime unavailable |

No `VERIFIED`, `COMPLETED`, merge permission, or remote vote is claimed by this fallback result.
