/**
 * 1:1 port of the pure response-shaping layer of
 *   reference/n8n/packages/@n8n/db/src/repositories/execution.repository.ts
 *   (L149 constant, L191-226 findMultipleExecutions, L230-237 reportInvalidExecutions,
 *    L239-247 serializeAnnotation, L269-344 findSingleExecution,
 *    L350-362 markAsCrashed, L388-406 updateExistingExecution payload split,
 *    L1125-1140 handleExecutionRunData)
 * and of the insert planning inside
 *   reference/n8n/packages/cli/src/executions/execution-persistence.ts#create (L33-65).
 *
 * Excluded (contract §12.2): TypeORM find/query/update calls themselves. The ORM
 * boundary is represented by plain data in/out — every function below is exactly
 * the transformation the reference applies around those calls.
 *
 * Deviation D-PERSIST-04: `ErrorReporter`/`Logger` edge calls go through port
 * P-PERSIST-REPORTER. `flatted` parse/stringify and `migrateRunExecutionData` are
 * consumed (P-PERSIST-WORKFLOW) — see src/consumed.mjs.
 */
import { flattedParse, flattedStringify, migrateRunExecutionData } from '../consumed.mjs';
import { getPersistenceReporter } from '../ports.mjs';
import { separate } from '../utils/separate.mjs';
import { UnexpectedError } from '../errors.mjs';

export const MAX_UPDATE_BATCH_SIZE = 900;

/** execution.repository.ts L1125-1140. */
export function handleExecutionRunData(data, { unflattenData } = {}) {
	if (unflattenData) {
		// Parse the serialized data.
		const deserializedData = flattedParse(data);
		// If it parses to an object, migrate and return it.
		if (deserializedData) {
			return migrateRunExecutionData(deserializedData);
		}
		return undefined;
	}
	// Just return the string data as-is.
	return data;
}

/** execution.repository.ts L230-237. Reported via P-PERSIST-REPORTER (D-PERSIST-04). */
export function reportInvalidExecutions(executions, reporter = getPersistenceReporter()) {
	if (executions.length === 0) return;

	reporter.error(
		new UnexpectedError('Found executions without executionData', {
			extra: {
				executionIds: executions.map(({ id }) => id),
			},
		}),
	);
}

/**
 * Lodash `pick(tag, ['id', 'name'])` for plain objects (own-or-inherited keys only),
 * matching lodash semantics: absent keys are omitted, undefined-valued existing keys kept.
 */
function pickIdName(tag) {
	const out = {};
	for (const key of ['id', 'name']) {
		if (key in Object(tag)) out[key] = tag[key];
	}
	return out;
}

/** execution.repository.ts L239-247. */
export function serializeAnnotation(annotation) {
	if (!annotation) return null;

	const { id, vote, tags } = annotation;
	return {
		id,
		vote,
		tags: tags?.map(pickIdName) ?? [],
	};
}

/**
 * execution.repository.ts L191-226 (post-`find` shape only).
 * Returns what the reference returns from `findMultipleExecutions` for already-loaded rows.
 */
export function shapeMultipleExecutions(executions, options, reporter = getPersistenceReporter()) {
	const [valid, invalid] = separate(executions, (e) => e.executionData !== null);
	reportInvalidExecutions(invalid, reporter);

	if (!options?.includeData) {
		// No data to include, so we exclude it and return early.
		return executions.map((execution) => {
			const { executionData, ...rest } = execution;
			return rest;
		});
	}

	return valid.map((execution) => {
		const { executionData, metadata, ...rest } = execution;
		const data = handleExecutionRunData(executionData.data, options);
		return {
			...rest,
			data,
			workflowData: executionData.workflowData,
			customData: Object.fromEntries(metadata.map((m) => [m.key, m.value])),
		};
	});
}

/**
 * execution.repository.ts L269-344 (post-`findOne` shape only).
 * `execution` is the loaded entity or null/undefined (findOne miss → undefined).
 */
export function shapeSingleExecution(execution, options, reporter = getPersistenceReporter()) {
	if (!execution) {
		return undefined;
	}

	const { executionData, metadata, annotation, ...rest } = execution;
	const serializedAnnotation = serializeAnnotation(annotation);

	if (execution.status === 'success' && executionData?.data === '[]') {
		reporter.error('Found successful execution where data is empty stringified array', {
			extra: {
				executionId: execution.id,
				workflowId: executionData?.workflowData.id,
			},
		});
	}

	if (!options?.includeData) {
		// Not including run data, so return early. (Reference re-destructures `execution` here;
		// the observable result equals rest, kept byte-identical in behavior.)
		const { executionData: _executionData, ...restEntity } = execution;
		return {
			...restEntity,
			...(options?.includeAnnotation && serializedAnnotation && { annotation: serializedAnnotation }),
		};
	}

	// Include the run data.
	const data = handleExecutionRunData(executionData.data, options);
	return {
		...rest,
		data,
		workflowData: executionData.workflowData,
		customData: Object.fromEntries(metadata.map((m) => [m.key, m.value])),
		...(options?.includeAnnotation && serializedAnnotation && { annotation: serializedAnnotation }),
	};
}

/**
 * execution.repository.ts L388-406: the payload split executed BEFORE the
 * updateExistingExecution transaction. `id`, `data`, `workflowId`, `workflowData`,
 * `createdAt`, `startedAt`, `customData` never travel into `executionInformation`.
 */
export function splitUpdateExecutionPayload(execution) {
	const {
		id: _id,
		data,
		workflowId: _workflowId,
		workflowData,
		createdAt: _createdAt, // must never change
		startedAt: _startedAt, // must never change
		customData: _customData,
		...executionInformation
	} = execution;

	const executionData = {};

	if (workflowData) executionData.workflowData = workflowData;
	if (data) executionData.data = flattedStringify(data);

	return { executionInformation, executionData };
}

/** execution.repository.ts L344 — String(identifiers[0].id) on insert. */
export function toExecutionIdString(insertedIdentifier) {
	return String(insertedIdentifier);
}

/**
 * execution.repository.ts L350-362 (+L361 log quirk: `logger.info` receives the FULL
 * id list, not the batch). Returned as a data plan; the ORM update itself is §12.2.
 * `now` is injectable for deterministic goldens; default keeps reference nondeterminism.
 */
export function planMarkAsCrashed(executionIds, { now = () => new Date(), reporter = getPersistenceReporter() } = {}) {
	if (!Array.isArray(executionIds)) executionIds = [executionIds];

	const plan = [];
	let processed = 0;
	while (processed < executionIds.length) {
		// NOTE: if a slice goes past the end of the array, it just returns up til the end.
		const batch = executionIds.slice(processed, processed + MAX_UPDATE_BATCH_SIZE);
		plan.push({
			where: { id: { operator: 'In', values: batch } },
			update: { status: 'crashed', stoppedAt: now() },
		});
		reporter.info('Marked executions as `crashed`', { executionIds });
		processed += batch.length;
	}
	return plan;
}

/**
 * cli/src/executions/execution-persistence.ts#create L33-65 — insert/fs-write planning.
 * `onExecutionId` resolves the second step once the ORM returns String(identifiers[0].id);
 * the db/fs branch decision itself is part of the ported behavior.
 */
export function planExecutionPersistenceCreate(payload, { modeTag, now = () => new Date() } = {}) {
	const { data: rawData, workflowData, ...rest } = payload;
	const { connections, nodes, name, settings, id } = workflowData;
	const workflowSnapshot = { connections, nodes, name, settings, id };
	const storedAt = modeTag;
	const executionEntity = { ...rest, createdAt: now(), storedAt };
	const data = flattedStringify(rawData);
	const workflowVersionId = workflowData.versionId ?? null;

	return {
		storedAt,
		insert: { entity: 'ExecutionEntity', row: executionEntity },
		// Runs inside the same transaction right after the entity insert.
		onExecutionId: (executionId) =>
			storedAt === 'db'
				? {
						kind: 'insert',
						entity: 'ExecutionData',
						row: {
							executionId,
							workflowData: workflowSnapshot,
							data,
							workflowVersionId,
						},
					}
				: {
						kind: 'fs-write',
						ref: { workflowId: id, executionId },
						payload: { data, workflowData: workflowSnapshot, workflowVersionId },
					},
	};
}
