# @n8n-rust/persistence-lego

POOL-004 — 1:1 Node.js (ESM) reconstruction of the **n8n 2.9.4 Persistence LEGO pure core**
(`@n8n/db` utils + entity value layer + execution response shaping + save-settings policy).
ZERO RUST (PROJECT_RULES rule 1). The reference `editor-ui` is untouched (rule 5).
The driver/ORM layer (TypeORM entities, repositories' SQL paths, migrations, fs-store)
is **not** in this increment — see `contracts/persistence.contract.md` §12.2.

## Why "pure core"
Every unit here is observable without a database, which makes it verifiable in a
sandbox: byte-exact SQL builders, transformers, id generators, response shaping over
already-loaded rows, insert planning, and the save-settings decision table. Each is
pinned against the real pinned runtime (`n8n-workflow@2.9.1`, `flatted@3.2.7`,
`nanoid@3.3.8` — the exact dependency set of n8n@2.9.4) and against sha256 source pins
(`manifest/source-pins.json`).

## Layout
```
src/consumed.mjs          single seam for everything NOT owned (jsonParse,
                          migrateRunExecutionData, flatted, nanoid) — read-only
src/ports.mjs             P-PERSIST-CONFIG / P-PERSIST-REPORTER injection points
src/errors.mjs            UnexpectedError minimal twin
src/utils/                transformers, separate, is-string-array, sql,
                          get-final-test-result, generators, build-workflows-by-nodes-query
src/entities/             abstract-entity value layer (dialect column types, hooks, mixins)
src/repositories/         execution-shaping (find*/shaping, payload split, create plan,
                          markAsCrashed batches) + to-save-settings decision table
test/01..07               unit goldens + A/B parity (+2 evidence-correction pins:
                          'DEFAULT' raw-config asymmetry, flatted JSON-primitive throw,
                          shapeSingle includeData=false raw-annotation quirk)
manifest/source-pins.json sha256 of every ported reference file + sql whereClause hashes
```

## Run
```bash
scripts/setup-reference-runtime.sh        # repo root; provides the pinned runtime
npm test --prefix packages/persistence-lego   # 7 suites, 57 tests
```

Frozen truths live in `contracts/persistence.contract.md` §12.4 and as executable
assertions in `test/06-execution-shaping.test.mjs` + `test/07-consumed-parity.test.mjs`.
Two reference behaviors were corrected by machine evidence during this increment and
are pinned as quirks, not "fixed": the `toSaveSettings('DEFAULT')` raw-config passthrough,
and flatted's raw throw on JSON-primitive roots through the unflatten path.
