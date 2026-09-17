import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	IMMEDIATE_COMMANDS,
	JOB_TYPE_NAME,
	MemoryExecutionRepository,
	MemoryJobQueue,
	MemoryPubSubBroker,
	MemoryWorkflowRepository,
	Publisher,
	QUEUE_NAME,
	QUEUE_RECOVERY_DEFAULTS,
	SELF_SEND_COMMANDS,
	ScalingService,
	Subscriber,
	UnexpectedError,
	JobProcessor,
	createQueueRuntime,
} from '../src/index.ts';

const makeWorker = (options = {}) => {
	const hostId = options.hostId ?? 'worker-1';
	const broker = new MemoryPubSubBroker();
	const executions = new MemoryExecutionRepository();
	const workflows = new MemoryWorkflowRepository();
	const events = [];
	const jobProcessor = new JobProcessor({
		hostId,
		executionRepository: executions,
		workflowRepository: workflows,
		eventService: {
			emit: (event, payload) => events.push([event, payload]),
			on: () => {},
			off: () => {},
		},
		runExecution: options.runExecution,
	});
	const scaling = new ScalingService({
		hostId,
		instanceType: options.instanceType ?? 'worker',
		broker,
		jobProcessor,
		executionRepository: executions,
		queueMetricsEnabled: false,
		eventService: {
			emit: (event, payload) => events.push([event, payload]),
			on: () => {},
			off: () => {},
		},
		statusFactory: () => ({ senderId: hostId, runningJobsSummary: [] }),
	});
	return { hostId, broker, executions, workflows, jobProcessor, scaling, events };
};

const seedExecution = (executions, workflows, overrides = {}) => {
	const execution = executions.seed({
		id: overrides.executionId ?? 'exec-1',
		workflowId: overrides.workflowId ?? 'wf-1',
		status: overrides.status ?? 'new',
		mode: 'trigger',
		workflowData: { id: 'wf-1', name: 'Workflow 1', staticData: {} },
	});
	workflows.seedStaticData('wf-1', { key: 'value' });
	return execution;
};

test('Q1/Q8 — queue name, job type and stalled-job policy', async () => {
	assert.equal(QUEUE_NAME, 'jobs');
	assert.equal(JOB_TYPE_NAME, 'job');

	const queue = new MemoryJobQueue(QUEUE_NAME);
	assert.equal(queue.settings.maxStalledCount, 0);
	assert.deepEqual(await queue.getJobCounts('active', 'waiting'), { active: 0, waiting: 0 });
});

test('Q9 — invalid job data is rejected before the execution is touched', async () => {
	const { scaling, executions, events } = makeWorker();
	await scaling.setupQueue();
	scaling.setupWorker(1);

	const queue = scaling.getQueue();
	const job = await queue.add(JOB_TYPE_NAME, { workflowId: 'wf-1' }, {});
	// the reference swallows the error inside the processor and reports it via job.progress,
	// so Bull still settles the job — the failure is visible on the bus, not by a throw
	assert.equal(job.status, 'completed');

	const failed = queue.emittedMessages.filter((msg) => msg.kind === 'job-failed');
	assert.equal(failed.length, 1);
	assert.equal(failed[0].errorMsg, 'Worker received invalid job');
	assert.equal(scaling.jobCounters.failed, 1);
	assert.ok(events.some(([name]) => name === 'job-dequeued'));
	assert.equal(executions.get('exec-1'), undefined);
});

test('Q10 — a crashed execution is skipped without running (success: false)', async () => {
	const { scaling, executions, workflows, jobProcessor } = makeWorker();
	await scaling.setupQueue();
	scaling.setupWorker(1);
	executions.seed({
		id: 'exec-crashed',
		workflowId: 'wf-1',
		status: 'crashed',
		mode: 'trigger',
		workflowData: { id: 'wf-1', name: 'Workflow 1', staticData: {} },
	});
	workflows.seedStaticData('wf-1', {});

	const result = await jobProcessor.processJob({
		id: '1',
		name: JOB_TYPE_NAME,
		data: { workflowId: 'wf-1', executionId: 'exec-crashed', loadStaticData: true },
		progress: async () => {},
	});

	assert.deepEqual(result, { success: false });
	assert.equal(executions.get('exec-crashed').status, 'crashed');
});

test('Q11 — missing execution raises the byte-exact reference error', async () => {
	const { jobProcessor } = makeWorker();
	await assert.rejects(
		() =>
			jobProcessor.processJob({
				id: '999',
				name: JOB_TYPE_NAME,
				data: { workflowId: 'wf-1', executionId: 'exec-missing', loadStaticData: false },
				progress: async () => {},
			}),
		(error) => {
			assert.ok(error instanceof UnexpectedError);
			assert.equal(
				error.message,
				'Worker failed to find data for execution exec-missing (job 999)',
			);
			return true;
		},
	);
});

test('Q4/Q11b — successful job emits a v2 job-finished message with the run props', async () => {
	const { scaling, executions, workflows, jobProcessor } = makeWorker({
		runExecution: async () => {
			const startedAt = new Date('2026-09-17T00:00:00Z');
			return {
				success: true,
				status: 'success',
				lastNodeExecuted: 'Set',
				startedAt,
				stoppedAt: new Date('2026-09-17T00:00:01Z'),
			};
		},
	});
	await scaling.setupQueue();
	scaling.setupWorker(1);
	seedExecution(executions, workflows);

	const job = await scaling
		.getQueue()
		.add(JOB_TYPE_NAME, { workflowId: 'wf-1', executionId: 'exec-1', loadStaticData: true }, {});

	assert.equal(job.status, 'completed');
	const finished = scaling.getQueue().emittedMessages.find((msg) => msg.kind === 'job-finished');
	assert.equal(finished.version, 2);
	assert.equal(finished.executionId, 'exec-1');
	assert.equal(finished.workerId, 'worker-1');
	assert.equal(finished.success, true);
	assert.equal(finished.status, 'success');
	assert.equal(finished.lastNodeExecuted, 'Set');
	assert.equal(executions.get('exec-1').status, 'success');
	assert.equal(scaling.jobCounters.completed, 1);
});

test('Q12 — queue recovery marks dangling executions crashed and halves the wait on a full batch', async () => {
	const { scaling, executions, workflows } = makeWorker();
	const recovery = { batchSize: 2, interval: 10 };
	const runtime = new ScalingService({
		hostId: 'main-1',
		instanceType: 'main',
		isLeader: true,
		jobProcessor: new JobProcessor({
			hostId: 'main-1',
			executionRepository: executions,
			workflowRepository: workflows,
		}),
		executionRepository: executions,
		recovery,
	});

	executions.seed({
		id: 'dangling-1',
		workflowId: 'wf-1',
		status: 'running',
		mode: 'trigger',
		workflowData: { id: 'wf-1', name: 'W', staticData: {} },
	});
	executions.seed({
		id: 'dangling-2',
		workflowId: 'wf-1',
		status: 'new',
		mode: 'trigger',
		workflowData: { id: 'wf-1', name: 'W', staticData: {} },
	});

	await runtime.setupQueue();
	const waitMs = await runtime.recoverFromQueue();
	assert.equal(waitMs, (recovery.interval * 60 * 1000) / 2);
	assert.equal(executions.get('dangling-1').status, 'crashed');
	assert.equal(executions.get('dangling-2').status, 'crashed');

	// an empty queue after recovery returns the regular interval again
	assert.equal(await runtime.recoverFromQueue(), recovery.interval * 60 * 1000);
	assert.deepEqual(QUEUE_RECOVERY_DEFAULTS, { batchSize: 5, intervalMinutes: 10 });
	assert.ok(scaling);
});

test('Q5/Q7 — pubsub: self-send, targets, debounce and worker responses', async () => {
	const broker = new MemoryPubSubBroker();
	const main = new Publisher({ hostId: 'main-1', instanceType: 'main', mode: 'queue', broker });
	const workerSubscriber = new Subscriber({ hostId: 'worker-1', mode: 'queue', broker, debounceMs: 5 });
	const mainSubscriber = new Subscriber({ hostId: 'main-1', mode: 'queue', broker, debounceMs: 5 });

	const seen = [];
	workerSubscriber.onCommand('add-webhooks-triggers-and-pollers', () => seen.push('immediate'));
	workerSubscriber.onCommand('reload-license', () => seen.push('debounced'));

	// 1. self-send commands come back to the sender, regular ones do not
	mainSubscriber.onCommand('add-webhooks-triggers-and-pollers', () => seen.push('main-self-send'));
	mainSubscriber.onCommand('reload-license', () => seen.push('main-foreign'));
	await main.publishCommand({ command: 'add-webhooks-triggers-and-pollers' });
	await main.publishCommand({ command: 'reload-license' });
	await mainSubscriber.drainDebounced();
	assert.deepEqual(seen, ['immediate', 'main-self-send']);

	// 2. debounce collapses repeated non-immediate commands into one delivery
	seen.length = 0;
	await main.publishCommand({ command: 'reload-license' });
	await main.publishCommand({ command: 'reload-license' });
	await main.publishCommand({ command: 'reload-license' });
	await workerSubscriber.drainDebounced();
	assert.deepEqual(seen, ['debounced']);

	// 3. targets restrict delivery
	seen.length = 0;
	await main.publishCommand({ command: 'reload-license', targets: ['main-1'] });
	await workerSubscriber.drainDebounced();
	assert.deepEqual(seen, []);

	// 4. worker responses are routed to the `response` handler
	const responses = [];
	mainSubscriber.onResponse('response-to-get-worker-status', (payload) => responses.push(payload));
	await main.publishWorkerResponse({
		senderId: 'worker-1',
		response: 'response-to-get-worker-status',
		payload: { senderId: 'worker-1', requestingUserId: 'user-7' },
	});
	assert.equal(responses.length, 1);
	assert.equal(responses[0].requestingUserId, 'user-7');

	// 5. the payload decorator is observable on the wire
	const raw = JSON.parse(broker.history.at(-1).payload);
	assert.equal(raw.senderId, 'worker-1');
	assert.equal(raw.response, 'response-to-get-worker-status');

	// 6. command sets stay consistent with the reference
	assert.ok(SELF_SEND_COMMANDS.has('add-webhooks-triggers-and-pollers'));
	assert.ok(!IMMEDIATE_COMMANDS.has('reload-license'));
	assert.ok(broker.subscriberCount >= 2);
});

test('Q5b/Q6 — publisher is inert outside queue mode and channels carry the redis prefix', async () => {
	const broker = new MemoryPubSubBroker();
	const publisher = new Publisher({
		hostId: 'main-1',
		instanceType: 'main',
		mode: 'regular',
		redisPrefix: 'tenant-a',
		broker,
	});
	assert.equal(publisher.commandChannel, 'tenant-a:n8n.commands');
	assert.equal(publisher.workerResponseChannel, 'tenant-a:n8n.worker-response');
	assert.equal(publisher.mcpRelayChannel, 'tenant-a:n8n.mcp-relay');

	await publisher.publishCommand({ command: 'reload-license' });
	assert.equal(broker.history.length, 0, 'regular mode must not publish');
});

test('Q13 — get-worker-status round trip pushes only to the requesting user', async () => {
	const broker = new MemoryPubSubBroker();
	const statusFactory = () => ({ senderId: 'worker-1', runningJobsSummary: [{ jobId: '1' }] });

	const workerRuntime = createQueueRuntime({ hostId: 'worker-1', broker });
	const workerScaling = new ScalingService({
		hostId: 'worker-1',
		instanceType: 'worker',
		broker,
		jobProcessor: workerRuntime.jobProcessor,
		statusFactory,
	});
	void workerScaling;

	const pushes = [];
	const mainPush = {
		sendToUsers: (msg, userIds) => pushes.push([msg, userIds]),
	};

	const mainSubscriber = new Subscriber({ hostId: 'main-1', mode: 'queue', broker });
	mainSubscriber.onResponse('response-to-get-worker-status', (payload) => {
		mainPush.sendToUsers(
			{ type: 'sendWorkerStatusMessage', data: { workerId: payload.senderId, status: payload } },
			[payload.requestingUserId],
		);
	});

	const mainPublisher = new Publisher({ hostId: 'main-1', instanceType: 'main', mode: 'queue', broker });
	await mainPublisher.publishCommand({
		command: 'get-worker-status',
		payload: { requestingUserId: 'user-7' },
	});

	// `get-worker-status` is not in IMMEDIATE_COMMANDS → the worker debounces it
	await workerScaling.subscriber.drainDebounced();

	assert.equal(pushes.length, 1);
	assert.equal(pushes[0][0].type, 'sendWorkerStatusMessage');
	assert.equal(pushes[0][0].data.workerId, 'worker-1');
	assert.deepEqual(pushes[0][1], ['user-7']);
});

test('Q14 — queue metrics emit job-counts-updated and reset the counters', async () => {
	const { scaling, executions, workflows } = makeWorker();
	const emitted = [];
	const runtime = new ScalingService({
		hostId: 'worker-1',
		instanceType: 'worker',
		jobProcessor: new JobProcessor({
			hostId: 'worker-1',
			executionRepository: executions,
			workflowRepository: workflows,
			runExecution: async () => {
				const now = new Date();
				return { success: true, status: 'success', startedAt: now, stoppedAt: now };
			},
		}),
		executionRepository: executions,
		queueMetricsEnabled: true,
		eventService: { emit: (event, payload) => emitted.push([event, payload]), on: () => {}, off: () => {} },
	});

	await runtime.setupQueue();
	runtime.setupWorker(1);
	seedExecution(executions, workflows);
	await runtime.getQueue().add(JOB_TYPE_NAME, { workflowId: 'wf-1', executionId: 'exec-1', loadStaticData: true }, {});
	assert.equal(runtime.jobCounters.completed, 1);

	await runtime.getPendingJobCounts();
	await new Promise((resolve) => setTimeout(resolve, 1100));
	runtime.stopQueueMetrics();

	const metrics = emitted.filter(([event]) => event === 'job-counts-updated');
	assert.ok(metrics.length >= 1, 'job-counts-updated must be emitted');
	assert.equal(metrics[0][1].completed, 1);
	assert.equal(runtime.jobCounters.completed, 0, 'counters reset after the tick');
	assert.ok(scaling);
});
