import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	AI_EVENT_NAMES,
	EventMessageAudit,
	EventMessageWorkflow,
	EventService,
	LogStreamingEventRelay,
	MessageEventBus,
	QUEUE_METRICS_EVENT_NAMES,
	RELAY_EVENT_NAMES,
	WorkflowFailureNotificationEventRelay,
	classifyEventName,
	createEventRuntime,
} from '../src/index.ts';

test('E2/E10 — EventService emits synchronously and carries the session payload', () => {
	const service = new EventService();
	const seen = [];
	service.on('session-started', (payload) => seen.push(payload));

	service.sessionStarted('push-ref-1');
	// the reference controller returns void — emission itself is synchronous
	assert.deepEqual(seen, [{ pushRef: 'push-ref-1' }]);
	assert.equal(service.listenerCount('session-started'), 1);

	const handler = (payload) => seen.push(payload);
	service.on('workflow-saved', handler);
	service.emit('workflow-saved', { workflowId: 'wf-1' });
	service.off('workflow-saved', handler);
	service.emit('workflow-saved', { workflowId: 'wf-2' });
	assert.equal(seen.length, 2);
});

test('E3 — event message envelope keeps __type/eventName/payload.__type/id/ts', () => {
	const msg = new EventMessageWorkflow('workflow-saved', { workflowId: 'wf-1' });
	msg.id = 'msg-1';

	const json = msg.toJSON();
	assert.equal(json.__type, 'workflow');
	assert.equal(json.eventName, 'workflow-saved');
	assert.deepEqual(json.payload, { __type: 'workflow-saved', workflowId: 'wf-1' });
	assert.equal(json.id, 'msg-1');
	assert.ok(typeof json.ts === 'string' && !Number.isNaN(Date.parse(json.ts)));

	const audit = new EventMessageAudit('user-logged-in', { userId: 'u1' });
	assert.equal(audit.toJSON().__type, 'audit');
});

test('E4/E5/E6 — bus fans out to enabled destinations and retries unconfirmed messages', async () => {
	const delivered = [];
	const bus = new MessageEventBus({
		managedByInstance: false,
		retryWaitMs: 5,
		destinations: [
			{ id: 'on', type: 'webhook', enabled: true, sendMessage: (msg) => delivered.push(msg.eventName) },
			{ id: 'off', type: 'syslog', enabled: false, sendMessage: () => delivered.push('disabled') },
		],
	});

	const msg = new EventMessageWorkflow('workflow-created', { workflowId: 'wf-9' });
	await bus.send(msg);

	assert.deepEqual(delivered, ['workflow-created']);
	assert.ok(msg.id, 'an id is assigned when the message has none');
	assert.equal(Object.keys(bus.unconfirmedMessages).length, 1);

	await bus.processRetryQueue();
	assert.equal(bus.unconfirmedMessages[msg.id].waitMs, 10, 'waitMs grows by retryWaitMs');

	bus.confirmSent(msg);
	assert.equal(Object.keys(bus.unconfirmedMessages).length, 0, 'confirmSent clears the queue');

	delivered.length = 0;
	await bus.send([new EventMessageWorkflow('workflow-deleted'), new EventMessageWorkflow('workflow-archived')]);
	assert.deepEqual(delivered, ['workflow-deleted', 'workflow-archived']);
	await bus.close();
});

test('E11 — the log writer receives messages only when the instance manages streaming', async () => {
	const stored = [];
	const writer = { storeMessage: (msg) => stored.push(msg.eventName), fetchMessages: () => stored };

	const managed = new MessageEventBus({ managedByInstance: true, writer, destinations: [] });
	await managed.send(new EventMessageWorkflow('workflow-saved'));
	assert.deepEqual(stored, ['workflow-saved']);

	const unmanaged = new MessageEventBus({ managedByInstance: false, writer, destinations: [] });
	await unmanaged.send(new EventMessageWorkflow('workflow-saved'));
	assert.deepEqual(stored, ['workflow-saved'], 'unmanaged bus must not write logs itself');

	await managed.close();
	await unmanaged.close();
});

test('E7/E8 — the log-streaming relay subscribes to every catalogue name and classifies messages', async () => {
	const { eventService, eventBus, logStreaming } = createEventRuntime();

	const total = RELAY_EVENT_NAMES.length + QUEUE_METRICS_EVENT_NAMES.length + AI_EVENT_NAMES.length;
	assert.equal(logStreaming.subscriptionCount, total);

	eventService.emit('workflow-executed', { workflowId: 'wf-1' });
	eventService.emit('node-post-execute', { nodeName: 'Set' });
	eventService.emit('execution-cancelled', { executionId: 'e-1' });
	eventService.emit('job-dequeued', { jobId: '1' });
	eventService.emit('user-logged-in', { userId: 'u-1' });
	eventService.emit('ai-tool-called', { msg: 'tool' });
	eventService.emit('server-started', {});

	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(eventBus.sentMessages.length, 7);
	assert.deepEqual(
		eventBus.sentMessages.map((msg) => msg.eventName),
		[
			'workflow-executed',
			'node-post-execute',
			'execution-cancelled',
			'job-dequeued',
			'user-logged-in',
			'ai-tool-called',
			'server-started',
		],
	);

	assert.equal(classifyEventName('workflow-executed'), 'workflow');
	assert.equal(classifyEventName('node-post-execute'), 'node');
	assert.equal(classifyEventName('execution-cancelled'), 'execution');
	assert.equal(classifyEventName('job-dequeued'), 'queue');
	assert.equal(classifyEventName('user-logged-in'), 'audit');
	assert.equal(classifyEventName('ai-tool-called'), 'ai-node');
	assert.equal(classifyEventName('server-started'), 'generic');
	await eventBus.close();
});

test('E9 — workflow-post-execute failures raise exactly one notification per failure', () => {
	const { eventService, failureNotifications } = createEventRuntime();

	eventService.emit('workflow-post-execute', { workflow: { id: 'wf-1' }, execution: { status: 'success' } });
	assert.equal(failureNotifications.notifications.length, 0);

	eventService.emit('workflow-post-execute', { workflow: { id: 'wf-2' }, execution: { status: 'error' } });
	eventService.emit('workflow-post-execute', { workflow: { id: 'wf-3' }, execution: { status: 'crashed' } });

	assert.deepEqual(
		failureNotifications.notifications.map((notification) => notification.workflowId),
		['wf-2', 'wf-3'],
	);
	assert.ok(failureNotifications.notifications.every((notification) => notification.type === 'error'));
});

test('E4b — helper senders map to the right message classes', async () => {
	const bus = new MessageEventBus({ managedByInstance: false });
	await bus.sendAuditEvent({ eventName: 'user-logged-in', userId: 'u1' });
	await bus.sendWorkflowEvent({ eventName: 'workflow-saved', workflowId: 'wf-1' });
	await bus.sendNodeEvent({ eventName: 'node-post-execute', nodeName: 'Set' });
	await bus.sendExecutionEvent({ eventName: 'execution-cancelled', executionId: 'e-1' });
	await bus.sendQueueEvent({ eventName: 'job-dequeued', jobId: '1' });
	await bus.sendAiNodeEvent({ eventName: 'ai-tool-called', nodeName: 'Tool' });
	await bus.sendRunnerEvent({ eventName: 'runner-task-requested', taskId: 't-1' });

	assert.deepEqual(
		bus.sentMessages.map((msg) => msg.__type),
		['audit', 'workflow', 'node', 'execution', 'queue', 'generic', 'generic'],
	);
	assert.ok(bus.sentMessages.every((msg) => msg.payload.__type === msg.eventName));
	await bus.close();
});
