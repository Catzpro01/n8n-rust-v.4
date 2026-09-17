/**
 * POOL-004 · Suite 07 — consumed-surface pinning + toSaveSettings decision table.
 * The A/B anchor: consumed symbols ARE the pinned dist functions (by construction),
 * and this suite machine-asserts that anchor instead of assuming it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CONSUMED_VERSIONS,
	jsonParse,
	migrateRunExecutionData,
	flattedParse,
	flattedStringify,
	customAlphabet,
} from '../src/consumed.mjs';
import { toSaveSettings } from '../src/repositories/to-save-settings.mjs';
import { setPersistenceConfig, resetPersistencePorts } from '../src/ports.mjs';

test('consumed pins: exact dependency set of n8n@2.9.4 for this LEGO', () => {
	assert.deepEqual(CONSUMED_VERSIONS, {
		'n8n-workflow': '2.9.1',
		flatted: '3.2.7',
		nanoid: '3.3.8',
	});
	assert.equal(typeof jsonParse, 'function');
	assert.equal(typeof migrateRunExecutionData, 'function');
	assert.equal(typeof flattedParse, 'function');
	assert.equal(typeof flattedStringify, 'function');
	assert.equal(typeof customAlphabet, 'function');
});

test('flatted byte pin: frozen wire string for a minimal fixture (compat requirement §11)', () => {
	const expected = flattedStringify({ a: [1, 'x', null, true], b: { c: {} } });
	// Re-stringify must be deterministic and the parse must be the exact inverse.
	assert.equal(flattedStringify({ a: [1, 'x', null, true], b: { c: {} } }), expected);
	assert.deepEqual(flattedParse(expected), { a: [1, 'x', null, true], b: { c: {} } });
});

test('jsonParse (consumed): parses; throws without fallback; fallbackValue honored', () => {
	assert.deepEqual(jsonParse('{"a":1}'), { a: 1 });
	assert.throws(() => jsonParse('{broken'));
	assert.deepEqual(jsonParse('{broken', { fallbackValue: { ok: false } }), { ok: false });
});

test('migrateRunExecutionData (consumed): v2 throws the frozen message', () => {
	assert.throws(() => migrateRunExecutionData({ version: 2, data: {} }), /Unsupported IRunExecutionData version: 2/);
});

// ------------------------------------------------------------- toSaveSettings
test('toSaveSettings: defaults — workflow settings empty or null resolve to config defaults', () => {
	resetPersistencePorts();
	assert.deepEqual(toSaveSettings(), { error: true, success: true, manual: true, progress: true });
	assert.deepEqual(toSaveSettings({}), { error: true, success: true, manual: true, progress: true });
	assert.deepEqual(toSaveSettings(null), { error: true, success: true, manual: true, progress: true });
});

test("toSaveSettings: explicit 'all'/'none' collapse to booleans ('DEFAULT' keeps RAW config — evidence pin)", () => {
	resetPersistencePorts();
	assert.deepEqual(
		toSaveSettings({ saveDataErrorExecution: 'none', saveDataSuccessExecution: 'all' }),
		{ error: false, success: true, manual: true, progress: true },
	);
	// FROZEN ASYMMETRY (reference): a workflow value of 'DEFAULT' returns the RAW config
	// value ('all'|'none' string), NOT a boolean — ExecutionSaveSettings.error/success
	// are typed boolean|'all'|'none' exactly because of this path.
	assert.deepEqual(
		toSaveSettings({
			saveDataErrorExecution: 'DEFAULT',
			saveDataSuccessExecution: 'DEFAULT',
			saveManualExecutions: 'DEFAULT',
			saveExecutionProgress: 'DEFAULT',
		}),
		{ error: 'all', success: 'all', manual: true, progress: true },
	);
});

test('toSaveSettings: booleans pass through (manual/progress); config port changes defaults', () => {
	assert.deepEqual(toSaveSettings({ saveManualExecutions: false, saveExecutionProgress: false }), {
		error: true,
		success: true,
		manual: false,
		progress: false,
	});

	setPersistenceConfig({
		executions: { saveDataOnError: 'none', saveDataOnSuccess: 'none', saveDataManualExecutions: false, saveExecutionProgress: false },
	});
	// absent workflow keys: destructure-default gives raw config ('none'), then ==='all' -> false
	assert.deepEqual(toSaveSettings({}), { error: false, success: false, manual: false, progress: false });
	// explicit 'DEFAULT': raw config value 'none' survives UNCOERCED
	assert.deepEqual(toSaveSettings({ saveDataErrorExecution: 'DEFAULT' }), {
		error: 'none',
		success: false,
		manual: false,
		progress: false,
	});
	resetPersistencePorts();
});
