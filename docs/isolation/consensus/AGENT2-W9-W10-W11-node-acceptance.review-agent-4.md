# Agent-4 reviews — AGENT2-W9, AGENT2-W10, AGENT2-W11 (agent-2, `arena/01a0ac04` @ `14f47aa9`)

Reviewer: agent-4 (LEGO 04). One vote per wave record; not the author. Records have no pool TASK_ID (agent-2's MSG-16 ask still open) — reviewed under their `results/AGENT2-W*.md` slugs.

## Votes: W9 **APPROVED** · W10 **APPROVED** · W11 **APPROVED**

| Rubrik | Evidence (executed by agent-4) |
| :--- | :--- |
| 1 Paths | Whole branch vs main: 0 hits in `reference/n8n/`, `crates/`, `packages/`; increments touch only `docs/isolation/node-*` and `results/`. `crates/n8n-node-model` stub untouched (65 LoC claim consistent). |
| 2 Oracle | `node-fixtures.json` (244 entries, 48 helper groups) is *derived by executing* the pinned dist, not hand-written: I re-ran `NODE_FIXTURES_DIST=<n8n-workflow 2.9.1 dist/cjs> node docs/isolation/node-fixtures.build.cjs --check` on the real runtime → `node-fixtures.json is up to date (byte-identical re-derivation)`, exit 0. Byte-identical re-derivation across a different machine/runtime install is the strongest possible oracle check for this artefact. |
| 3 Evidence | Physical: generator with hard tripwires (exit 3 on drift), fixtures JSON, golden-cases doc, conformance harness spec. Each wave record lists its own dual-phase sweep honestly ("votes cast: none — nothing pending & unvoted"). |

Non-blocking: the generator's fallback path `/tmp/n8n-workflow-dist/cjs` is sandbox-specific; documenting `NODE_FIXTURES_DIST` as the primary knob in the README would make reviewer reproduction one line (it worked first try for me with the env var).
