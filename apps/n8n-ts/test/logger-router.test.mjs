/**
 * W1 unit gate — logger and router primitives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.ts';
import { Router } from '../src/http/router.ts';

function capture() {
  const lines = [];
  return { lines, sink: (line, isError) => lines.push({ line, isError }) };
}

test('logger filters below the configured level', () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: 'warn', format: 'json', sink, now: () => new Date('2026-01-01T00:00:00Z') });
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0].line).msg, 'w');
  assert.equal(lines[0].isError, false);
  assert.equal(JSON.parse(lines[1].line).msg, 'e');
  assert.equal(lines[1].isError, true);
});

test('logger json output carries base fields and serializes errors', () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: 'info', format: 'json', base: { service: 'test' }, sink, now: () => new Date('2026-01-01T00:00:00Z') });
  logger.info('hello', { cause: new Error('boom'), requestId: 'r1', skipped: undefined });
  const entry = JSON.parse(lines[0].line);
  assert.equal(entry.service, 'test');
  assert.equal(entry.requestId, 'r1');
  assert.equal(entry.cause.message, 'boom');
  assert.equal('skipped' in entry, false);
  assert.equal(entry.ts, '2026-01-01T00:00:00.000Z');
});

test('logger text format is human readable and child loggers inherit the sink', () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: 'info', format: 'text', base: { service: 'test' }, sink });
  logger.child({ requestId: 'abc' }).info('hello', { status: 200 });
  assert.match(lines[0].line, / INFO {2}hello /);
  assert.match(lines[0].line, /"requestId":"abc"/);
});

test('router matches static and parameterised paths', () => {
  const router = new Router();
  const calls = [];
  router.get('/', () => calls.push('root'));
  router.get('/api/v1/workflows/:id', (context) => calls.push(`get ${context.params.id}`));
  router.delete('/api/v1/workflows/:id', (context) => calls.push(`delete ${context.params.id}`));

  const match = router.match('GET', '/api/v1/workflows/wf_123');
  assert.equal(match.kind, 'match');
  assert.deepEqual(match.params, { id: 'wf_123' });
  assert.equal(router.match('GET', '/api/v1/workflows/wf_123/extra'), null);
  assert.equal(router.match('GET', '/nope'), null);
});

test('router reports method-not-allowed with the allowed set', () => {
  const router = new Router();
  router.get('/api/v1/version', () => {});
  const match = router.match('DELETE', '/api/v1/version');
  assert.equal(match.kind, 'method-not-allowed');
  assert.deepEqual(match.allowed, ['GET']);
});

test('router decodes url-encoded parameters and lists registered routes', () => {
  const router = new Router();
  router.get('/api/v1/workflows/:id', (context) => context.params.id);
  const match = router.match('GET', '/api/v1/workflows/wf%20space');
  assert.equal(match.params.id, 'wf space');
  assert.deepEqual(router.routes(), [{ method: 'GET', path: '/api/v1/workflows/:id' }]);
});
