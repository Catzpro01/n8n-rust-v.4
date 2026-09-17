/**
 * Minimal ExecutionLifecycleHooks — reconstruction of the hook surface the
 * execution loop consumes (reference: n8n-core `execution-lifecycle-hooks`,
 * invoked from workflow-execute.ts).
 *
 * The reference resolves hooks through DI (Container.get(ExecutionLifecycleHooks)
 * wired by the CLI); this port keeps the exact call ORDER and AWAIT semantics the
 * loop relies on (spec §4.1 i / m / r / §4.3) but lets the host inject plain
 * functions. All hooks are optional; missing ones are no-ops.
 *
 * Supported hook names (exactly the ones the loop calls):
 *   workflowExecuteBefore(workflow, runExecutionData)
 *   workflowExecuteResume(workflow, runExecutionData)
 *   workflowExecuteAfter(fullRunData, newStaticData?)
 *   nodeExecuteBefore(nodeName, taskStartedData)
 *   nodeExecuteAfter(nodeName, taskData, runExecutionData)
 *   sendChunk(chunk)
 */

export class ExecutionLifecycleHooks {
	/** @param {Record<string, Function>} handlers */
	constructor(handlers = {}) {
		this.handlers = handlers;
	}

	/**
	 * @param {string} name
	 * @param {Array} args
	 */
	async runHook(name, args) {
		const fn = this.handlers[name];
		if (typeof fn !== 'function') return undefined;
		return fn(...args);
	}
}

/**
 * @param {Record<string, Function>} [handlers]
 */
export function createLifecycleHooks(handlers = {}) {
	return new ExecutionLifecycleHooks(handlers);
}
