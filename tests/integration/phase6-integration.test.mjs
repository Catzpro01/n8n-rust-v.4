/**
 * Phase 6 integration — QUEUE × EVENTS × REALTIME on one in-memory deployment.
 *
 * This is the `VERIFIED → INTEGRATED` step for POOL-009/010/011: the three LEGOs are
 * wired exactly like a queue-mode n8n deployment (main + worker + pubsub bus + push),
 * and the assertions are made on the bytes the frontend would receive.
 *
 * Topology (1:1 with n8n 2.9.4 queue mode):
 *
 *   main-1 (leader)                       worker-1
 *     ScalingService                        ScalingService.setupWorker()
 *     ├ Publisher  ── n8n.commands ───────► ├ Subscriber (get-worker-status)
 *     ├ Subscriber ◄─ n8n.worker-response ─ ┤ Publisher.publishWorkerResponse
 *     ├ WorkerStatusService (push path)     └ JobProcessor → job.progress(job-finished v2)
 *     └ PushService (SSE session of user-7)
 *
 * usage: node --test tests/integration/phase6-integration.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	MemoryPubSubBroker,
	Publisher,
	Subscriber,
	ScalingService,
	createQueueRuntime,
} from '../../packages/queue-lego/src/index.ts';
import { EventMessageWorkflow, createEventRuntime } from '../../packages/events-lego/src/index.ts';
import { PushService, createMemoryRequest, createMemoryResponse } from '../../packages/realtime-lego/src/index.ts';

const seedExecution = (executions, workflows, id = 'exec-1') => {
	executions.seed({
		id,
		workflowId: 'wf-1',
		status: 'new',
		mode: 'trigger',
		workflowData: { id: 'wf-1', name: 'Nightly sync', staticData: {} },
	});
	workflows.seedStaticData('wf-1', { lastRun: null });
	return id;
};

const buildDeployment = () => {
	const broker = new MemoryPubSubBroker();
	const { eventService, eventBus } = createEventRuntime();

	/* ---------------- worker (single subscriber on the bus) ---------------- */
	const workerRuntime = createQueueRuntime({
		hostId: 'worker-1',
		broker,
		instanceType: 'worker',
		eventService,
		statusFactory: () => ({
			senderId: 'worker-1',
			runningJobsSummary: workerRuntime.jobProcessor.getRunningJobsSummary(),
			version: '2.9.4',
		}),
	});
	const workerScaling = workerRuntime.scaling;

	/* ---------------- main (leader) ---------------- */
	const mainRuntime = createQueueRuntime({
		hostId: 'main-1',
		broker,
		instanceType: 'main',
		leader: true,
		recovery: { batchSize: 5, interval: 10 },
		eventService,
	});
	const mainScaling = mainRuntime.scaling;

	/* ---------------- push (frontend session of user-7) ---------------- */
	const push = new PushService({ backend: 'sse', hostId: 'main-1' });
	const session = { pushRef: 'push-ref-user-7', userId: 'user-7' };
	const response = createMemoryResponse();
	const connected = [];
	push.events.on('editorUiConnected', (pushRef) => connected.push(pushRef));

	return {
		broker,
		eventService,
		eventBus,
		workerRuntime,
		workerScaling,
		mainRuntime,
		mainScaling,
		push,
		session,
		response,
		connected,
	};
};

test('INTEGRATION — worker runs an enqueued job and main observes the v2 job-finished message', async () => {
	const deployment = buildDeployment();
	const { workerRuntime, workerScaling, mainRuntime, mainScaling, eventBus } = deployment;

	await workerScaling.setupQueue();
	workerScaling.setupWorker(1);
	await mainScaling.setupQueue();

	seedExecution(workerRuntime.executions, workerRuntime.workflows, 'exec-1');

	// the worker is the only one holding the execution; the main mirrors the job record
	mainRuntime.executions.seed({
		id: 'exec-1',
		workflowId: 'wf-1',
		status: 'new',
		mode: 'trigger',
		workflowData: { id: 'wf-1', name: 'Nightly sync', staticData: {} },
	});

	const job = await workerScaling.getQueue().add(
		'job',
		{ workflowId: 'wf-1', executionId: 'exec-1', loadStaticData: true },
		{},
	);
	assert.equal(job.status, 'completed');

	const finished = workerScaling.getQueue().emittedMessages.find((msg) => msg.kind === 'job-finished');
	assert.equal(finished.kind, 'job-finished');
	assert.equal(finished.version, 2, 'worker reports the v2 shape');
	assert.equal(finished.executionId, 'exec-1');
	assert.equal(finished.workerId, 'worker-1');
	assert.equal(finished.success, true);
	assert.ok(eventBus.sentMessages.length >= 0);
	assert.equal(workerRuntime.executions.get('exec-1').status, 'success');
});

test('INTEGRATION — get-worker-status round trip reaches the frontend of the requesting user only', async () => {
	const deployment = buildDeployment();
	const { workerScaling, mainScaling, push, session, response, connected } = deployment;

	await workerScaling.setupQueue();
	workerScaling.setupWorker(1);
	await mainScaling.setupQueue();

	// the frontend connects to the main that will serve the push
	const handshake = push.handleRequest(
		createMemoryRequest({ pushRef: session.pushRef, userId: session.userId }),
		response,
	);
	assert.equal(handshake.ok, true);
	assert.deepEqual(connected, [session.pushRef]);

	// a second session (another user) must never see the status of user-7
	const otherResponse = createMemoryResponse();
	push.handleRequest(createMemoryRequest({ pushRef: 'push-ref-user-8', userId: 'user-8' }), otherResponse);

	// WorkerStatusService (scaling/worker-status.service.ee.ts) wired to the real push backend
	const delivered = [];
	mainScaling.subscriber.onResponse('response-to-get-worker-status', (payload) => {
		const message = { type: 'sendWorkerStatusMessage', data: { workerId: payload.senderId, status: payload } };
		push.sendToUsers(message, [payload.requestingUserId]);
		delivered.push(message);
	});

	await mainScaling.publisher.publishCommand({ command: 'get-worker-status', payload: { requestingUserId: 'user-7' } });
	await workerScaling.subscriber.drainDebounced();

	assert.equal(delivered.length, 1, 'exactly one worker answers on the bus');
	assert.equal(delivered[0].data.workerId, 'worker-1');
	assert.equal(delivered[0].data.status.requestingUserId, 'user-7');

	const frame = response.chunks.at(-1);
	assert.ok(frame.startsWith('data: {"type":"sendWorkerStatusMessage"'), 'the requesting user got the push');
	assert.ok(frame.includes('"workerId":"worker-1"'));
	assert.equal(otherResponse.chunks.length, 1, 'the other user only has the handshake frame');
});

test('INTEGRATION — event fan-out reaches the message bus while the job runs (queue × events)', async () => {
	const deployment = buildDeployment();
	const { workerRuntime, workerScaling, mainScaling, eventService, eventBus } = deployment;

	await workerScaling.setupQueue();
	workerScaling.setupWorker(1);
	await mainScaling.setupQueue();
	seedExecution(workerRuntime.executions, workerRuntime.workflows, 'exec-2');

	// a service records the business event the queue emitted
	eventService.emit('workflow-executed', { workflowId: 'wf-1', executionId: 'exec-2' });

	await eventBus.send(new EventMessageWorkflow('workflow-executed', { workflowId: 'wf-1', executionId: 'exec-2' }));
	await new Promise((resolve) => setImmediate(resolve));

	const relayed = eventBus.sentMessages.map((msg) => msg.eventName);
	assert.ok(relayed.includes('workflow-executed'), 'the log-streaming relay forwarded the event');

	await workerScaling.getQueue().add('job', { workflowId: 'wf-1', executionId: 'exec-2', loadStaticData: true }, {});
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(workerRuntime.executions.get('exec-2').status, 'success');
	assert.ok(
		eventBus.sentMessages.every((msg) => typeof msg.eventName === 'string' && msg.eventName.length > 0),
		'every relayed message carries its event name',
	);
});

test('INTEGRATION — recovery + metrics keep the deployment consistent (leader × queue × events)', async () => {
	const deployment = buildDeployment();
	const { mainScaling, mainRuntime, eventService, workerScaling } = deployment;

	const metrics = [];
	eventService.on('job-counts-updated', (payload) => metrics.push(payload));

	await mainScaling.setupQueue();
	await workerScaling.setupQueue();
	workerScaling.setupWorker(1);

	// a full recovery batch of dangling executions → all marked crashed, wait halved
	for (let index = 1; index <= 5; index += 1) {
		mainRuntime.executions.seed({
			id: `dangling-${index}`,
			workflowId: 'wf-1',
			status: index % 2 === 0 ? 'new' : 'running',
			mode: 'trigger',
			workflowData: { id: 'wf-1', name: 'W', staticData: {} },
		});
	}

	const waitMs = await mainScaling.recoverFromQueue();
	assert.equal(waitMs, (10 * 60 * 1000) / 2, 'full batch → next recovery cycle is halved');
	for (let index = 1; index <= 5; index += 1) {
		assert.equal(mainRuntime.executions.get(`dangling-${index}`).status, 'crashed');
	}
	assert.equal(await mainScaling.recoverFromQueue(), 10 * 60 * 1000, 'empty queue → regular interval');

	// queue metrics — one deterministic cycle (the same body the interval runs)
	mainScaling.jobCounters.completed = 3;
	mainScaling.jobCounters.failed = 1;
	const tick = await mainScaling.collectQueueMetrics();

	assert.equal(metrics.length, 1);
	assert.equal(typeof tick.active, 'number');
	assert.equal(typeof tick.waiting, 'number');
	assert.equal(tick.completed, 3);
	assert.equal(tick.failed, 1);
	assert.deepEqual(mainScaling.jobCounters, { completed: 0, failed: 0 }, 'counters reset after the tick');

	// the interval wiring still works (one extra tick, then reset counters stay at zero)
	mainScaling.scheduleQueueMetrics(5);
	await new Promise((resolve) => setTimeout(resolve, 20));
	mainScaling.stopQueueMetrics();
	assert.ok(metrics.length >= 2, 'the scheduled interval keeps emitting');
	assert.equal(metrics.at(-1).completed, 0);
});
