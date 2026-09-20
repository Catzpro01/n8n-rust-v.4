/**
 * W1 unit gate — workflow and execution stores (file + memory, restart safety).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowStore } from '../src/store/workflow-store.ts';
import { ExecutionStore } from '../src/store/execution-store.ts';
import { createLogger } from '../src/logger.ts';

const silentLogger = createLogger({ level: 'error', sink: () => {} });
const definition = (name) => ({
  name,
  nodes: [{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
  connections: {},
});

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'n8n-ts-store-'));
}

test('workflow store saves, lists, updates and deletes (memory)', async () => {
  const store = await WorkflowStore.create({ dataDir: '/nonexistent', storage: 'memory', logger: silentLogger });
  const { workflow, created } = await store.save(definition('first'));
  assert.equal(created, true);
  assert.match(workflow.id, /^wf_[0-9a-f]{32}$/);
  assert.equal(workflow.name, 'first');
  assert.equal(store.has(workflow.id), true);

  const updated = await store.save({ ...workflow, name: 'renamed' }, { id: workflow.id });
  assert.equal(updated.created, false);
  assert.equal(updated.workflow.name, 'renamed');
  assert.equal(updated.workflow.createdAt, workflow.createdAt);
  assert.equal(store.list().length, 1);

  assert.equal(await store.delete(workflow.id), true);
  assert.equal(await store.delete(workflow.id), false);
  assert.equal(store.list().length, 0);
});

test('workflow store defaults the name and rejects non-array nodes', async () => {
  const store = await WorkflowStore.create({ dataDir: '/nonexistent', storage: 'memory', logger: silentLogger });
  const { workflow } = await store.save({ nodes: [] });
  assert.equal(workflow.name, 'Untitled workflow');
  await assert.rejects(() => store.save({ nodes: 'nope' }), (error) => error.code === 'VALIDATION_ERROR');
  await assert.rejects(() => store.save({ nodes: [], connections: [] }), (error) => error.code === 'VALIDATION_ERROR');
});

test('workflow store survives a restart (file storage)', async () => {
  const dir = await tempDir();
  try {
    const first = await WorkflowStore.create({ dataDir: dir, storage: 'file', logger: silentLogger });
    const { workflow } = await first.save(definition('persisted'));
    const second = await WorkflowStore.create({ dataDir: dir, storage: 'file', logger: silentLogger });
    assert.equal(second.list().length, 1);
    assert.equal(second.get(workflow.id).name, 'persisted');
    const raw = JSON.parse(await readFile(join(dir, 'workflows.json'), 'utf8'));
    assert.equal(raw.version, 1);
    assert.ok(raw.workflows[workflow.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupt workflow store aborts loudly instead of silently losing data', async () => {
  const dir = await tempDir();
  try {
    await writeFile(join(dir, 'workflows.json'), '{ not json', 'utf8');
    await assert.rejects(
      () => WorkflowStore.create({ dataDir: dir, storage: 'file', logger: silentLogger }),
      (error) => error.code === 'STORAGE_ERROR',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function record(id, startedAt = new Date().toISOString()) {
  return {
    executionId: id,
    workflowId: null,
    status: 'COMPLETED',
    finished: true,
    startedAt,
    stoppedAt: startedAt,
    durationMs: 1,
    requestedAt: startedAt,
    requestedBy: 'http',
    mode: 'manual',
    nodeCount: 1,
    ok: true,
    executionLog: [{ node: 'A', type: 'n8n-nodes-base.noOp', inputCount: 1, outputCount: 1, durationMs: 0, status: 'success' }],
    data: { A: [{ json: { ok: true } }] },
    warnings: [],
  };
}

test('execution store lists newest first and prunes to the history limit', async () => {
  const store = await ExecutionStore.create({ dataDir: '/nonexistent', storage: 'memory', history: 3, logger: silentLogger });
  for (const id of ['exec_1', 'exec_2', 'exec_3', 'exec_4']) {
    await store.add(record(id, `2026-01-01T00:00:0${id.slice(-1)}Z`));
  }
  const listed = store.list(10);
  assert.deepEqual(listed.map((entry) => entry.executionId), ['exec_4', 'exec_3', 'exec_2']);
  assert.equal(store.size, 3);
  assert.equal(await store.get('exec_1'), null);
});

test('execution records survive a restart (file storage)', async () => {
  const dir = await tempDir();
  try {
    const first = await ExecutionStore.create({ dataDir: dir, storage: 'file', history: 10, logger: silentLogger });
    await first.add(record('exec_persist', '2026-01-01T00:00:00Z'));

    const second = await ExecutionStore.create({ dataDir: dir, storage: 'file', history: 10, logger: silentLogger });
    assert.equal(second.list(10).length, 1);
    const restored = await second.get('exec_persist');
    assert.equal(restored.status, 'COMPLETED');
    assert.deepEqual(restored.data, { A: [{ json: { ok: true } }] });
    assert.equal(restored.executionLog.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('execution record missing from disk returns null instead of throwing', async () => {
  const dir = await tempDir();
  try {
    const store = await ExecutionStore.create({ dataDir: dir, storage: 'file', history: 10, logger: silentLogger });
    assert.equal(await store.get('exec_does_not_exist'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
