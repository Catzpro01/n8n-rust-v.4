/**
 * ExecutionRecoveryService — recovers truncated/crashed executions from event logs
 * and auto-deactivates perpetually crashing workflows.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/executions/execution-recovery.service.ts
 */

import { NodeCrashedError, WorkflowCrashedError } from './errors.mjs';
import { ExecutionLifecycleHooks } from './lifecycle-hooks.mjs';
import { sleep } from './retry.mjs';
import { createEmptyRunExecutionData } from './run-execution-data.mjs';

export const ARTIFICIAL_TASK_DATA = Object.freeze({
	main: [
		[
			{
				json: { isArtificialRecoveredEventItem: true },
				pairedItem: undefined,
			},
		],
	],
});

export class ExecutionRecoveryService {
	constructor(logger, ...rest) {
		this.logger = logger ?? { debug() {}, info() {}, warn() {}, error() {} };

		let instanceSettings;
		let push;
		let executionRepository;
		let executionsConfig;
		let workflowRepository;
		let userManagementMailer;
		let ownershipService;
		let projectRelationRepository;
		let lifecycleHooksFactory;
		let sleepFn;

		if (
			rest.length === 1 &&
			rest[0] &&
			typeof rest[0] === 'object' &&
			('executionRepository' in rest[0] ||
				'workflowRepository' in rest[0] ||
				'executionsConfig' in rest[0] ||
				'instanceSettings' in rest[0])
		) {
			const opts = rest[0];
			instanceSettings = opts.instanceSettings;
			push = opts.push;
			executionRepository = opts.executionRepository;
			executionsConfig = opts.executionsConfig;
			workflowRepository = opts.workflowRepository;
			userManagementMailer = opts.userManagementMailer;
			ownershipService = opts.ownershipService;
			projectRelationRepository = opts.projectRelationRepository;
			lifecycleHooksFactory = opts.lifecycleHooksFactory;
			sleepFn = opts.sleep;
		} else {
			[
				instanceSettings,
				push,
				executionRepository,
				executionsConfig,
				workflowRepository,
				userManagementMailer,
				ownershipService,
				projectRelationRepository,
				lifecycleHooksFactory,
				sleepFn,
			] = rest;
		}

		this.sleep = sleepFn ?? sleep;

		this.instanceSettings = instanceSettings ?? { isFollower: false };
		this.push = push ?? { once() {}, broadcast() {} };
		this.executionRepository = executionRepository ?? {
			async findSingleExecution() {
				return null;
			},
			async findMultipleExecutions() {
				return [];
			},
			async updateExistingExecution() {
				return true;
			},
			async markAsCrashed() {},
			async update() {},
			async exists() {
				return false;
			},
		};
		this.executionsConfig = executionsConfig ?? {
			recovery: { maxLastExecutions: 3, workflowDeactivationEnabled: false },
		};
		this.workflowRepository = workflowRepository ?? {
			async findOne() {
				return null;
			},
			async updateActiveState() {},
		};
		this.userManagementMailer = userManagementMailer ?? {
			async notifyWorkflowAutodeactivated() {},
		};
		this.ownershipService = ownershipService ?? {
			async getWorkflowProjectCached() {
				return { id: 'default', type: 'personal' };
			},
			async getInstanceOwner() {
				return { id: 'owner', email: 'owner@example.com' };
			},
		};
		this.projectRelationRepository = projectRelationRepository ?? {
			async find() {
				return [];
			},
		};
		this.lifecycleHooksFactory = lifecycleHooksFactory;
	}

	async autoDeactivateWorkflowsIfNeeded(workflowIds) {
		for (const workflowId of workflowIds ?? []) {
			const maxLastExecutions = this.executionsConfig.recovery?.maxLastExecutions ?? 3;
			const lastExecutions = await this.executionRepository.findMultipleExecutions({
				select: ['id', 'status'],
				where: { workflowId },
				order: { startedAt: 'DESC' },
				take: maxLastExecutions,
			});
			const numberOfCrashedExecutions = (lastExecutions ?? []).filter(
				(e) => e.status === 'crashed',
			).length;

			// If all of the last N executions are crashed, deactivate the workflow
			if (
				(lastExecutions ?? []).length >= maxLastExecutions &&
				lastExecutions.length === numberOfCrashedExecutions
			) {
				const workflow = await this.workflowRepository.findOne({ where: { id: workflowId } });

				if (!workflow) {
					this.logger.warn(`Workflow ${workflowId} not found, skipping workflow auto-deactivation`);
					continue;
				}

				if (workflow.activeVersionId !== null && workflow.active !== false) {
					await this.workflowRepository.updateActiveState(workflowId, false);
					this.logger.warn(
						`Autodeactivated workflow ${workflowId} due to too many crashed executions.`,
					);

					const recipient = await this.getAutodeactivationRecipient(workflow);
					await this.userManagementMailer.notifyWorkflowAutodeactivated({
						recipient,
						workflow,
					});

					this.push.once?.('editorUiConnected', async () => {
						await this.sleep(1000);
						this.push.broadcast?.({ type: 'workflowAutoDeactivated', data: { workflowId } });
					});
				}

				await this.executionRepository.update(
					{ workflowId, status: ['running', 'new'] },
					{ status: 'crashed', stoppedAt: new Date() },
				);
			}
		}
	}

	async recoverFromLogs(executionId, messages = []) {
		if (this.instanceSettings.isFollower) return null;

		const amendedExecution = await this.amend(executionId, messages);

		if (!amendedExecution) return null;

		this.logger.info('[Recovery] Logs available, amended execution', {
			executionId: amendedExecution.id,
		});

		await this.executionRepository.updateExistingExecution(executionId, amendedExecution);

		await this.runHooks(amendedExecution);

		this.push.once?.('editorUiConnected', async () => {
			await this.sleep(1000);
			this.push.broadcast?.({ type: 'executionRecovered', data: { executionId } });
		});

		return amendedExecution;
	}

	async amend(executionId, messages = []) {
		if (messages.length === 0) return await this.amendWithoutLogs(executionId);

		const { nodeMessages, workflowMessages } = this.toRelevantMessages(messages);

		if (nodeMessages.length === 0) return null;

		const execution = await this.executionRepository.findSingleExecution(executionId, {
			includeData: true,
			unflattenData: true,
		});

		if (
			!execution ||
			(['success', 'error', 'canceled'].includes(execution.status) && execution.data)
		) {
			return null;
		}

		const runExecutionData = execution.data ?? { resultData: { runData: {} } };
		let lastNodeRunTimestamp = undefined;

		const nodes = execution.workflowData?.nodes ?? [];
		for (const node of nodes) {
			const nodeStartedMessage = nodeMessages.find(
				(m) => m.payload?.nodeName === node.name && m.eventName === 'n8n.node.started',
			);

			if (!nodeStartedMessage) continue;

			const nodeHasRunData = runExecutionData.resultData.runData[node.name] !== undefined;
			if (nodeHasRunData) continue;

			const nodeFinishedMessage = nodeMessages.find(
				(m) => m.payload?.nodeName === node.name && m.eventName === 'n8n.node.finished',
			);

			const startTime =
				nodeStartedMessage.ts instanceof Date
					? nodeStartedMessage.ts.getTime()
					: typeof nodeStartedMessage.ts?.toMillis === 'function'
						? nodeStartedMessage.ts.toMillis()
						: typeof nodeStartedMessage.ts?.toUnixInteger === 'function'
							? nodeStartedMessage.ts.toUnixInteger()
							: Number(nodeStartedMessage.ts ?? Date.now());

			const taskData = {
				startTime,
				executionIndex: 0,
				executionTime: -1,
				source: [null],
			};

			if (nodeFinishedMessage) {
				const finishTime =
					nodeFinishedMessage.ts instanceof Date
						? nodeFinishedMessage.ts.getTime()
						: typeof nodeFinishedMessage.ts?.toMillis === 'function'
							? nodeFinishedMessage.ts.toMillis()
							: Number(nodeFinishedMessage.ts ?? startTime);

				const executionTime =
					typeof nodeFinishedMessage.ts?.diff === 'function' &&
					typeof nodeStartedMessage.ts !== 'undefined'
						? nodeFinishedMessage.ts.diff(nodeStartedMessage.ts).toMillis()
						: finishTime - startTime;

				taskData.executionStatus = 'success';
				taskData.data ??= ARTIFICIAL_TASK_DATA;
				taskData.executionTime = executionTime;
				lastNodeRunTimestamp = nodeFinishedMessage.ts;
			} else {
				taskData.executionStatus = 'crashed';
				taskData.error = new NodeCrashedError(node);
				taskData.executionTime = 0;
				runExecutionData.resultData.error = new WorkflowCrashedError();
				lastNodeRunTimestamp = nodeStartedMessage.ts;
			}

			runExecutionData.resultData.lastNodeExecuted = node.name;
			runExecutionData.resultData.runData[node.name] = [taskData];
		}

		return {
			...execution,
			status: execution.status === 'error' ? 'error' : 'crashed',
			stoppedAt: this.toStoppedAt(lastNodeRunTimestamp, workflowMessages),
			data: runExecutionData,
		};
	}

	async amendWithoutLogs(executionId) {
		const exists = await this.executionRepository.exists({ where: { id: executionId } });
		if (!exists) return null;

		await this.executionRepository.markAsCrashed(executionId);

		const execution = await this.executionRepository.findSingleExecution(executionId, {
			includeData: true,
			unflattenData: true,
		});

		return execution ?? null;
	}

	toRelevantMessages(messages = []) {
		return messages.reduce(
			(acc, cur) => {
				if (cur?.eventName?.startsWith?.('n8n.node.')) {
					acc.nodeMessages.push(cur);
				} else if (cur?.eventName?.startsWith?.('n8n.workflow.')) {
					acc.workflowMessages.push(cur);
				}
				return acc;
			},
			{ nodeMessages: [], workflowMessages: [] },
		);
	}

	toStoppedAt(timestamp, messages = []) {
		if (timestamp) {
			return timestamp instanceof Date
				? timestamp
				: typeof timestamp?.toJSDate === 'function'
					? timestamp.toJSDate()
					: new Date(timestamp);
		}

		const WORKFLOW_END_EVENTS = new Set([
			'n8n.workflow.success',
			'n8n.workflow.crashed',
			'n8n.workflow.failed',
		]);

		const endMsg =
			messages.find((m) => WORKFLOW_END_EVENTS.has(m.eventName)) ??
			messages.find((m) => m.eventName === 'n8n.workflow.started');

		if (endMsg?.ts) {
			return endMsg.ts instanceof Date
				? endMsg.ts
				: typeof endMsg.ts?.toJSDate === 'function'
					? endMsg.ts.toJSDate()
					: new Date(endMsg.ts);
		}

		return new Date();
	}

	async runHooks(execution) {
		execution.data ??= createEmptyRunExecutionData();

		const hooks =
			this.lifecycleHooksFactory?.(execution) ??
			new ExecutionLifecycleHooks(
				execution.mode ?? 'manual',
				execution.id,
				execution.workflowData ?? {},
			);

		const run = {
			data: execution.data,
			finished: false,
			mode: execution.mode ?? 'manual',
			waitTill: execution.waitTill ?? undefined,
			startedAt: execution.startedAt,
			stoppedAt: execution.stoppedAt,
			status: execution.status,
			storedAt: execution.storedAt,
		};

		await hooks.runHook('workflowExecuteAfter', [run]);
	}

	async getAutodeactivationRecipient(workflow) {
		const project = await this.ownershipService.getWorkflowProjectCached(workflow?.id);
		const roleSlug = project?.type === 'team' ? 'admin' : 'owner';
		const projectRelations = await this.projectRelationRepository.find({
			where: {
				projectId: project?.id,
				role: { slug: roleSlug },
			},
			relations: { user: true },
		});

		if (projectRelations?.length > 0) {
			return projectRelations[0].user;
		}
		return await this.ownershipService.getInstanceOwner();
	}
}
