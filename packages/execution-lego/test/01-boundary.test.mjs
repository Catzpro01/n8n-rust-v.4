import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const REFERENCE = path.join(REPO, 'reference/n8n');

const surface = fs.readFileSync(path.join(__dirname, '../src/model-surface.ts'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
const engine = fs.readFileSync(path.join(REPO, 'packages/reconstructed-engine/src/execution-engine.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest/ownership.json'), 'utf8'));

const readReference = (rel) => {
	const file = path.join(REFERENCE, rel);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

test('surface pins the reference provenance (n8n 2.9.4 @ b6dc2787)', () => {
	assert.ok(surface.includes('b6dc2787c45677a29a9612cd27eb911302961a83'));
	assert.ok(surface.includes('2.9.4'));
	for (let i = 1; i <= 17; i++) {
		assert.ok(surface.includes(`X${i}`), `missing invariant X${i}`);
	}
	for (const port of ['P-EXECUTION-REGISTRY', 'P-EXECUTION-ACTIVATION', 'P-EXECUTION-CONTEXT', 'P-EXECUTION-RECOVERY']) {
		assert.ok(surface.includes(port), `missing provided port ${port}`);
	}
	for (const consumed of ['@lego/persistence', '@lego/queue', '@lego/events', '@lego/realtime']) {
		assert.ok(surface.includes(consumed), `missing consumed port ${consumed}`);
	}
});

test('entry point exports only the published surface', () => {
	for (const symbol of [
		'ActiveExecutions',
		'ActiveWorkflows',
		'ExecutionContextService',
		'ExecutionContextHookRegistry',
		'ExecutionRecoveryService',
		'createExecutionRuntime',
		'MemoryExecutionRepository',
		'MemoryExecutionPersistence',
		'MemoryWorkflowRepository',
		'MemoryConcurrencyControl',
		'ExecutionNotFoundError',
		'ExecutionAlreadyResumingError',
		'SystemShutdownExecutionCancelledError',
		'WorkflowActivationError',
		'WorkflowDeactivationError',
		'NodeCrashedError',
		'WorkflowCrashedError',
		'ARTIFICIAL_TASK_DATA',
		'WORKFLOW_AUTODEACTIVATION_DEFAULTS',
	]) {
		assert.ok(index.includes(symbol), `index.ts does not export ${symbol}`);
	}
	assert.ok(index.includes('../../reconstructed-engine/src/execution-engine.ts'));
});

test('manifest ownership matches the reference files (ZERO RUST, frontend untouched)', () => {
	assert.equal(manifest.lego, 'execution');
	assert.equal(manifest.zeroRust, true);
	assert.equal(manifest.frontendUntouched, true);
	assert.equal(manifest.reference.version, '2.9.4');
	assert.equal(manifest.implemented.engine, 'packages/reconstructed-engine/src/execution-engine.ts');

	for (const rel of manifest.reference.owns) {
		assert.ok(fs.existsSync(path.join(REPO, rel)), `owned reference file missing: ${rel}`);
	}
	// the queue/scaling subsystem is owned by POOL-009, the run loop by the workflow LEGO
	assert.ok(manifest.reference.doesNotOwn.includes('reference/n8n/packages/cli/src/scaling/**'));
	assert.ok(!manifest.reference.owns.some((rel) => rel.includes('/scaling/')));
	assert.ok(!manifest.reference.owns.some((rel) => rel.includes('/push/')));
});

test('engine literals are byte-exact vs the reference sources', (t) => {
	const activeExecutions = readReference('packages/cli/src/active-executions.ts');
	if (!activeExecutions) return t.skip('reference runtime not present');

	// X3/X5 — messages live in the error classes
	const notFound = readReference('packages/cli/src/errors/execution-not-found-error.ts');
	assert.ok(notFound.includes("super('No active execution found', { extra: { executionId } });"));
	assert.ok(engine.includes("'No active execution found'"));

	const resuming = readReference('packages/cli/src/errors/execution-already-resuming.error.ts');
	assert.ok(resuming.includes("super('Execution is already being resumed by another process', { extra: { executionId } });"));
	assert.ok(engine.includes('Execution is already being resumed by another process'));

	const cancelled = readReference('packages/workflow/src/errors/execution-cancelled.error.ts');
	assert.ok(cancelled.includes("this.message = 'The execution was cancelled because the system is shutting down';"));
	assert.ok(cancelled.includes("super('The execution was cancelled', {"));
	assert.ok(engine.includes('The execution was cancelled because the system is shutting down'));
	assert.ok(engine.includes("type CancellationReason = 'manual' | 'timeout' | 'shutdown';"));

	const crashed = readReference('packages/cli/src/errors/node-crashed.error.ts');
	assert.ok(crashed.includes("super(node, 'Node crashed, possible out-of-memory issue', {"));
	assert.ok(crashed.includes("message: 'Execution stopped at this node',"));
	assert.ok(engine.includes('Node crashed, possible out-of-memory issue'));
	assert.ok(engine.includes('Execution stopped at this node'));

	const workflowCrashed = readReference('packages/cli/src/errors/workflow-crashed.error.ts');
	assert.ok(workflowCrashed.includes('Workflow did not finish, possible out-of-memory issue'));
	assert.ok(engine.includes('Workflow did not finish, possible out-of-memory issue'));

	// X4/X5/X6/X7 — the lifecycle lines the engine must mirror
	for (const literal of [
		'Execution removed',
		'Execution added',
		'Cancelling execution',
		'Execution cancelled',
		'Execution finalized',
		'Execution response promise cleaned',
		'Closing response for execution',
		'Error closing streaming response',
		'Waiting for ${executionIds.length} active executions to finish...',
	]) {
		assert.ok(activeExecutions.includes(literal), `reference drifted: ${literal}`);
		assert.ok(engine.includes(literal), `engine missing: ${literal}`);
	}
	assert.ok(activeExecutions.includes("if (execution.status === 'waiting') {"));
	assert.ok(activeExecutions.includes('await sleep(500);'));
	assert.ok(engine.includes('await this.sleep(500);'));
});

test('activation + context literals are byte-exact vs the reference sources', () => {
	const activeWorkflows = readReference('packages/core/src/execution-engine/active-workflows.ts');
	for (const literal of [
		'There was a problem activating the workflow: "${error.message}"',
		'Cannot deactivate already inactive workflow ID "${workflowId}"',
		'Failed to deactivate trigger of workflow ID "${workflowId}": "${error.message}"',
		'The polling interval is too short. It has to be at least a minute.',
		'Deactivated all trigger- and poller-based workflows',
		'There was a problem calling "closeFunction" on "${e.node.name}" in workflow "${workflowId}"',
		'Polling trigger initiated for workflow "${workflow.name}"',
	]) {
		assert.ok(activeWorkflows.includes(literal), `reference drifted: ${literal}`);
		assert.ok(engine.includes(literal), `engine missing: ${literal}`);
	}

	const hookRegistry = readReference('packages/core/src/execution-engine/execution-context-hook-registry.service.ts');
	for (const literal of [
		'execution context hooks.', // reference uses the local `hookClasses`, the engine `this.hookClasses`
		'Failed to instantiate execution context hook class "${HookClass.name}": ${(error as Error).message}',
		'Execution context hook with name "${hook.hookDescription.name}" is already registered.',
		'Failed to initialize execution context hook "${hook.hookDescription.name}": ${(error as Error).message}',
	]) {
		assert.ok(hookRegistry.includes(literal), `reference drifted: ${literal}`);
		assert.ok(engine.includes(literal), `engine missing: ${literal}`);
	}

	const contextService = readReference('packages/core/src/execution-engine/execution-context.service.ts');
	for (const literal of [
		'Failed to parse execution context establishment hook parameters for node ${startItem.node.name}: ${startNodeParametersResult.error.message}',
		'Execution context establishment hook ${hookParameters.hookName} not found, skipping this hook',
		'Failed to execute context establishment hook ${hookParameters.hookName}',
	]) {
		assert.ok(contextService.includes(literal), `reference drifted: ${literal}`);
		assert.ok(engine.includes(literal), `engine missing: ${literal}`);
	}
});

test('recovery literals + defaults are byte-exact vs the reference sources', () => {
	const recovery = readReference('packages/cli/src/executions/execution-recovery.service.ts');
	for (const literal of [
		'Autodeactivated workflow ${workflowId} due to too many crashed executions.',
		'Workflow ${workflowId} not found, skipping workflow auto-deactivation',
		"'[Recovery] Logs available, amended execution'",
		"workflowAutoDeactivated",
		"'executionRecovered'",
		"'n8n.node.started'",
		"'n8n.node.finished'",
		]) {
		assert.ok(recovery.includes(literal), `reference drifted: ${literal}`);
	}
	// the workflow-end set is written as a multiline literal in the reference
	for (const event of ['n8n.workflow.success', 'n8n.workflow.crashed', 'n8n.workflow.failed']) {
		assert.ok(recovery.includes(`'${event}',`), `reference drifted: ${event}`);
		assert.ok(engine.includes(`'${event}'`), `engine missing: ${event}`);
	}
	for (const literal of [
		'Autodeactivated workflow ${workflowId} due to too many crashed executions.',
		'Workflow ${workflowId} not found, skipping workflow auto-deactivation',
		'[Recovery] Logs available, amended execution',
		'workflowAutoDeactivated',
		'executionRecovered',
		'n8n.node.started',
		'n8n.node.finished',
	]) {
		assert.ok(engine.includes(literal), `engine missing: ${literal}`);
	}
	assert.ok(recovery.includes('await sleep(1000);'));
	assert.ok(engine.includes('export const PUSH_AFTER_UI_TIMEOUT_MS = 1000;'));

	const constants = readReference('packages/cli/src/constants.ts');
	assert.ok(constants.includes('export const ARTIFICIAL_TASK_DATA = {'));
	assert.ok(constants.includes('isArtificialRecoveredEventItem: true'));
	assert.ok(engine.includes('isArtificialRecoveredEventItem: true'));

	const config = readReference('packages/@n8n/config/src/configs/executions.config.ts');
	const recoveryBlock = config.slice(config.indexOf('class RecoveryConfig'));
	assert.ok(recoveryBlock.includes('maxLastExecutions: number = 3;'));
	assert.ok(recoveryBlock.includes('workflowDeactivationEnabled: boolean = false;'));
	assert.ok(engine.includes('maxLastExecutions: 3'));
	assert.ok(engine.includes('workflowDeactivationEnabled: false'));
});

test('frontend + Rust boundaries are untouched by this LEGO', () => {
	const legacy = ['editor-ui', 'design-system', 'n8n-editor-ui'];
	for (const needle of legacy) {
		assert.ok(!index.includes(needle), `execution LEGO must not reference ${needle}`);
		assert.ok(!surface.includes(`'${needle}`), `surface must not claim ${needle}`);
	}
	assert.ok(!index.includes('.rs'), 'execution LEGO must not reference Rust sources');
	assert.ok(!surface.includes('.rs'));
	assert.ok(manifest.reference.doesNotOwn.some((rel) => rel.includes('workflow-execute.ts')));
});
