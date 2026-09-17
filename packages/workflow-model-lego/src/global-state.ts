/**
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/global-state.ts` (n8n 2.9.4).
 *
 * `Workflow.timezone` falls back to `getGlobalState().defaultTimezone`
 * (`workflow.ts:132`). The pinned runtime resolves that to `America/New_York`, which the
 * `toJSON` fixtures record — so the default is part of the acceptance set, not an assumption.
 *
 * The reference keeps this in module-level mutable state. That is preserved (the boundary audit
 * already classifies `global-mutable-state` as a known reference signal), but the setter is
 * exported so a host can pin the default deterministically instead of depending on ambient `TZ`.
 */

export interface GlobalState {
	defaultTimezone: string;
}

let globalState: GlobalState = { defaultTimezone: 'America/New_York' };

export function setGlobalState(state: GlobalState) {
	globalState = state;
}

export function getGlobalState(): GlobalState {
	return globalState;
}
