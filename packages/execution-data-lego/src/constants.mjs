/**
 * Execution Data LEGO — constants.
 *
 * 1:1 from n8n 2.9.4:
 *   packages/workflow/src/constants.ts:6,137,139,140
 *   packages/core/src/binary-data/utils.ts:7   (STORED_MODES)
 *   packages/workflow/src/run-execution-data/run-execution-data.ts:20  (current version)
 */

/** Encoding used for inline binary payloads. */
export const BINARY_ENCODING = 'base64';

/** Property under which binary files are smuggled through a JSON body. */
export const BINARY_IN_JSON_PROPERTY = '_files';

/** Binary data of an item is stored as a separate field on the item. */
export const BINARY_MODE_SEPARATE = 'separate';

/** Binary data of an item is merged into the `json` field. */
export const BINARY_MODE_COMBINED = 'combined';

/**
 * Modes whose binary payload lives outside the execution record.
 * `1:1` with `STORED_MODES` in packages/core/src/binary-data/utils.ts:7.
 */
export const STORED_MODES = /** @type {const} */ ([
	'filesystem',
	'filesystem-v2',
	's3',
	'database',
]);

/** In-memory mode: no manager, payload stays in `IBinaryData.data`. */
export const BINARY_MODE_DEFAULT = 'default';

/** Current on-disk version of `IRunExecutionData`. */
export const RUN_EXECUTION_DATA_VERSION = 1;

/** Main connection type — the only connection type paired-item rules apply to. */
export const MAIN_CONNECTION_TYPE = 'main';
