# CONTRACT — Runtime Server (TypeScript Baseline)

| Field | Value |
| :--- | :--- |
| **LEGO** | `runtime-server` |
| **Owner** | MANAGER (TypeScript Baseline Initiative) |
| **Reference** | n8n 2.9.4 HTTP server patterns |
| **Status** | **DRAFT** - To be stabilized before Worker 1 dispatch |
| **Target** | Node.js `node:http` server for TypeScript baseline |

---

## 1. Purpose

Provide a **minimal, standalone HTTP server** that:
- Serves as the TypeScript baseline runtime
- Integrates with `packages/reconstructed-engine` for workflow execution
- Is easy to install, run, modify, upgrade, and debug
- Can run on a VPS
- Becomes the baseline before Rust migration

## 2. Scope

### Owns
- `apps/n8n-ts/**` - Runtime server implementation
- HTTP server using `node:http` (not Express)
- Endpoints:
  - `GET /` - Basic health/status page
  - `GET /healthz` - Health check endpoint
  - `POST /api/v1/workflows/run` - Execute a workflow
- Integration with `packages/reconstructed-engine`

### Does NOT Own
- Docker configuration (Worker 2 - Packaging)
- Systemd services (Worker 2 - Packaging)
- Installation scripts (Worker 2 - Packaging)
- Test suites (Worker 3 - Testing)
- LEGO package modifications (Worker 4 - LEGO Integration)
- Rust code (`crates/**`, `apps/n8n-rust`)
- Reference code (`reference/n8n/**`)

## 3. API Contract

### 3.1 Endpoints

#### `GET /`
**Purpose**: Basic landing page / server info

**Request**: None

**Response**:
```json
{
  "status": "running",
  "version": "0.4.0",
  "server": "n8n-ts-baseline",
  "timestamp": "2026-09-20T18:36:00.000Z"
}
```

**Status Codes**:
- `200 OK` - Server is running

---

#### `GET /healthz`
**Purpose**: Health check for load balancers and monitoring

**Request**: None

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-09-20T18:36:00.000Z",
  "uptime": 123.456,
  "checks": {
    "engine": "ok",
    "memory": "ok",
    "disk": "ok"
  }
}
```

**Status Codes**:
- `200 OK` - All checks pass
- `503 Service Unavailable` - One or more checks fail

**Response when unhealthy**:
```json
{
  "status": "error",
  "timestamp": "2026-09-20T18:36:00.000Z",
  "checks": {
    "engine": "error",
    "memory": "ok",
    "disk": "ok"
  },
  "errors": [
    "Engine initialization failed"
  ]
}
```

---

#### `POST /api/v1/workflows/run`
**Purpose**: Execute a workflow

**Request Headers**:
- `Content-Type: application/json` (required)
- `X-N8N-API-KEY: <api-key>` (optional, for authentication)

**Request Body**:
```typescript
{
  // Workflow definition
  workflow: {
    id: string;
    name: string;
    nodes: Array<{
      id: string;
      name: string;
      type: string;
      parameters: Record<string, unknown>;
      // ... other node properties
    }>;
    connections: Record<string, unknown>;
    active: boolean;
    // ... other workflow properties
  };
  
  // Execution options
  execution: {
    mode?: 'trigger' | 'manual' | 'test';
    inputData?: Record<string, unknown>;
    startNodeId?: string;
    // ... other execution options
  };
  
  // Optional: workflow data override
  workflowData?: {
    id?: string;
    name?: string;
    // ... other overrides
  };
}
```

**Response**:
```json
{
  "executionId": "exec-12345",
  "status": "running",
  "startedAt": "2026-09-20T18:36:00.000Z",
  "workflowId": "workflow-123",
  "mode": "manual"
}
```

**Status Codes**:
- `202 Accepted` - Execution started successfully
- `400 Bad Request` - Malformed request body
- `404 Not Found` - Unknown node type in workflow
- `422 Unprocessable Entity` - Invalid workflow structure
- `500 Internal Server Error` - Execution engine error

**Error Response**:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid workflow structure",
    "details": {
      "field": "nodes[0].type",
      "error": "Unknown node type: 'unknownNode'"
    }
  }
}
```

### 3.2 Integration with Reconstructed Engine

The runtime server MUST use `packages/reconstructed-engine` for:
- Execution runtime (`ActiveExecutions`)
- Workflow activation (`ActiveWorkflows`)
- Execution context (`ExecutionContextService`)
- Execution recovery (`ExecutionRecoveryService`)

**DO NOT** create a second execution engine. All workflow execution MUST go through the reconstructed engine.

### 3.3 Configuration

The server MUST support configuration via:
1. Environment variables (primary)
2. `.env` file (secondary)

**Required Environment Variables**:
```
# Server configuration
N8N_PORT=3000
N8N_HOST=0.0.0.0
NODE_ENV=production

# Optional: API key for authentication
N8N_API_KEY=your-api-key-here

# Optional: Execution limits
N8N_MAX_EXECUTIONS=100
N8N_EXECUTION_TIMEOUT=3600000
```

### 3.4 Error Handling

All errors MUST be:
1. Logged with appropriate severity
2. Returned with consistent error envelope
3. Include error codes for programmatic handling

**Error Envelope**:
```json
{
  "error": {
    "code": string,
    "message": string,
    "details"?: Record<string, unknown>,
    "timestamp": string
  }
}
```

### 3.5 Logging

The server MUST support:
- Console output (default)
- File logging (optional)
- Structured JSON logging (optional)

**Log Levels**:
- `DEBUG` - Detailed execution traces
- `INFO` - Server events, execution start/end
- `WARN` - Non-fatal issues
- `ERROR` - Fatal issues, execution failures

## 4. Invariants

| # | Invariant | Description |
| :--- | :--- | :--- |
| R1 | **Single Engine** | All workflow execution MUST use `packages/reconstructed-engine` |
| R2 | **No Express** | Server MUST use `node:http` directly, not Express |
| R3 | **Stateless** | Each request MUST be handled independently |
| R4 | **Async Execution** | Workflow execution MUST be non-blocking |
| R5 | **Error Consistency** | All errors MUST use the defined error envelope |
| R6 | **Health Checks** | `/healthz` MUST return within 500ms |
| R7 | **Configuration** | Server MUST fail fast on invalid configuration |

## 5. Dependencies

### Internal Dependencies
- `packages/reconstructed-engine` - Execution runtime (REQUIRED)
- `packages/workflow-lego` - Workflow model (OPTIONAL - for validation)
- `packages/execution-lego` - Execution model (OPTIONAL - for validation)

### External Dependencies
- `node:http` - HTTP server (built-in)
- `node:fs` - File system (built-in)
- `node:path` - Path utilities (built-in)
- `node:util` - Utilities (built-in)

**NO** Express, Fastify, or other HTTP frameworks.

## 6. File Structure

```
apps/n8n-ts/
├── src/
│   ├── server/
│   │   ├── index.ts              # Server entry point
│   │   ├── http-server.ts        # HTTP server implementation
│   │   ├── routes/
│   │   │   ├── index.ts          # Route registry
│   │   │   ├── health.ts         # Health check routes
│   │   │   ├── root.ts           # Root route
│   │   │   └── api/
│   │   │       └── v1/
│   │   │           └── workflows.ts # Workflow execution routes
│   │   ├── handlers/
│   │   │   ├── workflow-run.ts   # Workflow execution handler
│   │   │   └── error.ts          # Error handling
│   │   ├── config/
│   │   │   ├── index.ts          # Configuration loader
│   │   │   └── schema.ts         # Configuration schema
│   │   └── utils/
│   │       ├── logger.ts         # Logger implementation
│   │       └── response.ts        # Response utilities
│   ├── engine/
│   │   └── index.ts              # Engine integration layer
│   └── index.ts                  # Application entry point
├── package.json
├── tsconfig.json
└── README.md
```

## 7. Acceptance Criteria

### 7.1 Functional
- [ ] Server starts and listens on configured port
- [ ] `GET /` returns server info
- [ ] `GET /healthz` returns health status
- [ ] `POST /api/v1/workflows/run` executes workflows
- [ ] Workflow execution uses reconstructed engine
- [ ] Errors are handled consistently

### 7.2 Non-Functional
- [ ] Server starts in < 2 seconds
- [ ] Health check responds in < 100ms
- [ ] Memory usage < 100MB at idle
- [ ] No memory leaks after 1000 requests
- [ ] Graceful shutdown on SIGTERM

### 7.3 Operational
- [ ] Easy to install (npm install)
- [ ] Easy to run (npm start)
- [ ] Easy to configure (environment variables)
- [ ] Easy to debug (structured logging)
- [ ] Runs on VPS (tested on Ubuntu 22.04)

## 8. Gates

### Gate 1: Contract Stability
- [ ] Runtime contract approved
- [ ] API contract approved
- [ ] All stakeholders agree on contract

### Gate 2: Implementation
- [ ] Worker 1 completes implementation
- [ ] All acceptance criteria pass
- [ ] Code review complete

### Gate 3: Integration
- [ ] Worker 2 (Packaging) complete
- [ ] Worker 3 (Testing) complete
- [ ] Worker 4 (LEGO Integration) complete
- [ ] All PRs merged

### Gate 4: Deployment
- [ ] Build succeeds on laptop runner
- [ ] All tests pass on laptop runner
- [ ] Deploy to VPS runner `vps-runtime`
- [ ] Live smoke test passes
- [ ] `https://n8n.kentutmambu.my.id/` accessible

## 9. Worker Boundaries

### Worker 1: Runtime Server
**Scope**: `apps/n8n-ts/**`
**Must NOT touch**:
- `deploy/docker/**`
- `scripts/install.sh`, `start.sh`, `stop.sh`, `upgrade.sh`, `rollback.sh`, `doctor.sh`
- `.env.example`
- `packages/**` (except for integration)
- `crates/**`
- `reference/n8n/**`

**Deliverables**:
- Complete `apps/n8n-ts/` implementation
- All endpoints working
- Engine integration complete
- Unit tests for server (basic)

### Worker 2: Packaging
**Scope**: `deploy/docker/**`, `scripts/`, `.env.example`
**Must NOT touch**:
- `apps/n8n-ts/**`
- `packages/**`
- `tests/**`
- `crates/**`

**Deliverables**:
- Dockerfile for runtime server
- docker-compose.yml
- Installation script
- Start/stop/upgrade/rollback/doctor scripts
- Updated .env.example

### Worker 3: Testing
**Scope**: `tests/runtime/**`, `tests/integration/**`
**Must NOT touch**:
- `apps/n8n-ts/**` (except for test fixtures)
- `deploy/docker/**`
- `scripts/`
- `packages/**`

**Deliverables**:
- Health check tests
- Workflow execution tests
- Malformed request tests
- Empty workflow tests
- Unknown node tests
- Restart tests
- Configuration tests
- Regression tests

### Worker 4: LEGO Integration
**Scope**: Audit `packages/workflow-lego`, `packages/execution-lego`, `packages/reconstructed-engine`
**Must NOT touch**:
- `apps/n8n-ts/**` (except for integration layer)
- `deploy/docker/**`
- `scripts/`
- `tests/**`

**Deliverables**:
- Audit report of LEGO packages
- Integration layer in runtime server
- Validation that no second engine is created
- Documentation of integration points

## 10. Merge Strategy

1. **Contract First**: Stabilize this contract before any worker starts
2. **Parallel Development**: All workers work in parallel on their branches
3. **Sequential Merge**: Merge in order: Runtime → Packaging → Testing → LEGO Integration
4. **Integration Testing**: After each merge, run full integration tests
5. **Final Validation**: After all merges, validate on VPS before declaring BASELINE FROZEN

## 11. Branch Strategy

```
main (protected)
├── arena/01a0c019-n8n-rust-v-4 (current)
├── worker/1-runtime-server (Worker 1)
├── worker/2-packaging (Worker 2)
├── worker/3-testing (Worker 3)
└── worker/4-lego-integration (Worker 4)
```

Each worker creates PR from their branch to `arena/01a0c019-n8n-rust-v-4`.
MANAGER reviews, ensures no boundary violations, and merges.
After all PRs merged, MANAGER merges `arena/01a0c019-n8n-rust-v-4` to `main`.

---

**Contract Status**: DRAFT
**Next Action**: Review and stabilize contract before Worker 1 dispatch
**Manager**: Awaiting approval
