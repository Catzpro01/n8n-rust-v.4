# 02 - Dependency Map & Call Graph Boundaries

## 1. Package Dependency Hierarchy (Strict Layering)
```text
┌──────────────────────────────────────────────────────────┐
│                   n8n Application (CLI)                  │
└────────────┬───────────────────────────────┬─────────────┘
             │                               │
             ▼                               ▼
    ┌─────────────────┐             ┌──────────────────┐
    │ n8n-nodes-base  │             │     n8n-core     │
    └────────┬────────┘             └────────┬─────────┘
             │                               │
             └───────────────┬───────────────┘
                             ▼
                    ┌─────────────────┐
                    │  n8n-workflow   │  ◄── LEGO #1 TARGET
                    └─────────────────┘
```

## 2. Invariant Architectural Rules
- `n8n-workflow` **MUST NEVER** depend on `n8n-core`, database, or web framework. It is pure data structures and algorithms.
- Node execution logic in `n8n-core` must depend only on interfaces defined in `n8n-workflow`.
