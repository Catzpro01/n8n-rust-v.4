# TypeScript Baseline Plan - MANAGER View

## Executive Summary

**Goal**: Build a production-ready TypeScript baseline that serves as the foundation for Rust migration.

**Status**: PLANNING PHASE - Contracts being defined

**Target**: `https://n8n.kentutmambu.my.id/` running TypeScript baseline

---

## Phase 0: Contract Definition (NOW)

### Task: Define Runtime Contract
**Owner**: MANAGER
**Status**: IN PROGRESS
**Deliverable**: `contracts/runtime-server.contract.md`

- [x] Create runtime contract document
- [x] Define API endpoints
- [x] Define integration requirements with reconstructed-engine
- [x] Define worker boundaries
- [x] Define acceptance criteria
- [x] Define merge strategy

**Next**: Review contract with stakeholders, get approval

---

## Phase 1: Parallel Worker Dispatch (AFTER CONTRACT APPROVAL)

### Worker 1: Runtime Server
**Branch**: `worker/1-runtime-server`
**Scope**: `apps/n8n-ts/**`
**Owner**: Worker 1 Team
**Status**: NOT STARTED

#### Tasks:
1. Create `apps/n8n-ts/package.json` with dependencies
2. Create `apps/n8n-ts/tsconfig.json`
3. Implement HTTP server using `node:http`
   - `src/server/http-server.ts` - Core HTTP server
   - `src/server/routes/` - Route handlers
   - `src/server/handlers/` - Business logic
   - `src/engine/index.ts` - Engine integration
4. Implement endpoints:
   - `GET /` - Server info
   - `GET /healthz` - Health check
   - `POST /api/v1/workflows/run` - Execute workflow
5. Integrate with `packages/reconstructed-engine`
6. Add basic unit tests

#### Deliverables:
- Complete `apps/n8n-ts/` directory
- All endpoints functional
- Engine integration verified
- Basic tests passing

#### Boundaries (MUST NOT TOUCH):
- ❌ `deploy/docker/**`
- ❌ `scripts/install.sh`, `start.sh`, `stop.sh`, `upgrade.sh`, `rollback.sh`, `doctor.sh`
- ❌ `.env.example`
- ❌ `packages/**` (except for reading/importing)
- ❌ `crates/**`
- ❌ `reference/n8n/**`

---

### Worker 2: Packaging
**Branch**: `worker/2-packaging`
**Scope**: `deploy/docker/**`, `scripts/`, `.env.example`
**Owner**: Worker 2 Team
**Status**: NOT STARTED

#### Tasks:
1. Create Docker configuration:
   - `deploy/docker/Dockerfile` - Multi-stage build
   - `deploy/docker/docker-compose.yml` - Local development
   - `deploy/docker/.dockerignore`
2. Create installation scripts:
   - `scripts/install.sh` - Install dependencies, build, setup
   - `scripts/start.sh` - Start the server
   - `scripts/stop.sh` - Stop the server
   - `scripts/upgrade.sh` - Upgrade to new version
   - `scripts/rollback.sh` - Rollback to previous version
   - `scripts/doctor.sh` - Diagnose issues
3. Update `.env.example` with runtime server configuration

#### Deliverables:
- Docker images buildable
- Scripts executable and idempotent
- Clean machine → install → start → running
- Rollback functionality working

#### Boundaries (MUST NOT TOUCH):
- ❌ `apps/n8n-ts/**` (except for reading to understand requirements)
- ❌ `packages/**`
- ❌ `tests/**`
- ❌ `crates/**`

---

### Worker 3: Testing
**Branch**: `worker/3-testing`
**Scope**: `tests/runtime/**`, `tests/integration/**`
**Owner**: Worker 3 Team
**Status**: NOT STARTED

#### Tasks:
1. Create test directory structure:
   - `tests/runtime/` - Runtime server tests
   - `tests/integration/` - Integration tests
   - `tests/fixtures/` - Test fixtures (workflows, data)
2. Implement tests for:
   - Health check endpoint
   - Workflow execution (various scenarios)
   - Malformed request handling
   - Empty workflow handling
   - Unknown node type handling
   - Server restart behavior
   - Configuration validation
   - Regression prevention
3. Ensure tests validate real runtime, not just mocks

#### Test Categories:

##### Health Tests (`tests/runtime/health.test.ts`)
- [ ] `/healthz` returns 200 with status ok
- [ ] `/healthz` returns 503 when engine unhealthy
- [ ] Health check responds within 100ms
- [ ] Health check validates all components

##### Workflow Execution Tests (`tests/runtime/workflow-execution.test.ts`)
- [ ] Simple workflow executes successfully
- [ ] Multi-node workflow executes in order
- [ ] Workflow with branches executes correctly
- [ ] Workflow execution returns executionId
- [ ] Workflow execution status updates correctly

##### Error Handling Tests (`tests/runtime/errors.test.ts`)
- [ ] Malformed JSON request returns 400
- [ ] Missing required fields returns 422
- [ ] Unknown node type returns 404
- [ ] Invalid workflow structure returns 422
- [ ] Empty workflow returns appropriate error
- [ ] Error responses have consistent envelope

##### Configuration Tests (`tests/runtime/config.test.ts`)
- [ ] Server respects N8N_PORT
- [ ] Server respects N8N_HOST
- [ ] Server respects N8N_API_KEY
- [ ] Server fails fast on invalid config
- [ ] Environment variables override defaults

##### Restart Tests (`tests/integration/restart.test.ts`)
- [ ] Server restarts cleanly
- [ ] No memory leaks after multiple restarts
- [ ] Active executions complete before shutdown
- [ ] Graceful shutdown on SIGTERM

##### Regression Tests (`tests/integration/regression.test.ts`)
- [ ] Previously working workflows still work
- [ ] Previously fixed bugs stay fixed
- [ ] Performance doesn't degrade

#### Deliverables:
- Complete test suite
- All tests passing
- Tests cover all acceptance criteria
- Tests run against real runtime (not mocks)

#### Boundaries (MUST NOT TOUCH):
- ❌ `apps/n8n-ts/src/**` (except for adding test hooks)
- ❌ `deploy/docker/**`
- ❌ `scripts/`
- ❌ `packages/**`

---

### Worker 4: LEGO Integration
**Branch**: `worker/4-lego-integration`
**Scope**: Audit and integrate `packages/workflow-lego`, `packages/execution-lego`, `packages/reconstructed-engine`
**Owner**: Worker 4 Team
**Status**: NOT STARTED

#### Tasks:
1. Audit `packages/reconstructed-engine`:
   - Verify all invariants (X1-X17)
   - Verify port interfaces
   - Verify memory implementations
   - Document any gaps
2. Audit `packages/workflow-lego`:
   - Verify boundary map
   - Verify model surface
   - Verify port surface
   - Document integration points
3. Audit `packages/execution-lego`:
   - Verify execution model
   - Verify contracts
   - Document integration points
4. Ensure runtime server uses existing components:
   - No second execution engine created
   - All execution goes through reconstructed-engine
   - Proper port injection
5. Create integration layer documentation

#### Deliverables:
- Audit report for each LEGO package
- Integration verification
- Documentation of integration points
- Confirmation that no second engine exists

#### Boundaries (MUST NOT TOUCH):
- ❌ `apps/n8n-ts/**` (except for integration layer)
- ❌ `deploy/docker/**`
- ❌ `scripts/`
- ❌ `tests/**`

---

## Phase 2: Integration & Merge (AFTER ALL PRs SUBMITTED)

### Task: Review and Merge Worker PRs
**Owner**: MANAGER
**Status**: NOT STARTED

#### Steps for Each PR:
1. **Boundary Check**: Verify worker didn't touch other workers' areas
2. **Code Review**: Review implementation quality
3. **Test Validation**: Run tests locally
4. **Merge**: Merge PR to `arena/01a0c019-n8n-rust-v-4`

#### Merge Order:
1. Worker 1: Runtime Server (foundation)
2. Worker 2: Packaging (depends on runtime structure)
3. Worker 3: Testing (depends on runtime)
4. Worker 4: LEGO Integration (depends on runtime)

---

## Phase 3: Final Validation (AFTER ALL MERGES)

### Task: Build, Test, Deploy
**Owner**: MANAGER
**Status**: NOT STARTED

#### Steps:
1. **Build**: Run full build on laptop runner
   - [ ] `npm install` succeeds
   - [ ] `npm run build` succeeds (if applicable)
   - [ ] TypeScript compilation succeeds
   - [ ] All dependencies resolved

2. **Test**: Run full test suite on laptop runner
   - [ ] All unit tests pass
   - [ ] All integration tests pass
   - [ ] All acceptance criteria met

3. **Deploy**: Deploy to VPS runner `vps-runtime`
   - [ ] Install script runs successfully
   - [ ] Server starts on boot
   - [ ] Health check passes
   - [ ] All endpoints accessible

4. **Smoke Test**: Run live smoke test
   - [ ] `https://n8n.kentutmambu.my.id/` returns 200
   - [ ] `https://n8n.kentutmambu.my.id/healthz` returns 200
   - [ ] Workflow execution test succeeds
   - [ ] Error handling test succeeds

---

## Phase 4: Baseline Freeze

### Task: Declare TYPESCRIPT BASELINE FROZEN
**Owner**: User ( Kent Utama Mambu )
**Status**: NOT STARTED

#### Criteria (ALL MUST PASS):
- [ ] All worker PRs merged
- [ ] All acceptance criteria met
- [ ] All tests passing
- [ ] Build succeeds on laptop runner
- [ ] Deploy succeeds on VPS runner
- [ ] Live smoke test passes
- [ ] Documentation complete
- [ ] No critical bugs open

#### After Freeze:
- Create Rust migration tasks (one per LEGO)
- Begin LEGO → Rust migration
- Maintain TypeScript baseline as fallback

---

## Communication Protocol

### Worker → MANAGER
- Questions about contract: Ask in PR comments
- Blockers: Escalate to MANAGER
- Boundary concerns: Request clarification
- Ready for review: Submit PR, notify MANAGER

### MANAGER → Workers
- Contract updates: Broadcast to all workers
- Priority changes: Notify affected workers
- Blocking issues: Resolve or escalate
- Merge decisions: Communicate clearly

---

## Timeline (Estimated)

| Phase | Duration | Start | End |
| :--- | :--- | :--- | :--- |
| Phase 0: Contract | 1-2 days | 2026-09-20 | 2026-09-21 |
| Phase 1: Workers | 3-5 days | 2026-09-21 | 2026-09-25 |
| Phase 2: Integration | 1-2 days | 2026-09-25 | 2026-09-26 |
| Phase 3: Validation | 1 day | 2026-09-26 | 2026-09-27 |
| **Total** | **6-10 days** | 2026-09-20 | 2026-09-27 |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| Contract misunderstandings | Medium | High | Detailed contract, early review |
| Boundary violations | Medium | High | Automated boundary checks, code review |
| Integration issues | Medium | High | Integration tests, early integration |
| Performance issues | Low | Medium | Performance testing, profiling |
| Dependency conflicts | Low | Medium | Dependency audit, version pinning |

---

## Success Criteria

### Must Have:
- [ ] Runtime server functional
- [ ] All endpoints working
- [ ] Engine integration complete
- [ ] Packaging complete
- [ ] Tests passing
- [ ] Deployable to VPS
- [ ] Live at `https://n8n.kentutmambu.my.id/`

### Should Have:
- [ ] Comprehensive documentation
- [ ] Good logging
- [ ] Easy debugging
- [ ] Graceful error handling
- [ ] Performance metrics

### Nice to Have:
- [ ] Swagger/OpenAPI documentation
- [ ] Prometheus metrics
- [ ] Distributed tracing
- [ ] Rate limiting
- [ ] Caching

---

## Next Actions

### Immediate (Today):
1. [x] Create runtime contract document
2. [ ] Review contract with stakeholders
3. [ ] Get contract approval
4. [ ] Create worker branches
5. [ ] Dispatch workers

### This Week:
1. [ ] Worker 1: Implement runtime server
2. [ ] Worker 2: Implement packaging
3. [ ] Worker 3: Implement testing
4. [ ] Worker 4: Audit LEGO packages

### Next Week:
1. [ ] Review and merge all PRs
2. [ ] Run integration tests
3. [ ] Deploy to VPS
4. [ ] Run live smoke tests
5. [ ] Declare BASELINE FROZEN

---

## Document Control

| Version | Date | Author | Changes |
| :--- | :--- | :--- | :--- |
| 1.0 | 2026-09-20 | MANAGER | Initial plan created |

---

**Manager Status**: Ready to dispatch workers after contract approval
**Blocking Issues**: None
**Pending Approvals**: Runtime contract
