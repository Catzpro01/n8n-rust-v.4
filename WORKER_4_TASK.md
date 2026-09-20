# Worker 4: LEGO Integration - Task Assignment

## Overview

**Worker ID**: Worker 4 - LEGO Integration
**Branch**: `worker/4-lego-integration`
**Scope**: Audit and integrate `packages/workflow-lego`, `packages/execution-lego`, `packages/reconstructed-engine`
**Contract**: See `contracts/runtime-server.contract.md` and `contracts/execution.contract.md`

---

## Your Mission

**CRITICAL**: Ensure the runtime server uses existing LEGO components and **DOES NOT** create a second execution engine.

Your tasks:
1. Audit `packages/reconstructed-engine`
2. Audit `packages/workflow-lego`
3. Audit `packages/execution-lego`
4. Verify runtime server integration
5. Document integration points
6. Confirm no second engine is created

## Deliverables

### 1. Audit Reports

#### `docs/audit/reconstructed-engine-audit.md`
```markdown
# Audit Report: reconstructed-engine

## Summary
- **Package**: @lego/reconstructed-engine
- **Version**: 0.1.0
- **Status**: IMPLEMENTED
- **Reference**: n8n 2.9.4

## Components

### Exported Classes
- `ActiveExecutions` - X1-X8 invariants
- `ActiveWorkflows` - X9-X12 invariants
- `ExecutionContextService` - X14-X15 invariants
- `ExecutionRecoveryService` - X16-X17 invariants
- `MemoryExecutionRepository` - Test implementation
- `MemoryWorkflowRepository` - Test implementation
- `MemoryConcurrencyControl` - Test implementation

### Ports
- `ExecutionRepositoryPort` - Database abstraction
- `ExecutionPersistencePort` - Persistence abstraction
- `WorkflowRepositoryPort` - Workflow storage abstraction
- `ConcurrencyControlPort` - Concurrency control abstraction

## Invariants Verification

| Invariant | Status | Notes |
|-----------|--------|-------|
| X1 | ✅ PASS | add() without id persists new execution |
| X2 | ✅ PASS | add(id) resumes waiting execution |
| ... | ... | ... |
| X17 | ✅ PASS | recoverFromLogs handles all cases |

## Memory Implementations
- `MemoryExecutionRepository` - In-memory execution storage
- `MemoryExecutionPersistence` - In-memory persistence
- `MemoryWorkflowRepository` - In-memory workflow storage
- `MemoryConcurrencyControl` - In-memory concurrency control

## Integration Points
- `createExecutionRuntime()` - Factory function to create runtime
- Accepts optional ports for custom implementations
- Returns all services wired together

## Recommendations
- [ ] Runtime server should use `createExecutionRuntime()`
- [ ] Runtime server should inject real repositories in production
- [ ] Runtime server should use memory implementations for testing
```

#### `docs/audit/workflow-lego-audit.md`
```markdown
# Audit Report: workflow-lego

## Summary
- **Package**: @lego/workflow
- **Version**: 0.1.0
- **Status**: Phase 2 structural isolation

## Boundary
- Owns: Workflow model, graph structure, node definitions
- Does NOT own: Execution, persistence, API

## Ports
- Workflow model surface
- Graph validation
- Node catalog

## Integration Points
- Workflow validation
- Node type checking
- Graph traversal

## Recommendations
- [ ] Runtime server should use workflow-lego for validation
- [ ] Runtime server should import node catalog from workflow-lego
```

#### `docs/audit/execution-lego-audit.md`
```markdown
# Audit Report: execution-lego

## Summary
- **Package**: @lego/execution
- **Version**: 0.1.0
- **Status**: Phase 2 structural isolation

## Boundary
- Owns: Execution model, execution data, run data
- Does NOT own: Runtime execution, persistence

## Ports
- Execution data structures
- Run data structures
- Error types

## Integration Points
- Execution data validation
- Run data processing
- Error handling

## Recommendations
- [ ] Runtime server should use execution-lego types
- [ ] Runtime server should validate execution data with execution-lego
```

### 2. Integration Documentation

#### `docs/integration/lego-integration-guide.md`
```markdown
# LEGO Integration Guide

## Overview

The TypeScript baseline runtime server integrates with three LEGO packages:
1. `@lego/reconstructed-engine` - Execution runtime
2. `@lego/workflow` - Workflow model
3. `@lego/execution` - Execution model

## Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Runtime Server                           │
│                                                             │
│  ┌─────────────┐    ┌─────────────────────────────────┐ │
│  │ HTTP Server  │───▶│  Route Handlers                  │ │
│  └─────────────┘    └─────────────┬───────────────────┘ │
│                                    │                       │
│                                    ▼                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                 Engine Integration Layer              │ │
│  │  (apps/n8n-ts/src/engine/index.ts)                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                    │                       │
│                                    ▼                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              reconstructed-engine                      │ │
│  │  (packages/reconstructed-engine/src/execution-engine.ts)│ │
│  └─────────────────────────────────────────────────────┘ │
│                                    │                       │
│         ┌──────────────────────────┬──────────────────┐ │
│         ▼                          ▼                      ▼    │
│  ┌─────────────┐          ┌─────────────┐          ┌─────┐ │
│  │ workflow-   │          │ execution-  │          │ ... │ │
│  │ lego       │          │ lego        │          │     │ │
│  └─────────────┘          └─────────────┘          └─────┘ │
└─────────────────────────────────────────────────────────┘
```

## Integration Layer

The integration layer (`apps/n8n-ts/src/engine/index.ts`) is the ONLY place where:
- reconstructed-engine is imported
- Execution runtime is created
- Ports are injected
- Workflow execution is triggered

### Usage

```typescript
import { createExecutionRuntime, ExecutionRuntimeOptions } from '@lego/reconstructed-engine';

function createEngine() {
  const options: ExecutionRuntimeOptions = {
    logger: createLogger(),
    executionRepository: createDatabaseRepository(),
    workflowRepository: createWorkflowRepository(),
    // ... other options
  };
  
  return createExecutionRuntime(options);
}

export const engine = createEngine();
```

## No Second Engine Rule

**CRITICAL**: The runtime server MUST NOT create a second execution engine.

### What to Use
✅ **DO USE**:
- `packages/reconstructed-engine` for ALL workflow execution
- `ActiveExecutions.add()` for starting executions
- `ActiveExecutions.stopExecution()` for canceling executions
- `ActiveWorkflows.add()` for activating workflows
- `ExecutionRecoveryService` for recovery

### What NOT to Use
❌ **DO NOT USE**:
- Custom workflow execution logic
- Direct node execution
- Custom execution tracking
- Any execution code outside reconstructed-engine

## Validation Checklist

- [ ] All workflow execution goes through `ActiveExecutions.add()`
- [ ] All workflow activation goes through `ActiveWorkflows.add()`
- [ ] All execution state is managed by reconstructed-engine
- [ ] No custom execution loops exist
- [ ] No duplicate execution tracking exists

## Testing Integration

### Unit Tests
- Test engine integration layer
- Test port injection
- Test error handling from engine

### Integration Tests
- Test workflow execution end-to-end
- Test multiple concurrent executions
- Test error scenarios

### Regression Tests
- Ensure integration doesn't break existing functionality
- Ensure upgrades don't break integration
```

### 3. Integration Verification Script

#### `tools/verify-lego-integration.mjs`
```javascript
#!/usr/bin/env node

/**
 * Verify that the runtime server correctly integrates with LEGO packages
 * and does NOT create a second execution engine.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const APPS_DIR = path.join(ROOT_DIR, 'apps', 'n8n-ts');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');

let passed = 0;
let failed = 0;

function check(description, condition, details = '') {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${description}`);
    if (details) console.log(`   Details: ${details}`);
    failed++;
  }
}

// Check 1: reconstructed-engine is imported
const engineFiles = [
  path.join(APPS_DIR, 'src', 'engine', 'index.ts'),
  path.join(APPS_DIR, 'src', 'server', 'handlers', 'workflow-run.ts'),
];

let engineImported = false;
for (const file of engineFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes('@lego/reconstructed-engine') || 
        content.includes('reconstructed-engine')) {
      engineImported = true;
      break;
    }
  }
}

check(
  'reconstructed-engine is imported in runtime server',
  engineImported,
  'Expected import in engine integration layer'
);

// Check 2: createExecutionRuntime is used
if (engineImported) {
  const engineIndex = path.join(APPS_DIR, 'src', 'engine', 'index.ts');
  if (fs.existsSync(engineIndex)) {
    const content = fs.readFileSync(engineIndex, 'utf-8');
    check(
      'createExecutionRuntime is used',
      content.includes('createExecutionRuntime'),
      'Expected createExecutionRuntime call in engine/index.ts'
    );
  }
}

// Check 3: No custom execution loops
const srcFiles = [];
function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.ts') && !fullPath.includes('node_modules')) {
      srcFiles.push(fullPath);
    }
  }
}

if (fs.existsSync(APPS_DIR)) {
  walkDir(path.join(APPS_DIR, 'src'));
}

let hasCustomExecution = false;
const forbiddenPatterns = [
  'while.*execution',
  'for.*execution',
  'setInterval.*execution',
  'executeWorkflow.*{',
  'runWorkflow.*{',
];

for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const pattern of forbiddenPatterns) {
    if (new RegExp(pattern, 'i').test(content)) {
      hasCustomExecution = true;
      console.log(`   Found in: ${path.relative(ROOT_DIR, file)}`);
    }
  }
}

check(
  'No custom execution loops found',
  !hasCustomExecution,
  'Custom execution loops violate "no second engine" rule'
);

// Check 4: ActiveExecutions is used
let usesActiveExecutions = false;
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('ActiveExecutions')) {
    usesActiveExecutions = true;
    break;
  }
}

check(
  'ActiveExecutions is used for execution management',
  usesActiveExecutions,
  'Expected ActiveExecutions usage for execution tracking'
);

// Check 5: workflow-lego types are used
let usesWorkflowLego = false;
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('@lego/workflow') || content.includes('workflow-lego')) {
    usesWorkflowLego = true;
    break;
  }
}

check(
  'workflow-lego types are used',
  usesWorkflowLego,
  'Expected workflow-lego for workflow validation'
);

// Check 6: execution-lego types are used
let usesExecutionLego = false;
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('@lego/execution') || content.includes('execution-lego')) {
    usesExecutionLego = true;
    break;
  }
}

check(
  'execution-lego types are used',
  usesExecutionLego,
  'Expected execution-lego for execution data'
);

// Check 7: No direct node execution
let hasDirectNodeExecution = false;
for (const file of srcFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('executeNode(') || 
      content.includes('runNode(') ||
      content.includes('node.execute(')) {
    hasDirectNodeExecution = true;
    console.log(`   Found in: ${path.relative(ROOT_DIR, file)}`);
  }
}

check(
  'No direct node execution found',
  !hasDirectNodeExecution,
  'Direct node execution should go through reconstructed-engine'
);

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n❌ LEGO Integration verification FAILED');
  process.exit(1);
} else {
  console.log('\n✅ LEGO Integration verification PASSED');
  process.exit(0);
}
```

### 4. Integration Layer Implementation

#### `apps/n8n-ts/src/engine/index.ts` (Example)
```typescript
/**
 * Engine Integration Layer
 * 
 * This is the ONLY place where reconstructed-engine is imported and used.
 * All workflow execution MUST go through this layer.
 */

import {
  createExecutionRuntime,
  ExecutionRuntimeOptions,
  ActiveExecutions,
  ActiveWorkflows,
  ExecutionContextService,
  ExecutionRecoveryService,
  MemoryExecutionRepository,
  MemoryWorkflowRepository,
  MemoryConcurrencyControl,
  Emitter,
  Logger,
  noopLogger,
} from '@lego/reconstructed-engine';

import type {
  IWorkflowExecutionDataProcess,
  ExecutionStatus,
} from '@lego/reconstructed-engine';

import { loadConfig } from '../server/config';
import { createLogger } from '../server/utils/logger';

// Type definitions for our runtime
export interface EngineConfig {
  maxExecutions?: number;
  executionTimeout?: number;
  recoveryEnabled?: boolean;
}

export interface ExecutionRequest {
  workflow: Record<string, unknown>;
  execution?: {
    mode?: string;
    inputData?: Record<string, unknown>;
    startNodeId?: string;
  };
  workflowData?: {
    id?: string;
    name?: string;
  };
}

export interface ExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  startedAt: Date;
  workflowId?: string;
  mode?: string;
}

// Runtime instance
let runtime: ReturnType<typeof createExecutionRuntime> | null = null;

/**
 * Initialize the execution runtime
 */
export function initializeEngine(config: EngineConfig = {}): void {
  if (runtime) {
    throw new Error('Engine already initialized');
  }

  const appConfig = loadConfig();
  const logger = createLogger(appConfig);

  const options: ExecutionRuntimeOptions = {
    logger,
    executionRepository: createExecutionRepository(logger),
    workflowRepository: createWorkflowRepository(logger),
    concurrencyControl: createConcurrencyControl(),
    eventService: new Emitter(),
    executionsConfig: {
      mode: 'regular',
      recovery: {
        maxLastExecutions: config.maxExecutions ?? 3,
        workflowDeactivationEnabled: config.recoveryEnabled ?? false,
      },
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  runtime = createExecutionRuntime(options);
}

/**
 * Get the active executions service
 */
export function getActiveExecutions(): ActiveExecutions {
  if (!runtime) {
    throw new Error('Engine not initialized');
  }
  return runtime.activeExecutions;
}

/**
 * Get the active workflows service
 */
export function getActiveWorkflows(): ActiveWorkflows {
  if (!runtime) {
    throw new Error('Engine not initialized');
  }
  return runtime.activeWorkflows;
}

/**
 * Execute a workflow
 */
export async function executeWorkflow(
  request: ExecutionRequest
): Promise<ExecutionResult> {
  if (!runtime) {
    throw new Error('Engine not initialized');
  }

  const { activeExecutions } = runtime;

  const executionData: IWorkflowExecutionDataProcess = {
    executionMode: request.execution?.mode ?? 'manual',
    workflowData: {
      id: request.workflowData?.id ?? request.workflow.id,
      name: request.workflowData?.name ?? request.workflow.name,
      nodes: request.workflow.nodes,
    },
    executionData: request.execution?.inputData,
    retryOf: undefined,
  };

  const executionId = await activeExecutions.add(executionData);

  return {
    executionId,
    status: activeExecutions.getStatus(executionId),
    startedAt: new Date(),
    workflowId: request.workflowData?.id ?? request.workflow.id,
    mode: request.execution?.mode ?? 'manual',
  };
}

/**
 * Stop an execution
 */
export function stopExecution(executionId: string, reason: 'manual' | 'timeout' | 'shutdown' = 'manual'): void {
  if (!runtime) {
    throw new Error('Engine not initialized');
  }

  const { activeExecutions } = runtime;
  const cancellationError = new (require('@lego/reconstructed-engine').ExecutionCancelledError)(executionId, reason);
  activeExecutions.stopExecution(executionId, cancellationError);
}

/**
 * Get active executions
 */
export function getActiveExecutionsList() {
  if (!runtime) {
    throw new Error('Engine not initialized');
  }

  const { activeExecutions } = runtime;
  return activeExecutions.getActiveExecutions();
}

/**
 * Get execution status
 */
export function getExecutionStatus(executionId: string): ExecutionStatus {
  if (!runtime) {
    throw new Error('Engine not initialized');
  }

  const { activeExecutions } = runtime;
  return activeExecutions.getStatus(executionId);
}

/**
 * Shutdown the engine
 */
export async function shutdownEngine(cancelAll = false): Promise<void> {
  if (!runtime) {
    return;
  }

  const { activeExecutions } = runtime;
  await activeExecutions.shutdown(cancelAll);
  runtime = null;
}

// Helper functions for creating repositories
function createExecutionRepository(logger: Logger) {
  // In production, use database repository
  // For now, use memory repository
  return new MemoryExecutionRepository();
}

function createWorkflowRepository(logger: Logger) {
  // In production, use database repository
  // For now, use memory repository
  return new MemoryWorkflowRepository();
}

function createConcurrencyControl() {
  return new MemoryConcurrencyControl();
}
```

---

## Boundaries - DO NOT CROSS

### ❌ YOU MUST NOT TOUCH:
- `apps/n8n-ts/src/**` - Worker 1 territory (except for integration layer)
- `deploy/docker/**` - Worker 2 territory
- `scripts/` - Worker 2 territory
- `tests/**` - Worker 3 territory
- `crates/**` - Rust is FROZEN
- `reference/n8n/**` - Reference is FROZEN
- Other workers' branches

### ✅ YOU CAN TOUCH:
- `docs/audit/**` - Your territory
- `docs/integration/**` - Your territory
- `tools/verify-lego-integration.mjs` - Your territory
- `apps/n8n-ts/src/engine/index.ts` - Integration layer (coordinate with Worker 1)

---

## Acceptance Criteria

### Audit
- [ ] reconstructed-engine audit complete
- [ ] workflow-lego audit complete
- [ ] execution-lego audit complete
- [ ] All invariants verified
- [ ] All ports documented

### Integration
- [ ] Integration guide complete
- [ ] Integration layer implemented
- [ ] No second engine created
- [ ] All execution goes through reconstructed-engine

### Verification
- [ ] Verification script runs successfully
- [ ] All checks pass
- [ ] No violations detected

---

## Workflow

1. **Read Contracts**: Study `contracts/runtime-server.contract.md` and `contracts/execution.contract.md`
2. **Audit**: Audit all three LEGO packages
3. **Document**: Create audit reports and integration guide
4. **Implement**: Create verification script and integration layer
5. **Verify**: Run verification script against runtime server
6. **Commit**: Commit changes to `worker/4-lego-integration` branch
7. **PR**: Create PR to `arena/01a0c019-n8n-rust-v-4`
8. **Notify**: Inform MANAGER that PR is ready for review

---

## Testing Your Work

### Local Testing
1. Read the LEGO packages source code
2. Verify invariants are implemented
3. Run verification script: `node tools/verify-lego-integration.mjs`
4. Verify all checks pass

### Integration Testing
1. Ensure runtime server uses integration layer
2. Verify no custom execution code exists
3. Confirm all execution goes through reconstructed-engine

---

## Success Criteria

Your PR will be accepted when:
- [ ] All deliverables complete
- [ ] All acceptance criteria met
- [ ] No boundary violations
- [ ] No second engine created
- [ ] Integration verified

---

**Worker 4 Status**: READY TO START
**Contract**: `contracts/runtime-server.contract.md` and `contracts/execution.contract.md`
**Branch**: `worker/4-lego-integration`
