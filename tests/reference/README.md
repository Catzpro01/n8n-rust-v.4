# Golden Reference Workflows

Kumpulan workflow referensi standar untuk menguji kepatuhan validator dan engine Rust terhadap n8n asli:
1. `01-empty-workflow`: Validasi workflow kosong.
2. `02-one-node`: Validasi satu node trigger tanpa koneksi.
3. `03-linear`: Validasi alur linear sederhana (Trigger -> Code).

---

## GOLDEN REFERENCE PROTECTION (Agent 5 — brief §13)

Files under `tests/reference/` are **golden**: they encode observed n8n 2.9.4 behavior.

**A golden fixture or expected result may never be changed to make a failing test pass.**

Any change to `tests/reference/**` must be accompanied, in the same commit message or in a
`docs/isolation/CROSS-AGENT-ISSUES.md` entry, by all four of:

1. **Evidence** — actual output from n8n 2.9.4 (HTTP response, CLI output, DB row).
2. **Reason** — why the previously recorded behavior was wrong.
3. **Source reference** — `reference/n8n/...` file:line implementing the new behavior.
4. **Behavior explanation** — what changes for a downstream consumer.

A golden change without all four is **REJECTED** by the integration gate.
The 11/11 baseline in `baseline/SMOKE_TEST_RESULTS.md` is immutable for Phase 2.
