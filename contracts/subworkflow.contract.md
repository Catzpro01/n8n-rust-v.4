# LEGO Contract: Subworkflow Context & Parent-Child Propagation

| Field | Value |
| :--- | :--- |
| Owner | Agent 12 — Subworkflow Domain Engineer |
| LEGO | `subworkflow` — Sub-workflow execution context, parent-child data propagation |
| Status | Phase 4 — `IMPLEMENTED`, 10/10 gates PASS, tsc 0 errors |
| Reference | n8n `2.9.4` — `reference/n8n/packages/workflow/src/execution-context.ts`, `node-helpers.ts:getSubworkflowId`, `packages/core/src/execution-engine/workflow-execute.ts` (sub-workflow handling) |
| Isolation record | `docs/isolation/reconstructed-engine.md` |
| Rust | **NOT STARTED** |

## 1. Purpose
Own sub-workflow execution context: parent execution ID, parent workflow ID, caller node name, execution context establishment, propagation to child workflows, error workflow context, credential context encryption handling.

## 2. Data Schema
```typescript
interface SubworkflowContextData {
  parentExecutionId: string;
  parentWorkflowId: string;
  callerNodeName: string;
}

type WorkflowExecuteMode = 'cli' | 'error' | 'integrated' | 'internal' | 'manual' | 'retry' | 'trigger' | 'webhook' | 'evaluation' | 'chat';

interface IExecutionContextV1 {
  version: 1;
  establishedAt: number; // Unix ms
  source: WorkflowExecuteMode;
  triggerNode?: { name: string; type: string };
  parentExecutionId?: string;
  credentials?: string; // encrypted
}

interface ICredentialContextV1 {
  version: 1;
  identity: string;
  metadata?: Record<string, unknown>;
}

type IExecutionContext = { version: 1; establishedAt: number; source: WorkflowExecuteMode; triggerNode?: {...}; parentExecutionId?: string; credentials?: string };
type PlaintextExecutionContext = Omit<IExecutionContext, 'credentials'> & { credentials?: ICredentialContext };
```

## 3. Responsibilities
1. **Context creation**: `createSubworkflowContext(parentExecId, parentWfId, nodeName)` → `SubworkflowContextData`
2. **Execution context**: `createExecutionContext(mode, parentExecutionId?, triggerNode?)` → `IExecutionContext` with `establishedAt = Date.now()`
3. **Propagation**: `propagateToSubworkflow(parentContext, subworkflowId)` → child context with `parentExecutionId` set
4. **Subworkflow ID extraction**: `getSubworkflowId(node)` → workflowId from `node.parameters.workflowId` when resourceLocator
5. **Credential context**: encrypt/decrypt stub, safeParse
6. **Parent-child tracking**: parentExecutionId chain, callerNodeName for error tracing

## 4. Non-responsibilities
| Not owned | Owner |
| :--- | :--- |
| Workflow execution loop | execution-engine LEGO |
| Node model | node LEGO |
| Credentials resolution | credentials LEGO |
| Persistence | persistence LEGO |

## 5. Invariants
| Invariant | Enforced? | Evidence |
| :--- | :--- | :--- |
| `establishedAt` is Unix ms at creation | YES | Date.now() |
| `parentExecutionId` optional, set when child | YES | ExecutionContextSchema |
| `getSubworkflowId` returns value only when workflowId is resourceLocator | YES | node-helpers.ts |
| `credentials` encrypted in IExecutionContext, plaintext in PlaintextExecutionContext | YES | execution-context.ts |
| Subworkflow context has 3 required fields | YES | createSubworkflowContext |

## 6. Dependencies
- `P-WORKFLOW`: Workflow model
- `P-EXECUTION-DATA`: IRunExecutionData
- `P-CREDENTIALS`: credential context

## 7. Tests
- `packages/reconstructed-engine/test-enhanced.mjs` ALL 14+ LEGOs PASS
- `verify:fast` 10/10 PASS
- Subworkflow context propagation verified in engine runner

## 8. Provenance
Reference: n8n 2.9.4 `execution-context.ts`, `node-helpers.ts:getSubworkflowId`, reconstructed 1:1 in `packages/reconstructed-engine/src/subworkflow-context.ts`, integrated in execution-engine.
