/**
 * The universal agent event contract, the work trace and the delegation model
 * (Tasks 8, 9, 10, 18, 21).
 *
 * One rule runs through the whole suite: an event is an operational fact with a
 * reference, never a payload. Everything else — the closed vocabulary, the mapping
 * from a foreign runtime, the bound on the trace, the tree that grants nothing — is
 * built to keep that true while the UI stays useful.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_EVENT_TYPES,
  AgentEventError,
  DELEGATION_FIELDS,
  EVENT_DELIVERY,
  EVENT_GROUPS,
  EVENT_STATUSES,
  SUMMARY_LIMIT,
  TERMINAL_STATUSES,
  TRACE_FIELDS,
  TRACE_LIMIT,
  buildDelegationTree,
  createEventNormalizer,
  createWorkTrace,
  deliveryClassesFor,
  describeAgentEvents,
  isAgentEventType,
  validateTraceEvent,
} from '../src/agent-events.mjs';
import { INTERACTION_CLASSES } from '../src/interactions.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { vocabularyOf } from '../src/vocabulary.mjs';

const row = (overrides) => ({ timestamp: 1, ...overrides });

test('the vocabulary is closed and namespaced, and every namespace is documented', () => {
  assert.equal(AGENT_EVENT_TYPES.length, 26);
  assert.equal(new Set(AGENT_EVENT_TYPES).size, AGENT_EVENT_TYPES.length, 'no duplicate event type');
  for (const type of AGENT_EVENT_TYPES) {
    assert.match(type, /^[a-z]+\.[a-z]+$/, `${type} is <namespace>.<event>`);
    assert.equal(isAgentEventType(type), true);
  }
  assert.equal(isAgentEventType('agent.teleported'), false);
  assert.equal(isAgentEventType('payload'), false);
  const grouped = EVENT_GROUPS.flatMap((group) => group.types);
  assert.deepEqual([...grouped].sort(), [...AGENT_EVENT_TYPES].sort(), 'every event belongs to exactly one namespace');
  for (const group of EVENT_GROUPS) assert.ok(group.meaning.length > 15, `${group.prefix} says what it means`);
});

test('events declare their interaction class and never a transport', () => {
  for (const [namespace, classes] of Object.entries(EVENT_DELIVERY)) {
    assert.ok(classes.length > 0, `${namespace} is deliverable`);
    for (const interaction of classes) {
      assert.ok(INTERACTION_CLASSES.includes(interaction), `${namespace}.${interaction} is a declared interaction class`);
    }
  }
  assert.deepEqual(deliveryClassesFor('agent.started'), ['event', 'stream']);
  assert.equal(deliveryClassesFor('nonsense.thing'), null);
  // The words a transport would use are absent: no address, no socket, no endpoint.
  const described = JSON.stringify(describeAgentEvents());
  for (const forbidden of ['websocket', 'http', 'socket', 'url', 'queue']) {
    assert.equal(described.toLowerCase().includes(forbidden), false, `the delivery contract never names ${forbidden}`);
  }
});

test('a trace row is a closed shape: no payload, no reasoning, no credential', () => {
  const valid = { timestamp: 1, eventType: 'tool.completed', agentId: 'a1', status: 'success', durationMs: 840, summary: 'workflow.inspect', payloadRef: null, artifactRef: 'artifacts/run-1.json' };
  assert.equal(validateTraceEvent(valid).ok, true);

  const refusals = [
    [{ ...valid, payload: { any: 'thing' } }, /may never enter the trace/],
    [{ ...valid, messages: [] }, /may never enter the trace/],
    [{ ...valid, reasoning: 'because' }, /may never enter the trace/],
    [{ ...valid, token: 'x' }, /may never enter the trace/],
    [{ ...valid, note: 'hi' }, /unknown field "note"/],
    [{ ...valid, status: 'maybe' }, /"status" must be one of/],
    [{ ...valid, summary: 'x'.repeat(SUMMARY_LIMIT + 1) }, /over the 280-character limit/],
    [{ ...valid, durationMs: -1 }, /non-negative/],
    [{ ...valid, payloadRef: { nested: true } }, /must be a reference string or null/],
    [{ ...valid, eventType: 'agent.teleported' }, /not a declared agent event type/],
    [{ timestamp: 1, eventType: 'agent.started', status: 'running' }, /names the agent it is about/],
  ];
  for (const [event, pattern] of refusals) {
    const result = validateTraceEvent(event);
    assert.equal(result.ok, false, `${JSON.stringify(event).slice(0, 60)} is refused`);
    assert.match(result.errors.join(' '), pattern);
  }
  assert.equal(validateTraceEvent(null).ok, false);
});

test('a foreign runtime is mapped in, and an unmapped event is refused instead of dropped', () => {
  const normalizer = createEventNormalizer({
    runtimeId: 'some-cli',
    map: { task_begin: 'agent.started', task_end: 'agent.completed', tool_call: 'tool.requested', tool_done: 'tool.completed' },
    defaults: { sessionId: 's-1' },
  });
  assert.equal(normalizer.mappingSize, 4);
  const mapped = normalizer.normalise({ type: 'tool_done', agentId: 'a1', taskId: 't1', durationMs: 12, summary: 'workflow.inspect' });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.event.eventType, 'tool.completed');
  assert.equal(mapped.event.runtimeId, 'some-cli');
  assert.equal(mapped.event.sessionId, 's-1');
  assert.equal('type' in mapped.event, false, 'the product name is metadata about the mapping, not a trace field');

  const unmapped = normalizer.normalise({ type: 'mystery_event', agentId: 'a1' });
  assert.equal(unmapped.ok, false);
  assert.equal(unmapped.event, null);
  assert.match(unmapped.errors[0], /is not mapped by runtime "some-cli"/);

  // A mapping that targets an undeclared event is refused when the mapping is built.
  assert.throws(
    () => createEventNormalizer({ runtimeId: 'x', map: { a: 'agent.teleported' } }),
    (error) => {
      assert.ok(error instanceof AgentEventError);
      assert.equal(error.code, 'frontend.agent.invalid-event');
      return true;
    },
  );
  // The vocabulary itself never mentions a product.
  for (const vendor of ['hermes', 'claude', 'gemini', 'antigravity', 'openclaw', 'deepseek', 'mirofish', '9router', 'composio']) {
    assert.equal(JSON.stringify(describeAgentEvents()).toLowerCase().includes(vendor), false, `${vendor} is not part of the vocabulary`);
  }
});

test('the trace is a timeline: ordered by time, and refusing what it cannot validate', () => {
  const trace = createWorkTrace();
  trace.append(row({ timestamp: 30, eventType: 'agent.completed', agentId: 'a1', status: 'success' }));
  trace.append(row({ timestamp: 10, eventType: 'agent.created', agentId: 'a1', taskId: 't1' }));
  trace.append(row({ timestamp: 20, eventType: 'tool.completed', agentId: 'a1', durationMs: 840, summary: 'workflow.inspect' }));
  assert.deepEqual(trace.entries().map((entry) => entry.timestamp), [10, 20, 30], 'a late arrival lands where the timeline says');
  assert.deepEqual(trace.entries().map((entry) => entry.sequence), [2, 3, 1], 'and the sequence records arrival order');

  assert.throws(() => trace.append({ timestamp: 40, eventType: 'tool.completed', agentId: 'a1', payload: 'x' }), /may never enter the trace/);
  assert.equal(trace.stats().rejected, 1, 'a refused row is counted, not swallowed');
  assert.equal(trace.stats().rows, 3);
  assert.equal(trace.latest('a1').eventType, 'agent.completed');
});

test('the trace is bounded by declaration, and dropping is counted', () => {
  const trace = createWorkTrace({ limit: 3 });
  for (let index = 0; index < 6; index += 1) {
    trace.append(row({ timestamp: index, eventType: 'agent.waiting', agentId: 'a1' }));
  }
  assert.equal(trace.limit, 3);
  assert.deepEqual(trace.entries().map((entry) => entry.timestamp), [3, 4, 5], 'the newest rows survive');
  assert.deepEqual(trace.stats(), { rows: 3, limit: 3, dropped: 3, rejected: 0, sequence: 6 });
  assert.equal(TRACE_LIMIT, 200, 'the default bound is declared data');
  // No unbounded growth is reachable through the API: there is no method that only appends.
  assert.deepEqual(Object.keys(trace), ['limit', 'entries', 'stats', 'latest', 'append']);
});

test('the delegation tree records parentage and grants nothing through it', () => {
  const trace = createWorkTrace();
  trace.append(row({ timestamp: 1, eventType: 'agent.created', agentId: 'main', taskId: 't-1' }));
  trace.append(row({ timestamp: 2, eventType: 'agent.started', agentId: 'main' }));
  trace.append(row({ timestamp: 3, eventType: 'agent.delegated', agentId: 'main', summary: 'research' }));
  trace.append(row({ timestamp: 4, eventType: 'agent.created', agentId: 'research', parentAgentId: 'main', taskId: 't-1.1' }));
  trace.append(row({ timestamp: 5, eventType: 'agent.started', agentId: 'research' }));
  trace.append(row({ timestamp: 6, eventType: 'approval.requested', agentId: 'research', approvalState: 'pending' }));
  trace.append(row({ timestamp: 7, eventType: 'agent.completed', agentId: 'research' }));
  trace.append(row({ timestamp: 8, eventType: 'agent.failed', agentId: 'main' }));

  const tree = buildDelegationTree(trace.entries(), { grants: { main: ['agent:delegate', 'workflow:write'] }, sessions: { research: 's-2' } });
  assert.equal(tree.ok, true, JSON.stringify(tree.problems));
  assert.deepEqual(tree.roots, ['main']);
  const research = tree.nodes.find((node) => node.agentId === 'research');
  assert.equal(research.parentAgentId, 'main');
  assert.equal(research.depth, 1);
  assert.equal(research.taskId, 't-1.1');
  assert.equal(research.sessionId, 's-2');
  assert.equal(research.status, 'success', 'the last status-bearing event decides');
  assert.deepEqual(research.children, []);

  // The point of the whole test: authority does not flow down the tree.
  assert.deepEqual(research.grants, [], 'nothing was granted to the child');
  assert.deepEqual(research.effectivePermissions, [], 'and it holds exactly that');
  assert.equal(research.inherited, false);
  const main = tree.nodes.find((node) => node.agentId === 'main');
  assert.deepEqual(main.effectivePermissions, ['agent:delegate', 'workflow:write'], 'a node keeps its own grants');
  assert.equal(main.status, 'failure');
  assert.match(tree.rule, /never its parent/);
  for (const field of DELEGATION_FIELDS) assert.ok(field in research, `${field} is part of a delegation row`);
});

test('a cycle or an unknown parent is reported, never repaired silently', () => {
  const events = [
    row({ timestamp: 1, eventType: 'agent.created', agentId: 'a', parentAgentId: 'b' }),
    row({ timestamp: 2, eventType: 'agent.created', agentId: 'b', parentAgentId: 'a' }),
    row({ timestamp: 3, eventType: 'agent.created', agentId: 'orphan', parentAgentId: 'ghost' }),
  ];
  const tree = buildDelegationTree(events);
  assert.equal(tree.ok, false);
  assert.ok(tree.problems.some((problem) => /cycle/.test(problem)), tree.problems.join('; '));
  assert.ok(tree.problems.some((problem) => /ghost/.test(problem)), tree.problems.join('; '));
  assert.equal(tree.nodes.length, 3, 'the nodes are still reported, with the problem stated');
});

test('status is derived from events, and a terminal status is terminal', () => {
  const trace = createWorkTrace();
  trace.append(row({ timestamp: 1, eventType: 'agent.created', agentId: 'a1' }));
  assert.equal(trace.latest('a1').status, undefined);
  trace.append(row({ timestamp: 2, eventType: 'agent.started', agentId: 'a1' }));
  trace.append(row({ timestamp: 3, eventType: 'agent.paused', agentId: 'a1' }));
  const paused = buildDelegationTree(trace.entries()).nodes[0];
  assert.equal(paused.status, 'waiting');
  assert.equal(TERMINAL_STATUSES.includes(paused.status), false, 'waiting is not terminal');
  trace.append(row({ timestamp: 4, eventType: 'agent.cancelled', agentId: 'a1' }));
  assert.equal(buildDelegationTree(trace.entries()).nodes[0].status, 'cancelled');
  assert.deepEqual(TERMINAL_STATUSES, ['success', 'failure', 'cancelled', 'skipped']);
  assert.deepEqual(vocabularyOf('degradation').values.includes('cancelled'), false, 'a run status is not a degradation state');
});

test('an approval is a gate the trace records, not a permission it grants', () => {
  const trace = createWorkTrace();
  trace.append(row({ timestamp: 1, eventType: 'approval.requested', agentId: 'a1', approvalState: 'pending', decisionRef: 'dec-1' }));
  trace.append(row({ timestamp: 2, eventType: 'approval.granted', agentId: 'a1', approvalState: 'granted', decisionRef: 'dec-1' }));
  const rows = trace.entries();
  assert.equal(rows[0].approvalState, 'pending');
  assert.equal(rows[1].approvalState, 'granted');
  assert.equal(rows[1].decisionRef, 'dec-1');
  // An approval decision is referenced; it is never inlined into the timeline.
  assert.equal(TRACE_FIELDS.includes('decision'), false);
  assert.ok(TRACE_FIELDS.includes('decisionRef'));
  assert.equal(buildDelegationTree(rows).nodes[0].effectivePermissions.length, 0, 'being approved grants nothing by itself');
});

test('the assembly exposes the contract, and the contract stays out of the payload', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const contract = frontend.describeAgentEvents();
  assert.equal(contract.eventTypes.length, 26);
  assert.equal(contract.traceFields.length, TRACE_FIELDS.length);
  assert.equal(contract.limits.trace, TRACE_LIMIT);
  assert.deepEqual(contract.statuses, EVENT_STATUSES);
  assert.match(contract.rules.join(' '), /product/);
  assert.equal(frontend.describe().agentEventTypes, 26);
  assert.equal(JSON.stringify(frontend.bootPayload).includes('traceFields'), false);
  // Working traces are created by the UI layer, not by the boot descriptor.
  assert.equal(typeof createWorkTrace().append, 'function');
});
