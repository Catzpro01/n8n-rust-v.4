import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CorruptedExecutionDataError,
  EXECUTION_STATUSES,
  ExecutionPersistence,
  ExecutionRepository,
  SettingsRepository,
  WorkflowConflictError,
  WorkflowRepository,
  WorkflowStaticDataService,
  determineFinalExecutionStatus,
  parse,
  parseExecutionData,
  stringify,
} from '../src/index.mjs';

test('flatted wire round-trips shared and circular object identity', () => {
  const shared = { json: { value: 1 } };
  const value = { left: shared, right: shared };
  value.self = value;
  const wire = stringify(value);
  assert.equal(wire, '[{"left":"1","right":"1","self":"0"},{"json":"2"},{"value":1}]');
  assert.equal(typeof JSON.parse(wire)[0].left, 'string');
  const restored = parse(wire);
  assert.equal(restored.left, restored.right);
  assert.equal(restored.self, restored);
  assert.deepEqual(restored.left.json, { value: 1 });
  assert.equal(stringify(false), '[false]');
  assert.equal(parse('[false]'), false);
  assert.equal(stringify(0), '[0]');
  assert.equal(stringify(null), '[null]');
});

test('corrupt execution wire raises CorruptedExecutionDataError', () => {
  assert.throws(() => parseExecutionData('{"plain":"json"}'), CorruptedExecutionDataError);
});

function workflowRepository() {
  let id = 0;
  return new WorkflowRepository({ idFactory: () => `workflow-${++id}`, versionFactory: () => `version-${++id}` });
}

test('workflow create writes initial history and allows duplicate names', () => {
  const repository = workflowRepository();
  const first = repository.create({ name: 'same', nodes: [], connections: {} });
  const second = repository.create({ name: 'same', nodes: [], connections: {} });
  assert.notEqual(first.id, second.id);
  assert.equal(first.versionCounter, 1);
  assert.equal(repository.history.length, 2);
});

test('duplicate workflow id is rejected with exact message', () => {
  const repository = workflowRepository();
  repository.create({ id: 'fixed', name: 'one', nodes: [], connections: {} });
  assert.throws(
    () => repository.create({ id: 'fixed', name: 'two', nodes: [], connections: {} }),
    (error) => error instanceof WorkflowConflictError && error.message === 'Workflow with id fixed exists already.',
  );
});

test('version changes only when nodes or connections change', () => {
  const repository = workflowRepository();
  const created = repository.create({ name: 'wf', nodes: [], connections: {}, settings: {} });
  const settings = repository.update(created.id, { settings: { timezone: 'UTC' } }, { expectedVersionId: created.versionId });
  assert.equal(settings.versionId, created.versionId);
  assert.equal(repository.history.length, 1);
  const changed = repository.update(created.id, { nodes: [{ name: 'A' }] }, { expectedVersionId: created.versionId });
  assert.notEqual(changed.versionId, created.versionId);
  assert.equal(changed.versionCounter, 2);
  assert.equal(repository.history.length, 2);
});

test('activation and deactivation maintain activeVersionId and publish history', () => {
  const repository = workflowRepository();
  const workflow = repository.create({ name: 'wf', nodes: [], connections: {}, triggerCount: 2 });
  assert.equal(repository.activate(workflow.id).activeVersionId, workflow.versionId);
  assert.deepEqual(repository.getAllActiveIds(), [workflow.id]);
  assert.equal(repository.getActiveTriggerCount(), 2);
  assert.equal(repository.deactivate(workflow.id).activeVersionId, null);
  assert.deepEqual(repository.publishHistory.map((entry) => entry.event), ['activated', 'deactivated']);
});

test('workflow must be archived before hard deletion', () => {
  const repository = workflowRepository();
  const workflow = repository.create({ name: 'wf', nodes: [], connections: {} });
  assert.throws(() => repository.delete(workflow.id), /Workflow must be archived before it can be deleted/);
  repository.archive(workflow.id);
  assert.equal(repository.delete(workflow.id), true);
  assert.equal(repository.findById(workflow.id), null);
});

test('execution lifecycle stores flatted data and a pin-free workflow snapshot', () => {
  const repository = new ExecutionRepository();
  const persistence = new ExecutionPersistence(repository);
  const id = persistence.create({
    mode: 'webhook', workflowId: 'wf',
    workflowData: { id: 'wf', name: 'WF', versionId: 'v1', nodes: [], connections: {}, settings: {}, pinData: { A: [] } },
    data: { resultData: { runData: {} } },
  });
  assert.equal(id, '1');
  assert.equal(repository.findSingleExecution(id).status, 'new');
  repository.setRunning(id, new Date('2026-01-01'));
  const running = repository.findSingleExecution(id, { includeData: true });
  assert.equal(running.status, 'running');
  assert.equal(typeof running.data, 'string');
  assert.equal('pinData' in running.workflowData, false);
  assert.deepEqual(repository.findSingleExecution(id, { includeData: true, unflattenData: true }).data, { resultData: { runData: {} } });
});

test('guarded execution updates reject finished or canceled rows', () => {
  const repository = new ExecutionRepository();
  const id = repository.create({ mode: 'manual', workflowData: {}, data: {} });
  repository.updateExistingExecution(id, { status: 'success', finished: true });
  assert.equal(repository.updateExistingExecution(id, { status: 'error' }, { requireNotFinished: true }), false);
  const other = repository.create({ mode: 'manual', workflowData: {}, data: {} });
  repository.cancel(other);
  assert.equal(repository.updateExistingExecution(other, { status: 'running' }, { requireNotCanceled: true }), false);
});

test('recovery, soft delete, and hard delete transitions are explicit', () => {
  const repository = new ExecutionRepository();
  const one = repository.create({ mode: 'trigger', workflowData: {}, data: {} });
  const two = repository.create({ mode: 'trigger', workflowData: {}, data: {} });
  repository.setRunning(two);
  assert.deepEqual(repository.getInProgressExecutionIds(), ['1', '2']);
  repository.markAsCrashed([one, two], new Date('2026-01-01'));
  assert.equal(repository.findSingleExecution(one).status, 'crashed');
  repository.softDelete(one);
  assert.equal(repository.findSingleExecution(one), undefined);
  assert.equal(repository.findSingleExecution(one, { includeDeleted: true }).status, 'crashed');
  assert.equal(repository.hardDelete(one), true);
});

test('final status follows wait, cancel, crash, error, then success precedence', () => {
  assert.deepEqual(EXECUTION_STATUSES, ['new', 'running', 'success', 'error', 'crashed', 'canceled', 'waiting', 'unknown']);
  assert.deepEqual(determineFinalExecutionStatus({ waitTill: new Date() }), { status: 'waiting', finished: false });
  assert.deepEqual(determineFinalExecutionStatus({ status: 'canceled' }), { status: 'canceled', finished: false });
  assert.deepEqual(determineFinalExecutionStatus({ data: { resultData: { error: {} } } }), { status: 'error', finished: true });
  assert.deepEqual(determineFinalExecutionStatus({}), { status: 'success', finished: true });
});

test('static data saves only changed non-manual workflow state', () => {
  const repository = workflowRepository();
  const created = repository.create({ name: 'wf', nodes: [], connections: {}, staticData: {} });
  const service = new WorkflowStaticDataService(repository);
  assert.equal(service.saveStaticData({ id: created.id, staticData: { value: 1 } }), false);
  assert.equal(service.saveStaticData({ id: created.id, staticData: { __dataChanged: true, value: 2 } }, 'manual'), false);
  assert.equal(service.saveStaticData({ id: created.id, staticData: { __dataChanged: true, value: 3 } }), true);
  assert.deepEqual(repository.findById(created.id).staticData, { value: 3 });
});

test('settings repository provides key upsert semantics', () => {
  const settings = new SettingsRepository();
  settings.upsert('feature.enabled', true);
  settings.upsert('feature.enabled', false, false);
  assert.deepEqual(settings.findByKey('feature.enabled'), { key: 'feature.enabled', value: 'false', loadOnStartup: false });
  assert.equal(settings.delete('feature.enabled'), true);
  assert.equal(settings.findByKey('feature.enabled'), null);
});
