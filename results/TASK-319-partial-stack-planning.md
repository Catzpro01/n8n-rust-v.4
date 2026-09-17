Reconstructed the remaining in-memory n8n 2.9.4 partial-planning layer in JavaScript: dirty/start-node selection, deterministic source grouping, sparse waiting-state mutators, execution-stack recreation, and AI-tool graph rewiring with the pinned virtual-executor constant.

Twelve new cases cover branching, output filtering, cycles, Loop Over Items, complete/pinned/incomplete/repeated inputs, strict disabled-node invariants, sparse arrays, and nested tools; every case compares n8n-core 2.9.1 in strict mode, including deep modules omitted from its root barrel.

`npm run engine:test:strict` and offline gate stage 3 passed `126/126` with zero failures or skips and 48 runtime-differential cases, while contract checks passed `8/8`, compatibility passed `22/22`, `npm run verify` passed `11/11` with local live `7/7` and no behavior change, and boundary, fixture, reference-integrity, and ZERO-RUST checks passed.

End-to-end editor partial execution remains explicitly bounded to the next integration: `DirectedGraph#toWorkflow` and `WorkflowExecute#runPartialWorkflow2` still need to compose this planning state with the reconstructed execution engine.
