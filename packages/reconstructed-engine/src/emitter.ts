/**
 * Shared emitter — twin of `packages/cli/src/typed-emitter.ts` (n8n 2.9.4).
 *
 * Semantics kept: listeners are stored per event name, `emit` is synchronous and
 * never throws into the caller for a missing listener, `on/off` are chainable.
 * This module is shared infrastructure (like `n8n-workflow`'s shared utils) and is
 * intentionally free of any subsystem semantics, so every LEGO engine can depend on it
 * without creating a hidden coupling (docs/isolation/DEPENDENCY-GRAPH.md).
 */

export type EventHandler = (payload: any) => void;

export class TypedEmitter {
	private readonly listeners = new Map<string, EventHandler[]>();

	on(event: string, handler: EventHandler): this {
		const list = this.listeners.get(event) ?? [];
		list.push(handler);
		this.listeners.set(event, list);
		return this;
	}

	off(event: string, handler: EventHandler): this {
		const list = (this.listeners.get(event) ?? []).filter((item) => item !== handler);
		this.listeners.set(event, list);
		return this;
	}

	emit(event: string, payload?: unknown): boolean {
		for (const handler of this.listeners.get(event) ?? []) handler(payload);
		return true;
	}

	listenerCount(event: string): number {
		return (this.listeners.get(event) ?? []).length;
	}

	eventNames(): string[] {
		return [...this.listeners.keys()];
	}
}
