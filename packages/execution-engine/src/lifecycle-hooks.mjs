/**
 * ExecutionLifecycleHooks — the hook store the execute loop and the activation
 * path share.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/execution-lifecycle-hooks.ts
 *     - the `handlers` table (8 hook names, L~88-98)
 *     - addHandler   L109-115   (push, no de-duplication)
 *     - runHook      L117-134   (awaits every handler in registration order, `this` bound
 *                                to the store, parameters passed through unchanged)
 *
 * The loop itself only ever *fires* the five lifecycle hooks; the activation path
 * additionally needs to *register* handlers (`sendResponse`, `workflowExecuteAfter`)
 * so a manual trigger's `emit()` can settle the caller's deferred promises.
 */

const HOOK_NAMES = [
	'nodeExecuteAfter',
	'nodeExecuteBefore',
	'nodeFetchedData',
	'sendResponse',
	'workflowExecuteAfter',
	'workflowExecuteBefore',
	'workflowExecuteResume',
	'sendChunk',
];

export class ExecutionLifecycleHooks {
	constructor(mode, executionId, workflowData) {
		this.mode = mode;
		this.executionId = executionId;
		this.workflowData = workflowData;
		this.handlers = Object.fromEntries(HOOK_NAMES.map((name) => [name, []]));
	}

	/** `addHandler(hookName, ...handlers)` — unknown hook names are rejected like upstream. */
	addHandler(hookName, ...handlers) {
		if (!Object.hasOwn(this.handlers, hookName)) {
			throw new Error(`Unknown hook name "${hookName}"`);
		}
		this.handlers[hookName].push(...handlers);
	}

	/**
	 * `runHook(hookName, parameters)` — awaits each handler in registration order.
	 * A handler that throws stops the remaining handlers and rejects the caller,
	 * exactly like the reference `for (… ) await handler.apply(this, parameters)`.
	 */
	async runHook(hookName, parameters = []) {
		const hooks = this.handlers[hookName];
		if (hooks === undefined) {
			throw new Error(`Unknown hook name "${hookName}"`);
		}
		for (const hookFunction of hooks) {
			await hookFunction.apply(this, parameters);
		}
	}
}

/** `createDeferredPromise()` — reference workflow/src/deferred-promise.ts L10-17. */
export function createDeferredPromise() {
	const deferred = {};
	deferred.promise = new Promise((resolve, reject) => {
		deferred.resolve = resolve;
		deferred.reject = reject;
	});
	return deferred;
}
