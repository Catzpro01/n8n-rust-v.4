# 06 — invalid connection type (NEGATIVE golden fixture)

Two distinct violations in one workflow, mirroring `INVALID_CONNECTION_TYPE` in
`contracts/validation.contract.md:35` and the reference implementation
`tests/reference/agent-4/validation/workflow-rules.ts:53-64`:

| Edge | Violation | Reference path |
| :--- | :--- | :--- |
| `A → B` under key `main` | the edge declares `"type": "bogus"`, which is not a `NodeConnectionTypes` value | `["connections", "A", "main", "0", "0", "type"]` |
| `A → C` under key `ai_magic` | the *output key* is not a `NodeConnectionTypes` value | `["connections", "A", "ai_magic"]` |

The two paths have **different shapes on purpose**. The key violation stops at the key
(`workflow-rules.ts:89`); the edge violation locates the offender by output and target *index*
(`workflow-rules.ts:94` builds `['connections', source, type, String(oi), String(ti)]`, and `:103`
appends `'type'`). The offending *value* never appears in the path — it appears in the `message`.
Both shapes are pinned by the generated fixtures in
`tests/reference/agent-4/validation/fixtures.json` (`X7-target-type-bad-only`, `D5-bad-type-key`).

The `A → C` edge deliberately declares the **valid** `"type": "ai_tool"`, so exactly one violation
comes from that pair of entries. If it declared `ai_magic` there too, the fixture would report
three offenders and stop discriminating between the two checks.

`ai_magic` is deliberately not in the 13-value reference set
(`reference/n8n/packages/workflow/src/interfaces.ts:2249-2266`): `ai_agent`, `ai_chain`,
`ai_document`, `ai_embedding`, `ai_languageModel`, `ai_memory`, `ai_outputParser`, `ai_retriever`,
`ai_reranker`, `ai_textSplitter`, `ai_tool`, `ai_vectorStore`, `main`.

Both sites must be reported, in that order — the reference iterates `Object.entries(sourceNodeOutputs)`,
so the per-edge check of the earlier key is emitted before the key check of the later one.

Note the graph is otherwise acyclic and every destination exists: removing the `INVALID_CONNECTION_TYPE`
rule is the *only* change that turns this fixture green, which is what makes it a falsifiable case
rather than decoration.

Consumed by `crates/n8n-validation/tests/validate_workflow.rs`.
