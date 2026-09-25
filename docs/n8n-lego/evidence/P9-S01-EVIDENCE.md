# P9-S01 — Per-node execution cost/resource ledger correlated with P9 telemetry

**Issue:** #224 item 20
**Status:** implemented
**Branch:** `delivery/p9-s01-node-cost-ledger`
**Contract:** `observability.node-cost-ledger@1.0.0` (owner `agent-6`)

## 1. The gap this slice closes

P9 already answers two questions well and a third not at all:

| Question | Answer today | Where |
|---|---|---|
| *Which node did this failed execution stop at?* | yes, correlated to workflow/version/trigger/node/runtime | P9.11 `execution-diagnostics.mjs` |
| *Is the runtime under pressure right now?* | yes, with a provenance ladder | P9.9 `resource-pressure.mjs` |
| **What did this node cost, and is that number measured or derived?** | **no answer** | — |

The third question is the one a capacity decision (P8) or a per-tenant accounting
surface has to answer *before* it may act. A node that reports "412 ms" without
saying whether that was measured or extrapolated is not a cheaper answer, it is
an unverifiable one — and unverifiable numbers are exactly what this plane exists
to refuse.

## 2. What was built

`apps/n8n-lego/src/lego/node-cost-ledger.mjs` — a pure, no-I/O, no-clock contract
in the P9 house style:

- `createNodeCostRow(spec)` — one cost/resource row. Fail-closed: returns `null`
  on invalid or secret-shaped input.
- `createNodeCostLedger(opts)` — a bounded accumulator with `add`, `entries`,
  `byNode`, `correlate` and `serialize`.
- `fingerprintRow(identity, outcome)` — the stable join key.
- `costDimensionsAllowed(dimensions)` — the P9.7 redaction pre-check.

Registered on the **`observability`** domain in
`apps/n8n-lego/src/lego/manifest/domains.json` (`src/lego/node-cost-ledger.mjs`),
which is why `lego:arch` passes: the module imports `telemetry-redaction.mjs` and
`execution-diagnostics.mjs`, both already in that domain.

## 3. Correlation is with P9 telemetry, by construction

`COST_IDENTITY_FIELDS` is **not** a new list. It is a re-export of
`EXEC_DIAG_IDENTITY_FIELDS` from P9.11:

```
executionId, workflowId, workflowVersion, triggerId,
nodeId, nodeType, nodeVersion, runtimeId
```

A cost row that could not be joined to a diagnostic would be a second, parallel
truth about the same execution — and two truths about one execution is precisely
the drift this plane is meant to prevent. A test asserts the two lists are
identical so this cannot silently diverge later.

## 4. Provenance is mandatory, and it is the P9.9 ladder

`COST_VALUE_PROVENANCE` re-exports P9.9's `['OBSERVED', 'ESTIMATED', 'REPORTED']`.

- `provenance` is a **required** field. A row without it is refused: an
  unmeasurable claim is not a cheap row, it is a false one.
- `REPORTED` means a provider actually reported the value. Nothing in this module
  promotes a number to `REPORTED` because it looks plausible — there is no
  code path that can do so.
- An entry whose totals mix provenances reports `mixedProvenance: true`, so a
  consumer cannot read a mixed total as if all of it were measured.

## 5. Bounded — and over-limit is refused, not truncated

`COST_LIMITS`: `maxNodes 256`, `maxSamplesPerNode 64`, `maxLedgerRows 4096`,
`maxWireBytes 16384`, `identifierBytes 128`.

`add()` returns `false` when the ledger refuses a row. It never evicts a recorded
node and never truncates a dimension. A ledger that silently drops rows
under-reports spend — the failure mode this slice exists to make impossible — so
the refusal is surfaced to the caller instead of absorbed. `serialize()` returns
`null` rather than emitting an oversized document.

## 6. Secret-safe

Every string entering a row passes `containsSecretShape`; every dimension map is
additionally gated by `classifyTelemetryField`. A secret-shaped label or ref
refuses the whole row, so a credential cannot become a cost dimension.

## 7. Aggregation model

Three scopes are declared — `per-node`, `per-execution`, `per-workflow` — but only
`per-node` is recorded. The other two are **derived views** over the same rows
(`entries()` and `byNode()`), so they can never disagree with the ledger.

The fingerprint is over identity and outcome only, **never** over the measured
values: the same node in the same execution must fingerprint identically whether
it cost 4 ms or 40, so a retry or a re-measure joins to the row it belongs to
instead of forking a new one.

`correlate(rows)` reports unmatched fingerprints as `unmatched` rather than
dropping them. An orphan cost row is evidence that the telemetry stream and the
ledger disagree, and hiding it would hide the drift. Coverage of an empty set is
`null`, not `100%`.

## 8. Tests

`apps/n8n-lego/test/lego-node-cost-ledger.test.mjs` — **33 tests, 33 pass**,
fixture `apps/n8n-lego/test/fixtures/p9/node-cost-ledger.json`.

| # | Area | Assertion |
|---|---|---|
| 1 | contract | id / version / owner, all four vocabularies, all five limits |
| 2 | correlation | `COST_IDENTITY_FIELDS` deep-equals P9.11 `EXEC_DIAG_IDENTITY_FIELDS` |
| 3 | bounds | every declared dimension has a positive bound |
| 4 | rows | frozen row, frozen identity/dimensions, `NC:v1:<8 hex>` fingerprint |
| 5 | optional fields | outcome defaults to `success`; unit/at/refs carried when safe |
| 6 | fingerprint | identical for cheap vs expensive; differs on nodeId and outcome |
| 7 | fingerprint | ignores key order in the supplied identity |
| 8 | correlation | row without `executionId` or `nodeId` refused |
| 9 | provenance | missing or unknown provenance refused |
| 10 | fail-closed | all 15 fixture rejection cases return `null` |
| 11 | fail-closed | `Infinity`, `NaN` and string-valued dimensions refused |
| 12 | secrets | secret-shaped label and ref refused |
| 13 | shape | unknown spec key refused — no silent extra cost dimension |
| 14 | bounds | oversized identifier refused; at-bound accepted |
| 15 | time | non-ISO-8601-Z timestamp refused |
| 16 | aggregation | 3 samples of one node invocation → one entry, `samples: 3`, summed totals |
| 17 | provenance | mixed-provenance entry reports `mixedProvenance: true` |
| 18 | provenance | pure-`OBSERVED` entry is not marked mixed |
| 19 | rollup | `byNode()` aggregates across executions, keeps nodeType |
| 20 | edge | a node with no duration is still an invocation |
| 21 | integrity | malformed rows refused; `rows` stays `0` |
| 22 | bounds | `maxNodes` refused without evicting a recorded node |
| 23 | bounds | `maxSamplesPerNode` refused |
| 24 | bounds | out-of-range ledger constructors refused |
| 25 | bounds | ledger reaches `maxLedgerRows` and then refuses |
| 26 | window | `firstAt`/`lastAt` track the sample window |
| 27 | drift | unmatched row reported as drift, coverage `2/3` |
| 28 | honesty | coverage of an empty set is `null`, not `100%` |
| 29 | shape | `correlate` of a non-array refused |
| 30 | wire | bounded serialisation, contract id/version, per-node totals |
| 31 | wire | oversized serialisation refused, not truncated |
| 32 | secrets | secret-shaped dimension map rejected before it becomes a row |
| 33 | provenance | `ESTIMATED` stays `ESTIMATED`; `REPORTED` accepted with a unit |

## 9. Verification

| Gate | Result |
|---|---|
| `lego-node-cost-ledger.test.mjs` | **33 / 33 pass** |
| `lego:arch` (backend LEGO architecture gate) | **OK** — every import respects its declared boundary |
| `lego:capabilities` | ok |
| `lego:scaleout` | ok |
| `lego:foundation` | ok |
| `lego:arch:selftest`, `lego:foundation:selftest` | ok |
| `lego:ai` + `lego:ai:check` | ok (in sync) |
| `governance-register.mjs check` | exit 0 |
| `governance-register.test.mjs` | 74 / 74 |
| `live-progress.test.mjs` | 25 / 25 |
| `lego-machine-identity.test.mjs` | 57 / 57 |
| `lego-authorization.test.mjs` | 35 / 35 |
| `lego-capability-contract.test.mjs` | 33 / 33 |
| `lego-contract-oracle.test.mjs`, `lego-boundary.test.mjs` | 35 / 35 |
| `compat.contract.test.mjs` | 14 / 14 |
| `frontend.boundary.test.mjs` | 11 / 11 |
| `lego-freshness.test.mjs` | 13 / 13 |
| `public-api-v1*.test.mjs` (3 files) | 76 / 76 |
| Full `apps/n8n-lego` suite (115 files) | **2615 pass / 3 fail** |

### 9.1 The 3 failures are pre-existing on `main`, not from this slice

`apps/n8n-lego/test/rest.test.mjs` fails 3 tests:

- `GET /rest/types/nodes.json serves the node catalog` — 404 ≠ 200
- `GET /rest/types/node-versions.json lists name@version identifiers` — 404 ≠ 200
- `POST /rest/node-types returns descriptions for requested versions` — 404 ≠ 200

These were reproduced on a **pristine `main` with every P9-S01 change stashed**
(including untracked files): `# pass 9 # fail 3`. They are an out-of-scope
pre-existing condition in the node-catalog REST surface, isolated and recorded
here per §22. No workflow, Cargo, runner-config, `crates/`, `contracts/` or
`packages/` file is touched by this slice.

## 10. Not delivered here

- **No cost attribution to a tenant or billing entity.** The ledger is per-node
  and per-execution; a per-tenant rollup is a P8 concern that needs its own
  authorization surface, and inventing one here would be unauthorized scope.
- **No persistence or retention policy.** The ledger is an in-memory bounded
  accumulator. P9.15 owns retention; wiring this into HOT/WARM/COLD is a
  follow-up that must inherit P9.15's policy rather than re-declare it.
- **No engine instrumentation.** Nothing in the workflow runtime calls the
  ledger yet. That wiring is deliberately a separate slice so this contract can
  be locked and reviewed on its own first.
- **No provider-reported billing data.** `REPORTED` is accepted and preserved,
  but no provider connector exists to populate it.
