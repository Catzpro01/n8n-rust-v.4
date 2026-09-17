/**
 * TriggerContext — the node execution context handed to `nodeType.trigger`.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/node-execution-context/trigger-context.ts
 *     - `TriggerContext extends NodeExecutionContext`      L27-63
 *     - the three throwing defaults (`emit`, `emitError`, `saveFailedExecution`) L14-25
 *     - helpers: createDeferredPromise + returnJsonArray   L41-47
 *     - getActivationMode()                                L49-51
 *     - getCredentials() → `_getCredentials`               L53-56
 *
 * Boundaries: the reference spreads five helper families (SSH tunnel, request, binary,
 * scheduling) into `helpers`. Those are separate LEGOs/adapters with their own
 * boundaries, so this reconstruction keeps the two helpers that are part of the
 * workflow package surface (`createDeferredPromise`, `returnJsonArray`) and documents
 * the missing four as a delta rather than importing n8n internals.
 */

import { ApplicationError } from './errors.mjs';
import { ExecuteContext, returnJsonArray } from './node-execution-context.mjs';
import { createDeferredPromise } from './lifecycle-hooks.mjs';

const throwOnEmit = () => {
	throw new ApplicationError('Overwrite TriggerContext.emit function');
};

const throwOnEmitError = () => {
	throw new ApplicationError('Overwrite TriggerContext.emitError function');
};

const throwOnSaveFailedExecution = () => {
	throw new ApplicationError('Overwrite TriggerContext.saveFailedExecution function');
};

export class TriggerContext extends ExecuteContext {
	constructor({
		workflow,
		node,
		additionalData = {},
		mode = 'trigger',
		activation = 'init',
		emit = throwOnEmit,
		emitError = throwOnEmitError,
		saveFailedExecution = throwOnSaveFailedExecution,
		_getCredentials,
		...rest
	} = {}) {
		super({ workflow, node, additionalData, mode, ...rest });

		this.activation = activation;
		this.emit = emit;
		this.emitError = emitError;
		this.saveFailedExecution = saveFailedExecution;
		// Injected credentials adapter (contracts/credentials.contract.md); undefined
		// means "no credentials LEGO attached", which falls back to the boundary error.
		if (_getCredentials !== undefined) this._getCredentials = _getCredentials;

		this.helpers = {
			...this.helpers,
			createDeferredPromise,
			returnJsonArray,
		};
	}

	getActivationMode() {
		return this.activation;
	}

	/**
	 * Reference delegates to `_getCredentials(type)` (node-execution-context.ts L286+),
	 * which resolves the credential description from the node type and calls the
	 * credentials adapter. In this reconstruction the credentials LEGO owns that
	 * surface, so an injected `_getCredentials` (a `{ getCredentials(workflow, node,
	 * type) }` adapter supplied by the caller) is used when present; otherwise the
	 * base boundary error is raised instead of silently returning nothing.
	 */
	async getCredentials(type) {
		if (typeof this._getCredentials === 'function') {
			return await this._getCredentials(type);
		}
		return await super.getCredentials(type);
	}
}
