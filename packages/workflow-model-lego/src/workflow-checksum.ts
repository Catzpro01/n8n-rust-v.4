import { createHash } from 'node:crypto';

import { isObject } from './interfaces';
import type { IConnection, IConnections, IPinData, IWorkflowSettings } from './interfaces';

/**
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/workflow-checksum.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`).
 *
 * Frozen surface symbol #14 (`contracts/workflow.contract.md` §6). Acceptance: the 8 `checksum`
 * cases in `tests/reference/workflow-rust/fixtures.json`, which pin all of:
 *
 * - the **9-field whitelist** `name, description, nodes, connections, settings, meta, pinData,
 *   isArchived, activeVersionId` — `id`, `active`, `versionId`, timestamps and `staticData` are
 *   excluded (`excluded-fields-ignored` hashes identically to `base`);
 * - **recursive key sorting** — top-level and nested key order are both irrelevant
 *   (`key-order-invariance`, `nested-key-order-invariance`);
 * - **array order is significant** — `nodes` is an array in the snapshot, so reordering nodes
 *   changes the digest (`node-order-matters`);
 * - `undefined` fields are dropped from the payload entirely, `{}`/`[]` are not.
 *
 * **One deliberate dependency substitution.** The reference hashes with WebCrypto when
 * `globalThis.crypto.subtle` exists and otherwise falls back to the `jssha` package. This
 * reconstruction keeps the WebCrypto branch byte-identical and replaces the `jssha` fallback with
 * `node:crypto`'s `createHash('sha256')`. Both produce the same lowercase hex digest of the same
 * UTF-8 bytes, and the Phase-3 JavaScript track is dependency-free; on Node ≥ 18 the WebCrypto
 * branch is the one that actually runs, so the fallback is not on the acceptance path.
 */

/**
 * Data structure containing workflow fields used for checksum calculation.
 * Excludes id, versionId, active, timestamps, etc.
 */
export interface WorkflowSnapshot {
	name?: string;
	description?: string | null;
	nodes?: Array<Record<string, unknown>>;
	connections?: IConnections;
	settings?: IWorkflowSettings;
	meta?: unknown;
	pinData?: IPinData;
	isArchived?: boolean;
	activeVersionId?: string | null;
}

const CHECKSUM_FIELDS = [
	'name',
	'description',
	'nodes',
	'connections',
	'settings',
	'meta',
	'pinData',
	'isArchived',
	'activeVersionId',
] as const satisfies ReadonlyArray<keyof WorkflowSnapshot>;

/**
 * Recursively sorts object keys alphabetically for consistent serialization.
 * Arrays keep their order; their elements are normalized recursively.
 */
export function sortObjectKeys(value: unknown): unknown {
	if (value === null || typeof value !== 'object') return value;

	if (Array.isArray(value)) {
		return value.map((element) => sortObjectKeys(element));
	}

	if (isObject(value)) {
		const sortedKeys = Object.keys(value).sort();

		const sortedObject: Record<string, unknown> = {};
		for (const key of sortedKeys) {
			sortedObject[key] = sortObjectKeys(value[key]);
		}

		return sortedObject;
	}

	return value;
}

/**
 * Calculates SHA-256 checksum of workflow content fields for conflict detection.
 * Excludes: id, versionId, timestamps, staticData, relations.
 */
export async function calculateWorkflowChecksum(workflow: WorkflowSnapshot): Promise<string> {
	const checksumPayload: Record<string, unknown> = {};

	for (const field of CHECKSUM_FIELDS) {
		const value = workflow[field];
		if (value !== undefined) {
			checksumPayload[field] = value;
		}
	}

	const normalizedPayload = sortObjectKeys(checksumPayload);
	const serializedPayload = JSON.stringify(normalizedPayload);

	const subtle = globalThis.crypto?.subtle;
	if (subtle) {
		const data = new TextEncoder().encode(serializedPayload);
		const hashBuffer = await subtle.digest('SHA-256', data);
		return arrayBufferToHex(hashBuffer);
	}

	// Documented substitution for the reference's `jssha` fallback — same digest, no dependency.
	return createHash('sha256').update(serializedPayload, 'utf8').digest('hex');
}

function arrayBufferToHex(arrayBuffer: ArrayBuffer): string {
	const bytes = new Uint8Array(arrayBuffer);
	let hexString = '';

	for (let index = 0; index < bytes.length; index++) {
		hexString += bytes[index].toString(16).padStart(2, '0');
	}

	return hexString;
}

/** Re-exported so consumers can build a snapshot without importing the connection types twice. */
export type { IConnection, IConnections };
