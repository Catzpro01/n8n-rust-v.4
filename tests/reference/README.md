# Golden Reference Workflows

Kumpulan workflow referensi standar untuk menguji kepatuhan validator dan engine Rust terhadap n8n asli:
1. `01-empty-workflow`: Validasi workflow kosong.
2. `02-one-node`: Validasi satu node trigger tanpa koneksi.
3. `03-linear`: Validasi alur linear sederhana (Trigger -> Code).

---

## Execution Data & Expression reference cases (Agent 3)

Behavioural cases recorded from the **real** n8n 2.9.4 runtime packages
(`n8n-core@2.9.1` + `n8n-workflow@2.9.1`, the exact versions pinned by `n8n@2.9.4`).
`expected.json` files are never hand-written – they are snapshots of observed behaviour.

```text
tests/reference/
├── harness/                 node harness driving WorkflowExecute + Workflow.expression
│   ├── harness.js           deterministic stand-in node types (ref.*)
│   └── run.js               case runner / snapshot writer
├── execution-data/
│   ├── 01-single-item
│   ├── 02-multiple-items
│   ├── 03-item-pairing
│   ├── 04-multiple-output
│   ├── 05-empty-data
│   ├── 06-binary-reference
│   └── 07-item-helpers      (extra)
└── expression/
    ├── 01-json-access
    ├── 02-input-access
    ├── 03-node-data-access
    ├── 04-multiple-items
    ├── 05-missing-property
    └── 06-expression-inside-parameter
```

Run:

```bash
cd tests/reference/harness
npm install                      # pulls n8n-core@2.9.1 / n8n-workflow@2.9.1 (not committed)
node run.js                      # all 13 cases
node run.js execution-data       # 7 cases
node run.js expression           # 6 cases
UPDATE=1 node run.js             # re-snapshot from the runtime (only when the reference version changes)
```

Each case directory: `case.json` (input), `expected.json` (observed 2.9.4 output), `README.md` (what it proves).
A case whose behaviour cannot be proven from the runtime must have `{"UNKNOWN": "<reason>"}` as `expected.json`; currently there are none.

Contracts: `contracts/execution-data.contract.md`, `contracts/expression.contract.md`.
Isolation docs: `docs/isolation/execution-data.md`, `docs/isolation/expression.md`, `docs/isolation/dependencies.md`.
