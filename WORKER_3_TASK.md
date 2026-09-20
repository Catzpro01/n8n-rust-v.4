# Worker 3: Testing - Task Assignment

## Overview

**Worker ID**: Worker 3 - Testing
**Branch**: `worker/3-testing`
**Scope**: `tests/runtime/**`, `tests/integration/**`
**Contract**: See `contracts/runtime-server.contract.md`

---

## Your Mission

Create **comprehensive tests** that validate the TypeScript baseline:
1. Runtime server functionality
2. Workflow execution
3. Error handling
4. Configuration
5. Restart behavior
6. Regression prevention

**IMPORTANT**: Tests must validate the **real runtime**, not just mocks.

## Deliverables

### 1. Directory Structure

```
tests/
├── runtime/
│   ├── health.test.ts          # Health check tests
│   ├── root.test.ts            # Root endpoint tests
│   ├── workflow-execution.test.ts # Workflow execution tests
│   ├── errors.test.ts          # Error handling tests
│   └── config.test.ts          # Configuration tests
├── integration/
│   ├── restart.test.ts         # Restart behavior tests
│   ├── regression.test.ts      # Regression tests
│   └── fixtures/
│       ├── workflows/          # Workflow fixtures
│       │   ├── simple.json      # Simple workflow
│       │   ├── multi-node.json  # Multi-node workflow
│       │   ├── empty.json       # Empty workflow
│       │   └── invalid.json     # Invalid workflow
│       └── data/               # Test data
│           ├── input.json
│           └── expected.json
├── fixtures/
│   └── workflows/              # Shared workflow fixtures
│       ├── basic-flow.json
│       ├── error-flow.json
│       └── complex-flow.json
└── README.md
```

### 2. Test Implementation

#### 2.1 Test Framework
Use Jest or similar. Configure in `tests/package.json` or use workspace root.

#### 2.2 Health Tests (`tests/runtime/health.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from './utils/http';

describe('Health Endpoint', () => {
  let server: any;

  beforeAll(async () => {
    server = await startServer({ port: 0 }); // Random port
  });

  afterAll(async () => {
    await stopServer(server);
  });

  describe('GET /healthz', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(server).get('/healthz');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.checks).toBeDefined();
    });

    it('should return all checks as ok', async () => {
      const response = await request(server).get('/healthz');
      
      expect(response.body.checks.engine).toBe('ok');
      expect(response.body.checks.memory).toBe('ok');
      expect(response.body.checks.disk).toBe('ok');
    });

    it('should respond within 100ms', async () => {
      const start = Date.now();
      const response = await request(server).get('/healthz');
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100);
    });

    it('should return 503 when engine is unhealthy', async () => {
      // TODO: Mock engine to be unhealthy
      // This test validates that health check detects engine issues
    });
  });
});
```

#### 2.3 Root Endpoint Tests (`tests/runtime/root.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from './utils/http';

describe('Root Endpoint', () => {
  let server: any;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  describe('GET /', () => {
    it('should return 200', async () => {
      const response = await request(server).get('/');
      
      expect(response.status).toBe(200);
    });

    it('should return server info', async () => {
      const response = await request(server).get('/');
      
      expect(response.body.status).toBe('running');
      expect(response.body.version).toBeDefined();
      expect(response.body.server).toBe('n8n-ts-baseline');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return JSON', async () => {
      const response = await request(server).get('/');
      
      expect(response.headers['content-type']).toContain('application/json');
    });
  });
});
```

#### 2.4 Workflow Execution Tests (`tests/runtime/workflow-execution.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from './utils/http';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '../fixtures/workflows');

describe('Workflow Execution', () => {
  let server: any;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  describe('POST /api/v1/workflows/run', () => {
    it('should execute a simple workflow', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'simple.json'),
        'utf-8'
      ));
      
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      expect(response.status).toBe(202);
      expect(response.body.executionId).toBeDefined();
      expect(response.body.status).toBe('running');
      expect(response.body.startedAt).toBeDefined();
    });

    it('should execute a multi-node workflow', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'multi-node.json'),
        'utf-8'
      ));
      
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      expect(response.status).toBe(202);
      expect(response.body.executionId).toBeDefined();
    });

    it('should handle workflow with input data', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'simple.json'),
        'utf-8'
      ));
      
      const inputData = { test: 'value' };
      
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow, execution: { inputData } });
      
      expect(response.status).toBe(202);
    });

    it('should generate unique execution IDs', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'simple.json'),
        'utf-8'
      ));
      
      const response1 = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      const response2 = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      expect(response1.body.executionId).not.toBe(response2.body.executionId);
    });
  });
});
```

#### 2.5 Error Handling Tests (`tests/runtime/errors.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from './utils/http';

describe('Error Handling', () => {
  let server: any;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  describe('Malformed Requests', () => {
    it('should return 400 for invalid JSON', async () => {
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send('invalid json')
        .set('Content-Type', 'application/json');
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('INVALID_JSON');
    });

    it('should return 400 for missing Content-Type', async () => {
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow: {} });
      
      expect(response.status).toBe(400);
    });

    it('should return 422 for missing workflow', async () => {
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({});
      
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Empty Workflow', () => {
    it('should return 422 for empty workflow', async () => {
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow: {} });
      
      expect(response.status).toBe(422);
    });

    it('should return 422 for workflow without nodes', async () => {
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow: { id: 'test', name: 'Test' } });
      
      expect(response.status).toBe(422);
    });
  });

  describe('Unknown Node', () => {
    it('should return 404 for unknown node type', async () => {
      const workflow = {
        id: 'test',
        name: 'Test',
        nodes: [
          {
            id: 'node1',
            name: 'Unknown Node',
            type: 'unknownNodeType',
            parameters: {}
          }
        ]
      };
      
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('UNKNOWN_NODE');
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error envelope', async () => {
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({});
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('timestamp');
    });
  });
});
```

#### 2.6 Configuration Tests (`tests/runtime/config.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from './utils/http';

describe('Configuration', () => {
  let server: any;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  describe('Port Configuration', () => {
    it('should respect N8N_PORT environment variable', async () => {
      process.env.N8N_PORT = '3456';
      
      server = await startServer();
      
      // Server should be listening on port 3456
      const response = await request(server).get('/healthz');
      
      expect(response.status).toBe(200);
      
      delete process.env.N8N_PORT;
    });

    it('should use default port 3000', async () => {
      server = await startServer();
      
      const response = await request(server).get('/healthz');
      
      expect(response.status).toBe(200);
    });
  });

  describe('Host Configuration', () => {
    it('should respect N8N_HOST environment variable', async () => {
      process.env.N8N_HOST = '127.0.0.1';
      
      server = await startServer();
      
      const response = await request(server).get('/healthz');
      
      expect(response.status).toBe(200);
      
      delete process.env.N8N_HOST;
    });
  });

  describe('Environment Validation', () => {
    it('should fail fast on invalid configuration', async () => {
      process.env.N8N_PORT = 'invalid';
      
      await expect(startServer()).rejects.toThrow();
      
      delete process.env.N8N_PORT;
    });
  });
});
```

#### 2.7 Restart Tests (`tests/integration/restart.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from '../runtime/utils/http';

describe('Restart Behavior', () => {
  let server1: any;
  let server2: any;

  afterEach(async () => {
    if (server1) await stopServer(server1);
    if (server2) await stopServer(server2);
    server1 = null;
    server2 = null;
  });

  it('should start and stop multiple times without errors', async () => {
    // Start server 1
    server1 = await startServer({ port: 0 });
    expect(server1).toBeDefined();

    // Stop server 1
    await stopServer(server1);

    // Start server 2
    server2 = await startServer({ port: 0 });
    expect(server2).toBeDefined();

    // Stop server 2
    await stopServer(server2);
  });

  it('should not leak memory after multiple restarts', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    // Start and stop 10 times
    for (let i = 0; i < 10; i++) {
      const server = await startServer({ port: 0 });
      await stopServer(server);
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryDiff = finalMemory - initialMemory;

    // Memory should not increase significantly
    expect(memoryDiff).toBeLessThan(initialMemory * 0.5);
  });

  it('should handle graceful shutdown', async () => {
    server1 = await startServer({ port: 0 });
    
    // Simulate SIGTERM
    server1.emit('SIGTERM');
    
    // Server should stop gracefully
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
});
```

#### 2.8 Regression Tests (`tests/integration/regression.test.ts`)

```typescript
import { startServer, stopServer } from '../../apps/n8n-ts/src/server';
import { request } from '../runtime/utils/http';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '../fixtures/workflows');

describe('Regression Tests', () => {
  let server: any;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  describe('Previously Working Workflows', () => {
    it('should still execute basic workflow', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'basic-flow.json'),
        'utf-8'
      ));
      
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      expect(response.status).toBe(202);
      expect(response.body.executionId).toBeDefined();
    });

    it('should still handle errors correctly', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'error-flow.json'),
        'utf-8'
      ));
      
      const response = await request(server)
        .post('/api/v1/workflows/run')
        .send({ workflow });
      
      // Should not crash, should return error response
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Performance', () => {
    it('should not degrade performance over time', async () => {
      const workflow = JSON.parse(readFileSync(
        join(FIXTURES_DIR, 'simple.json'),
        'utf-8'
      ));

      const startTime = Date.now();
      
      // Execute 100 workflows
      for (let i = 0; i < 100; i++) {
        await request(server)
          .post('/api/v1/workflows/run')
          .send({ workflow });
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / 100;

      // Average should be less than 100ms per workflow
      expect(avgTime).toBeLessThan(100);
    });
  });
});
```

### 3. Test Utilities (`tests/runtime/utils/http.ts`)

```typescript
import * as http from 'http';
import * as https from 'https';

export interface TestServer {
  address: () => { port: number };
  close: () => Promise<void>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  emit: (event: string, ...args: any[]) => boolean;
}

export interface TestResponse {
  status: number;
  body: any;
  headers: Record<string, string>;
}

export function request(server: TestServer) {
  const port = server.address().port;
  
  return {
    get: (path: string): Promise<TestResponse> => {
      return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${path}`, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              const body = data ? JSON.parse(data) : {};
              resolve({
                status: res.statusCode || 200,
                body,
                headers: res.headers as any
              });
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });
    },
    
    post: (path: string, body?: any): Promise<TestResponse> => {
      return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        
        const options = {
          hostname: 'localhost',
          port,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              const body = data ? JSON.parse(data) : {};
              resolve({
                status: res.statusCode || 200,
                body,
                headers: res.headers as any
              });
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    }
  };
}
```

### 4. Workflow Fixtures

#### `tests/fixtures/workflows/simple.json`
```json
{
  "id": "simple-workflow",
  "name": "Simple Workflow",
  "nodes": [
    {
      "id": "start",
      "name": "Start",
      "type": "n8n-nodes-base.start",
      "parameters": {}
    },
    {
      "id": "end",
      "name": "End",
      "type": "n8n-nodes-base.noOp",
      "parameters": {}
    }
  ],
  "connections": {
    "start": {
      "main": [["end"]]
    }
  }
}
```

#### `tests/fixtures/workflows/multi-node.json`
```json
{
  "id": "multi-node-workflow",
  "name": "Multi-Node Workflow",
  "nodes": [
    {
      "id": "start",
      "name": "Start",
      "type": "n8n-nodes-base.start",
      "parameters": {}
    },
    {
      "id": "node1",
      "name": "Node 1",
      "type": "n8n-nodes-base.noOp",
      "parameters": {}
    },
    {
      "id": "node2",
      "name": "Node 2",
      "type": "n8n-nodes-base.noOp",
      "parameters": {}
    },
    {
      "id": "end",
      "name": "End",
      "type": "n8n-nodes-base.noOp",
      "parameters": {}
    }
  ],
  "connections": {
    "start": {
      "main": [["node1"]]
    },
    "node1": {
      "main": [["node2"]]
    },
    "node2": {
      "main": [["end"]]
    }
  }
}
```

#### `tests/fixtures/workflows/empty.json`
```json
{
  "id": "empty-workflow",
  "name": "Empty Workflow"
}
```

#### `tests/fixtures/workflows/invalid.json`
```json
{
  "id": "invalid-workflow",
  "name": "Invalid Workflow",
  "nodes": [
    {
      "id": "start",
      "name": "Start",
      "type": "unknownNodeType",
      "parameters": {}
    }
  ]
}
```

### 5. Test Configuration

#### `tests/package.json`
```json
{
  "name": "@n8n/tests",
  "version": "0.4.0",
  "private": true,
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^22.10.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "~5.9.2"
  }
}
```

#### `tests/jest.config.js`
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  collectCoverageFrom: [
    'runtime/**/*.ts',
    'integration/**/*.ts'
  ],
  coverageDirectory: 'coverage'
};
```

---

## Boundaries - DO NOT CROSS

### ❌ YOU MUST NOT TOUCH:
- `apps/n8n-ts/src/**` - Worker 1 territory (except for adding test hooks)
- `deploy/docker/**` - Worker 2 territory
- `scripts/` - Worker 2 territory
- `packages/**` - Worker 4 territory
- `crates/**` - Rust is FROZEN
- `reference/n8n/**` - Reference is FROZEN
- Other workers' branches

### ✅ YOU CAN TOUCH:
- `tests/runtime/**` - Your territory
- `tests/integration/**` - Your territory
- `tests/fixtures/**` - Your territory
- `tests/package.json` - Your territory
- `tests/jest.config.js` - Your territory

---

## Acceptance Criteria

### Test Coverage
- [ ] Health endpoint tests (GET /healthz)
- [ ] Root endpoint tests (GET /)
- [ ] Workflow execution tests (POST /api/v1/workflows/run)
- [ ] Malformed request tests
- [ ] Empty workflow tests
- [ ] Unknown node tests
- [ ] Error handling tests
- [ ] Configuration tests
- [ ] Restart behavior tests
- [ ] Regression tests

### Test Quality
- [ ] Tests validate real runtime (not just mocks)
- [ ] Tests cover all acceptance criteria
- [ ] Tests are reliable and deterministic
- [ ] Tests run in < 5 minutes
- [ ] Tests have > 90% pass rate

### Test Execution
- [ ] Tests run with `npm test`
- [ ] Tests can be run in watch mode
- [ ] Tests generate coverage reports
- [ ] Tests work in CI environment

---

## Workflow

1. **Read Contract**: Study `contracts/runtime-server.contract.md`
2. **Implement**: Create all test files and fixtures
3. **Test**: Run tests locally to verify they work
4. **Commit**: Commit changes to `worker/3-testing` branch
5. **PR**: Create PR to `arena/01a0c019-n8n-rust-v-4`
6. **Notify**: Inform MANAGER that PR is ready for review

---

## Testing Your Work

### Local Testing
1. Start the runtime server: `cd apps/n8n-ts && npm run dev`
2. Run tests: `cd tests && npm test`
3. Verify all tests pass
4. Verify tests cover all acceptance criteria

### Integration Testing
1. Ensure tests work with the real runtime server
2. Verify tests detect actual issues
3. Ensure tests are not flaky

---

## Success Criteria

Your PR will be accepted when:
- [ ] All deliverables complete
- [ ] All acceptance criteria met
- [ ] No boundary violations
- [ ] Tests are comprehensive
- [ ] Tests pass reliably

---

**Worker 3 Status**: READY TO START
**Contract**: `contracts/runtime-server.contract.md`
**Branch**: `worker/3-testing`
