/**
 * @n8n-rust/persistence-lego — POOL-004 pure-core surface.
 * Mirrors the exported surface of the reference units (see contract §12.1).
 * The DI/TypeORM-facing parts of @n8n/db remain reference-owned (contract §12.2).
 */

// config + reporter ports (P-PERSIST-CONFIG / P-PERSIST-REPORTER)
export {
	setPersistenceConfig,
	getPersistenceConfig,
	getDbType,
	setPersistenceReporter,
	getPersistenceReporter,
	resetPersistencePorts,
} from './ports.mjs';

// consumed seam accessors (pinned version reporting)
export { CONSUMED_VERSIONS } from './consumed.mjs';

// utils/transformers.ts
export {
	idStringifier,
	lowerCaser,
	objectRetriever,
	sqlite,
	bigintStringToNumber,
} from './utils/transformers.mjs';

// utils trivial ports
export { separate } from './utils/separate.mjs';
export { isStringArray } from './utils/is-string-array.mjs';
export { sql } from './utils/sql.mjs';
export { getTestRunFinalResult } from './utils/get-final-test-result.mjs';

// utils/generators.ts + @n8n/utils workflowId.ts + @n8n/constants pin
export { NANOID_ALPHABET, generateNanoId, generateHostInstanceId } from './utils/generators.mjs';

// utils/build-workflows-by-nodes-query.ts
export { buildWorkflowsByNodesQuery } from './utils/build-workflows-by-nodes-query.mjs';

// entities/abstract-entity.ts value layer
export {
	timestampSyntaxFor,
	jsonColumnTypeFor,
	datetimeColumnTypeFor,
	binaryColumnTypeFor,
	jsonColumnOptions,
	dateTimeColumnOptions,
	binaryColumnOptions,
	tsColumnOptionsFor,
	mixinStringId,
	mixinUpdatedAt,
	mixinCreatedAt,
	WithStringId,
	WithCreatedAt,
	WithUpdatedAt,
	WithTimestamps,
	WithTimestampsAndStringId,
} from './entities/abstract-entity.mjs';

// repositories/execution-shaping (execution.repository.ts + execution-persistence.ts)
export {
	MAX_UPDATE_BATCH_SIZE,
	handleExecutionRunData,
	reportInvalidExecutions,
	serializeAnnotation,
	shapeMultipleExecutions,
	shapeSingleExecution,
	splitUpdateExecutionPayload,
	toExecutionIdString,
	planMarkAsCrashed,
	planExecutionPersistenceCreate,
} from './repositories/execution-shaping.mjs';

// execution-lifecycle/to-save-settings.ts
export { toSaveSettings } from './repositories/to-save-settings.mjs';

// errors twin
export { UnexpectedError } from './errors.mjs';
