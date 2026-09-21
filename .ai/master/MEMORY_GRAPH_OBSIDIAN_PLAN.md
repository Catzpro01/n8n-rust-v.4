# Memory graph and Obsidian projection

**Status:** planning (**XA-21**: no `ai.memory` capability is published — this document specifies a
target, not a runtime). **Canonical owners:** manager for the memory contract; agent-01 for how the
frontend would consume it. No vault, database or Obsidian instance is created by this repository.

---

## 1. One memory, many projections

```
                        Memory Graph  (source)
                              |
   +----------+-----------+---+--------+-----------+--------------+
 AI context  Copilot   Work Trace   Obsidian   agent sessions   project knowledge
```

Obsidian is a **human-facing knowledge interface / provider adapter**, never the hidden second source
of truth. The graph is the internal semantic model; a projection is a view produced from it. Nobody may
read the vault *instead of* the graph, and nobody may dump the vault into a context window.

## 2. What the graph connects

Nodes the project already speaks about: **project, workflow, node, execution, agent, session,
decision, evidence, artifact, task, commit, PR, documentation**. Edges (declared vocabulary, not free
text): `depends_on`, `caused`, `derived_from`, `supports`, `contradicts`, `implements`, `belongs_to`,
`delegated_to`, `decided_by`, `observed_in`, `related_to`.

Every node must be addressable by a reference that already exists somewhere: a decision id, an
artifact id, a session id, a task id, a commit hash, a document path. **No node is invented to make a
graph look full.**

## 3. Retrieval, not dumping

- Retrieval is **relevance-based**, scoped, and paged; a graph view is a level-3 disclosure surface.
- `Memory 12 relevant` is a count of *relevant, in-scope* items — not of the store.
- The Obsidian projection is generated (markdown), readable by a human, and lossy by design: it
  carries summaries and links, never payloads, never secrets, never reasoning.
- Never: embedding or vector internals in a UI, a vault dump in a prompt, a graph traversal that
  silently becomes a full-store read.

## 4. What a memory item may contain

Kind (project / decision / task / artifact / reference) · a human-readable summary · the reference it
points at · provenance (who recorded it, when) · the relationships above. **Not** reasoning traces,
raw prompts, credentials, unbounded tool output, or a transcript.

## 5. Why this matters to the product

Memory is what makes a long project coherent: a Copilot that can retrieve *why* a decision was made
(`decided_by`), *what* it produced (`derived_from`), and *what depends on it* (`depends_on`) — without
loading the whole history. That is also the difference between memory and context
(`CONTEXT_SESSION_MEMORY_PLAN.md §1`): context is what the window holds now; memory survives the
window.

## 6. Publication path

1. Manager publishes a memory contract (entry kinds, relevance source, retention, edges) — XA-21.
2. The frontend declares a memory view over that contract (count, list, graph, retrieval action).
3. The Obsidian adapter is authored as a provider implementation of the memory interface — an
   adapter, never a contract.
4. Until (1) exists, the frontend shows loaded context + decisions + artifacts, labelled honestly,
   and no surface claims a store.
