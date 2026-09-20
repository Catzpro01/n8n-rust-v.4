# Worker 1: Runtime Server - Task Assignment

## Overview

**Worker ID**: Worker 1 - Runtime Server
**Branch**: `worker/1-runtime-server`
**Scope**: `apps/n8n-ts/**`
**Contract**: See `contracts/runtime-server.contract.md`

---

## Your Mission

Build a **minimal, standalone HTTP server** using `node:http` (NOT Express) that:
1. Serves as the TypeScript baseline runtime
2. Integrates with `packages/reconstructed-engine` for workflow execution
3. Is easy to install, run, modify, upgrade, and debug
4. Can run on a VPS

## Deliverables

### 1. Directory Structure
Create the following structure under `apps/n8n-ts/`:

```
apps/n8n-ts/
├── src/
│   ├── server/
│   │   ├── index.ts              # Server entry point
│   │   ├── http-server.ts        # HTTP server implementation (node:http)
│   │   ├── routes/
│   │   │   ├── index.ts          # Route registry
│   │   │   ├── health.ts         # Health check routes
│   │   │   ├── root.ts           # Root route
│   │   │   └── api/
│   │   │       └── v1/
│   │   │           └── workflows.ts # Workflow execution routes
│   │   ├── handlers/
│   │   │   ├── workflow-run.ts   # Workflow execution handler
│   │   │   └── error.ts          # Error handling middleware
│   │   ├── config/
│   │   │   ├── index.ts          # Configuration loader
│   │   │   └── schema.ts         # Configuration schema (zod or similar)
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

### 2. Implementation Requirements

#### 2.1 HTTP Server (`src/server/http-server.ts`)
- Use `node:http` module (NOT Express, Fastify, or any framework)
- Create HTTP server that listens on configurable port (default: 3000)
- Handle SIGTERM for graceful shutdown
- Support CORS for development
- Parse JSON request bodies
- Handle errors consistently

#### 2.2 Routes

##### `GET /` (`src/server/routes/root.ts`)
- Return server info:
```json
{
  "status": "running",
  "version": "0.4.0",
  "server": "n8n-ts-baseline",
  "timestamp": "2026-09-20T18:36:00.000Z"
}
```

##### `GET /healthz` (`src/server/routes/health.ts`)
- Return health status:
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
- Check engine health (from reconstructed-engine)
- Check memory usage
- Check disk space
- Return 503 if any check fails

##### `POST /api/v1/workflows/run` (`src/server/routes/api/v1/workflows.ts`)
- Accept workflow execution request
- Validate request body
- Execute workflow using reconstructed-engine
- Return execution info:
```json
{
  "executionId": "exec-12345",
  "status": "running",
  "startedAt": "2026-09-20T18:36:00.000Z",
  "workflowId": "workflow-123",
  "mode": "manual"
}
```

#### 2.3 Engine Integration (`src/engine/index.ts`)
- Import and use `packages/reconstructed-engine`
- Create execution runtime with proper ports
- Handle workflow execution
- Manage active executions
- Handle errors from engine

**IMPORTANT**: DO NOT create a second execution engine. ALL workflow execution MUST go through `packages/reconstructed-engine`.

#### 2.4 Configuration (`src/server/config/`)
- Load configuration from environment variables
- Support `.env` file (optional)
- Validate configuration using schema
- Provide defaults

**Required Environment Variables**:
```
N8N_PORT=3000
N8N_HOST=0.0.0.0
NODE_ENV=production
N8N_API_KEY= (optional)
N8N_MAX_EXECUTIONS=100 (optional)
N8N_EXECUTION_TIMEOUT=3600000 (optional)
```

#### 2.5 Logger (`src/server/utils/logger.ts`)
- Support multiple log levels: DEBUG, INFO, WARN, ERROR
- Output to console (default)
- Support structured JSON logging (optional)
- Include timestamps in all logs

#### 2.6 Error Handling (`src/server/handlers/error.ts`)
- Consistent error envelope:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message",
    "details": { ... },
    "timestamp": "2026-09-20T18:36:00.000Z"
  }
}
```
- Handle different error types appropriately
- Log all errors

### 3. Package Configuration

#### `apps/n8n-ts/package.json`
```json
{
  "name": "@n8n/ts-runtime",
  "version": "0.4.0",
  "private": true,
  "description": "TypeScript baseline runtime server for n8n",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "dependencies": {
    "@lego/execution": "workspace:*",
    "@lego/reconstructed-engine": "workspace:*",
    "@lego/workflow": "workspace:*",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.0",
    "typescript": "~5.9.2"
  }
}
```

#### `apps/n8n-ts/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 4. Entry Point (`src/index.ts`)
```typescript
import { createServer } from './server/http-server';
import { loadConfig } from './server/config';
import { createLogger } from './server/utils/logger';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  
  const server = createServer({ config, logger });
  
  server.listen(config.port, config.host, () => {
    logger.info(`Server started on http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
```

### 5. Acceptance Criteria

#### Functional
- [ ] Server starts and listens on configured port
- [ ] `GET /` returns server info
- [ ] `GET /healthz` returns health status
- [ ] `POST /api/v1/workflows/run` executes workflows
- [ ] Workflow execution uses reconstructed-engine
- [ ] Errors are handled consistently
- [ ] Graceful shutdown on SIGTERM

#### Non-Functional
- [ ] Server starts in < 2 seconds
- [ ] Health check responds in < 100ms
- [ ] Memory usage < 100MB at idle
- [ ] No memory leaks after 1000 requests

#### Operational
- [ ] Easy to install (`npm install`)
- [ ] Easy to run (`npm start`)
- [ ] Easy to configure (environment variables)
- [ ] Easy to debug (structured logging)

### 6. Testing

Add basic tests in `apps/n8n-ts/src/**/*.test.ts`:
- Server starts and stops
- Routes respond correctly
- Error handling works
- Configuration loading works

### 7. Documentation

Create `apps/n8n-ts/README.md` with:
- Overview
- Installation
- Configuration
- Running
- Development
- API Documentation

---

## Boundaries - DO NOT CROSS

### ❌ YOU MUST NOT TOUCH:
- `deploy/docker/**` - Worker 2 territory
- `scripts/install.sh`, `start.sh`, `stop.sh`, `upgrade.sh`, `rollback.sh`, `doctor.sh` - Worker 2 territory
- `.env.example` - Worker 2 territory
- `packages/**` - Except for reading/importing (Worker 4 territory for modifications)
- `crates/**` - Rust is FROZEN
- `reference/n8n/**` - Reference is FROZEN
- Other workers' branches

### ✅ YOU CAN TOUCH:
- `apps/n8n-ts/**` - Your territory
- `contracts/runtime-server.contract.md` - For clarification (but coordinate with MANAGER)

---

## Workflow

1. **Read Contract**: Study `contracts/runtime-server.contract.md`
2. **Implement**: Build the runtime server
3. **Test**: Run your implementation locally
4. **Commit**: Commit changes to `worker/1-runtime-server` branch
5. **PR**: Create PR to `arena/01a0c019-n8n-rust-v-4`
6. **Notify**: Inform MANAGER that PR is ready for review

---

## Questions?

If you have questions:
1. Check the contract document first
2. Ask in your PR comments
3. Escalate to MANAGER if blocked

---

## Success Criteria

Your PR will be accepted when:
- [ ] All deliverables complete
- [ ] All acceptance criteria met
- [ ] No boundary violations
- [ ] Code is clean and well-documented
- [ ] Tests pass

---

**Worker 1 Status**: READY TO START
**Contract**: `contracts/runtime-server.contract.md`
**Branch**: `worker/1-runtime-server`
