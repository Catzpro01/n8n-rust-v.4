# 05 — cyclic workflow (NEGATIVE golden fixture)

`A → B → C → A`. This fixture **must be rejected**.

It exists because every other golden fixture is a positive case: a `detectCycles` hardcoded to
return "acyclic" passes all of them. A suite with no negative case cannot fail, so it cannot be
evidence. Removing the `C → A` edge from this file must turn the offline gate red — that is the
meta-test.

Directory-name convention: a fixture whose directory ends in `-invalid` is a negative case, and
`tests/compatibility/contract_conformance.mjs` **fails if it is accepted**.

Expected, from `contracts/validation.contract.md` §3 and the TypeScript reference implementation
`tests/reference/agent-4/validation/workflow-rules.ts:117` (`detectCycles`, iterative DFS over
`main` edges, first back-edge reported as a path):

```text
code: CYCLE_DETECTED
node: A            (the back-edge target; DFS visits A → B → C → A in node order)
```

Consumed by:

* `tests/compatibility/contract_conformance.mjs` — negative-fixture check (offline gate, Stage 1);
* `crates/n8n-workflow/tests/conformance.rs::test_fixture_cyclic_workflow_is_rejected` — the Rust
  `detect_cycles` must reject it too.
