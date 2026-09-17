Integrated peer commits `7ef51ab0` and `b60b7d09` after an isolated `107/107` strict-runtime run and line-by-line comparison with the pinned n8n 2.9.4 partial-execution utility sources; source-identical quirks in `toIConnections` and cycle filtering were deliberately preserved.

The final package exposes ten graph/run-data planning helpers through the machine-checked `@lego/reconstructed-engine/partial` subpath, preserves engine guarantees G1-G27, adds G28-G29, scans the new module in the non-goal guard, and makes both parity files fail rather than skip when strict reference mode is required.

`npm run engine:test:strict` passed `114/114` with zero failures or skips, while `npm run verify` passed `11/11` with local live `7/7` and no behavior change; conformance passed `22/22`, boundary and ZERO-RUST audits passed, fixtures matched, and offline gate stages 1-3 passed.

The full editor partial-run path remains explicitly incomplete until `DirectedGraph#toWorkflow`, `findStartNodes`, source-data grouping, execution-stack recreation, graph rewiring, and `WorkflowExecute#runPartialWorkflow2` are reconstructed.
