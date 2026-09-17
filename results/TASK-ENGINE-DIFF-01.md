# TASK RESULT: TASK-ENGINE-DIFF-01

- **STATUS**: `SUCCESS`
- **AGENT**: `arena-worker`
- **LEGO COMPONENT**: `integration`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 17:15:00 UTC`

---

### Summary (3–5 kalimat)

Harness diferensial `tools/engine-differential.mjs` (informasional, bukan gate) menjalankan 8 skenario identik di kedua engine JS: `19 agree / 5 diverge / 0 not-comparable` dari 24 perbandingan, tanpa harness error. Temuan kunci: (1) S5 terkonfirmasi silang — kedua engine sepakat hard-throw+continueErrorOutput→output-0 sesuai bacaan kode-literal R5; (2) S3 `finished` — prototipe (`false`) sesuai referensi L2438, rekonstruksi (`true`) menyimpang; (3) S6 split — prototipe benar per R7/R8, rekonstruksi menghapus semua data karena `getMainOutputCount(description)` tak menghitung error-output R8 (tes E2E-nya lolos hanya karena fixture mendeklarasikan 2 output); (4) S7 disabled — rekonstruksi benar per `handleDisabledNode` L909-920 (passthrough), prototipe salah (skip membuat downstream kelaparan). Adendum bertanggal + bertanda ditambahkan ke ISSUE-021 (append-only); kedua paket engine 100% tak disentuh. `verify:all`, `42/42`, dan boundary audit tetap hijau.

### Evidence

- `node tools/engine-differential.mjs` → `DIFFERENTIAL: 19 agree / 5 diverge / 0 not-comparable across 24 comparisons (0 harness errors)` (exit 0)
- S6 root-cause probe: reconstruction `Mixed data: {"main":[[]]}`, `Sink/ErrSink: undefined` (single declared output + onError=continueErrorOutput)
- S7 reference: `handleDisabledNode` L909-920 + call site L1199; S3 reference: `finished=true` only when no error/waitTill L2438
- `npm run verify:all` → isolation:check PASS + reconstructed 21/21 + execution gate 8/8 (exit 0)
- `node tests/compatibility/contract_conformance.mjs` → `42/42` (exit 0); `boundary_audit.py` → `PASS` (exit 0)
- `git status` untuk kedua paket engine: bersih (read-only dihormati)

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `write_file` (tools/engine-differential.mjs) | ✓ SUCCESS | `0` |
| `run_shell` (differential 19/5/0, exit 0) | ✓ SUCCESS | `0` |
| `debug_probe` (S6 root cause: getMainOutputCount +1 miss) | ✓ SUCCESS | `0` |
| `read_reference` (disabled L909-920/L1199, finished L2438) | ✓ SUCCESS | `0` |
| `edit_file` (CROSS-AGENT-ISSUES.md ISSUE-021 addendum) | ✓ SUCCESS | `0` |
| `run_shell` (verify:all green) | ✓ SUCCESS | `0` |
| `run_shell` (contract_conformance 42/42) | ✓ SUCCESS | `0` |
| `run_shell` (boundary_audit PASS) | ✓ SUCCESS | `0` |
| `write_file` (results/TASK-ENGINE-DIFF-01.md) | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: `run_shell` (differential 19/5/0, exit 0)

```text
[AGREE] S1 x3, S2 x3, S4 x3, S5 x2, S8 x1 (incl. cross-confirmed R5 routing)
[DIVERGE] S3 finished flag — A=false B=true (ref L2438 → A matches)
[DIVERGE] S6 success-branch — A=[{"clean":true}] B=[] (ref R7/R8 → A matches)
[DIVERGE] S6 error-branch — A=[{"id":7,"error":"bad row"}] B=[] (ref R7/R8 → A matches)
[DIVERGE] S7 disabled task — A=null B=[success passthrough task] (ref L909-920 → B matches)
[DIVERGE] S7 downstream — A=null B=[ran with input] (ref L909-920 → B matches)
DIFFERENTIAL: 19 agree / 5 diverge / 0 not-comparable (0 harness errors)
```

#### Operation: `debug_probe` (S6 root cause)

```text
Peer handleNodeErrorOutput (workflow-execute.mjs:679-711) counts via
getMainOutputCount(nodeType.description) — description-level, no onError
visibility — while R8 (node-helpers.ts:1170) appends from the NODE. Declared
['main'] + onError=continueErrorOutput → count 1 → splitErrorOutputs sets
nodeSuccessData[0] = [] (total loss). Their 03-suite split test declares
['main','main'], masking the wiring gap. Harness's own S6 accessor bug
(ErrSink branch 1→0) fixed and re-run before recording.
```

### Files changed (all within `allowed_paths`)

- `tasks/TASK-ENGINE-DIFF-01.yaml` (new)
- `tools/engine-differential.mjs` (new)
- `docs/isolation/CROSS-AGENT-ISSUES.md` (append-only ISSUE-021 addendum)
- `results/TASK-ENGINE-DIFF-01.md` (new, this file)
