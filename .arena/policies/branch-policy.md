# Branch Management & Naming Policy

## 1. Core Principle
`main` is the ONLY permanent branch and single source of truth.
All other branches are strictly temporary task branches created for a specific work item.

## 2. Machine-Readable Naming Convention
Task branch names MUST follow this structure:
`<SPECIALIZATION>/<MILESTONE>-<TASK>`

Where:
- `<SPECIALIZATION>`: One of the 10 permanent domain categories:
  - `runtime-kernel`
  - `execution-engine`
  - `data-plane`
  - `node-system`
  - `expression-engine`
  - `workflow-compatibility`
  - `verification`
  - `performance`
  - `security-sandbox`
  - `infrastructure-orchestration`
- `<MILESTONE>`: Current milestone identifier in lowercase (e.g. `m0`, `m1`, `m2`).
- `<TASK>`: Hyphenated task slug (e.g. `runner`, `cancellation`, `item-buffer`).

Examples:
- `runtime-kernel/m1-runner`
- `execution-engine/m1-cancellation`
- `data-plane/m1-streaming`
- `verification/m1-runtime-golden-tests`

## 3. Strict Negative Rules
- NEVER create permanent agent branches (e.g. `agent-1`, `agent-2`, `agent-3`).
- NEVER create permanent specialization branches (e.g. `main-runtime`, `execution-engine`).
- NEVER commit or push directly to `main`.
- NEVER force-push to task branches unless explicitly authorized by orchestrator.

## 4. Deletion & Cleanup
Once a PR is merged into `main` and passes post-merge validation:
1. The remote task branch MUST be deleted.
2. The local Arena workspace clone MUST be deleted.
3. The branch MUST NOT be kept. Only `main` remains.