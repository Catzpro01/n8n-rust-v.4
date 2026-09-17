# LEGO Contract: Execution Engine

| Field | Value |
| :--- | :--- |
| Owner | Agent 1/3 — Execution Engine Domain Engineer |
| LEGO | `execution-engine` — DAG execution loop, node execution stack |
| Status | Phase 3 — `IMPLEMENTED`, 10/10 gates PASS, 2655 LOC reconstructed, tsc 0 errors |
| Reference | n8n `2.9.4` — `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` (2655 LOC) |
| Isolation record | `docs/isolation/reconstructed-engine.md` |
| Rust | **NOT STARTED** |

## 1. Purpose
Own the DAG execution loop: node execution stack, input data preparation with pairedItem re-indexing, output pairedItem auto-assignment, source tracking, error handling, execution order v0/v1, pin data handling, alwaysOutputData.

## 2. Data Schema
```typescript
type WorkflowExecuteMode = 'manual' | 'trigger' | 'webhook' | 'integrated' | 'cli' | 'error' | 'retry';

interface IWorkflowExecuteAdditionalData {
  credentialsHelper?: any;
  hooks?: { hookFunctions?: Record<string, Function[]> };
  executionId?: string;
  userId?: string;
}

class WorkflowExecute {
  constructor(additionalData: IWorkflowExecuteAdditionalData, mode: WorkflowExecuteMode, runExecutionData?: IRunExecutionData, workflow?: Workflow);
  run(workflow: Workflow, startNodeName?: string): Promise<IRunExecutionData>;
  runNode(nodeName: string, ...): Promise<ITaskData>;
}

class ReconstructedWorkflowEngine {
  constructor(workflow: Workflow, options?: { mode?: WorkflowExecuteMode, locale?: SupportedLocale });
  registerNodeType(typeName: string, handler: Function): void;
  runWorkflow(startNodeName?: string): Promise<{ status: string, resultData: IRunExecutionData, executionLog: any[] }>;
}
```

## 3. Responsibilities
1. **Stack**: node execution stack (LIFO), execution order v0/v1, depth tracking
2. **Input preparation**: `normalizeItems`, `returnJsonArray`, pairedItem re-indexing (I3), source tracking
3. **Execution**: run node handlers, handle continueOnFail, continueErrorOutput, alwaysOutputData (array form)
4. **Output assignment**: auto-assign pairedItem to outputs (I4), copyInputItems
5. **Pin data**: manual mode pin data handling, getPinDataOfNode
6. **Error & retry**: ExecutionError, retry, hooks, metadata
7. **Integration**: ReconstructedWorkflowEngine wraps WorkflowExecute for all LEGOs

## 4. Non-responsibilities
| Not owned | Owner |
| :--- | :--- |
| Workflow structure (nodes, connections) | workflow LEGO |
| Node parameter defaults | node LEGO |
| Connection routing pure functions | connection LEGO |
| Expression evaluation | expression LEGO |
| Execution data model (IRunData) | execution-data LEGO (passive model) |
| Persistence (DB) | persistence LEGO |
| Trigger/Webhook/Scheduler/Credentials/API | respective LEGOs |

## 5. Invariants
| Invariant | Enforced? | Evidence |
| :--- | :--- | :--- |
| Stack is LIFO, depth -1 = unlimited | YES | workflow-execute.ts |
| PairedItem re-indexing I3: input item index preserved through execution | YES | execution-data helpers |
| PairedItem auto-assignment I4: output items get pairedItem { item: inputIndex } | YES | workflow-execute.ts |
| alwaysOutputData: array form preserved | YES | I9 |
| Pin data only in manual mode | YES | getPinDataOfNode |
| Source tracking: each task has source array per input index | YES | ITaskData.source |

## 6. Dependencies (ports consumed)
- `P-WORKFLOW`: Workflow model
- `P-EXECUTION-DATA`: IRunExecutionData, normalizeItems, assignPairedItems, createRunExecutionData
- `P-EXPRESSION`: Expression evaluator
- `P-VALIDATION`: validateWorkflowStructure
- `P-SETTINGS`: NativeLocalizationService (locale)
- `P-NODE-MODEL`: getNodeParameters, getNodeOutputs (via Workflow)

## 7. Tests
- `packages/execution-engine-lego/` tsc 0 errors
- `test-run.mjs` PASS 3 nodes linear 0.36ms
- `test-enhanced.mjs` PASS 5 nodes IF branching true/false, execution log 5 entries, pairedItem tracking
- `verify:fast` 10/10 PASS

## 8. Provenance
Reference: n8n 2.9.4 `packages/core/src/execution-engine/workflow-execute.ts` 2655 LOC, reconstructed 1:1 in `packages/execution-engine-lego/src/workflow-execute.ts` + `runner.ts`, integrated in `reconstructed-engine/src/execution-engine/`.
