/**
 * EXECUTION LEGO — port surface.
 *
 * The surface is a *frozen list of what other LEGOs may consume*. Anything not listed here is
 * internal to the execution runtime (docs/isolation/execution.md §2).
 *
 * Provenance is enforced: `packages/execution-lego/test/01-boundary.test.mjs` and
 * `tools/phase7-isolation-gate.mjs` re-read the reference source and fail when a symbol below
 * stops matching n8n 2.9.4.
 */

export const EXECUTION_REFERENCE = {
	package: 'n8n (cli + core)',
	upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	version: '2.9.4',
	files: [
		'packages/cli/src/active-executions.ts',
		'packages/cli/src/active-workflow-manager.ts',
		'packages/cli/src/executions/execution-recovery.service.ts',
		'packages/cli/src/errors/execution-not-found-error.ts',
		'packages/cli/src/errors/execution-already-resuming.error.ts',
		'packages/cli/src/errors/node-crashed.error.ts',
		'packages/cli/src/errors/workflow-crashed.error.ts',
		'packages/cli/src/constants.ts',
		'packages/core/src/execution-engine/active-workflows.ts',
		'packages/core/src/execution-engine/execution-context.service.ts',
		'packages/core/src/execution-engine/execution-context-hook-registry.service.ts',
		'packages/workflow/src/errors/execution-cancelled.error.ts',
		'packages/workflow/src/errors/trigger-close.error.ts',
		'packages/workflow/src/errors/workflow-activation.error.ts',
		'packages/@n8n/config/src/configs/executions.config.ts',
	],
} as const;

/** Ports consumed from other LEGOs (declared, never hidden). */
export const EXECUTION_CONSUMED_PORTS = [
	{ port: '@lego/persistence', symbols: ['ExecutionRepository', 'ExecutionPersistence', 'WorkflowRepository'], kind: 'value' },
	{ port: '@lego/queue', symbols: ['JobProcessor.runExecution'], kind: 'seam' },
	{ port: '@lego/events', symbols: ['EventService'], kind: 'value' },
	{ port: '@lego/realtime', symbols: ['Push.broadcast', 'Push.once'], kind: 'value' },
	{ port: '@lego/connection', symbols: ['ConcurrencyControlService'], kind: 'value' },
] as const;

/** Ports provided to other LEGOs. */
export const EXECUTION_PROVIDED_PORTS = [
	{ port: 'P-EXECUTION-REGISTRY', symbols: ['ActiveExecutions', 'MemoryExecutionRepository'] },
	{ port: 'P-EXECUTION-ACTIVATION', symbols: ['ActiveWorkflows'] },
	{ port: 'P-EXECUTION-CONTEXT', symbols: ['ExecutionContextService', 'ExecutionContextHookRegistry'] },
	{ port: 'P-EXECUTION-RECOVERY', symbols: ['ExecutionRecoveryService'] },
] as const;

/** Invariants enforced by the gate and the package tests. */
export const EXECUTION_INVARIANTS = [
	'X1 add() without id persists a new execution (status new → running) and reserves capacity',
	'X2 resuming by id requires status waiting, otherwise ExecutionAlreadyResumingError',
	'X3 getActiveExecutions() summary shape; getExecutionOrFail → "No active execution found"',
	'X4 an execution removes itself when postExecutePromise settles — unless it is waiting',
	'X5 stopExecution emits execution-cancelled {executionId, workflowId, workflowName, reason}; unknown id is a no-op',
	'X6 finalizeExecution resolves the post-execute promise and closes streaming responses',
	'X7 shutdown(cancelAll) cancels with SystemShutdownExecutionCancelledError and drops new/waiting executions',
	'X8 isWorkflowIdValid: string, 1..21 characters',
	'X9 trigger activation failures → WorkflowActivationError "There was a problem activating the workflow: \\"<msg>\\""',
	'X10 polling cron whose first field contains * → UserError "The polling interval is too short. It has to be at least a minute."',
	'X11 a failed poll activation keeps the workflow inactive when no trigger responded',
	'X12 remove(): inactive → warn "Cannot deactivate already inactive workflow ID \\"<id>\\""; close errors → TriggerCloseError / WorkflowDeactivationError',
	'X13 hook registry init: first registration wins, failing init() is skipped',
	'X14 execution context decrypt/encrypt/merge (deep merge)',
	'X15 augmentExecutionContextWithHooks honours isAllowedToFail and merges contextUpdate',
	'X16 auto-deactivation when the last N executions all crashed (N default 3)',
	'X17 recoverFromLogs builds crashed/success task data with ARTIFICIAL_TASK_DATA, followers return null',
] as const;
