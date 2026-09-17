/**
 * Phase 4F — Run-path tests: execution-log record + localized API responses (Gate 8).
 *
 * Machine-verified properties asserted here:
 *   F1  product vocabulary parity: six locales, identical key sets, no empty values
 *   F2  every product key resolves in every locale, with no diagnostics
 *   F3  execution-log record shape and the reference execution-row field names
 *   F4  duration derivation from ISO timestamps (+ the unusable-input cases)
 *   F5  the record's localized block comes from the 4E envelope (no re-formatting drift)
 *   F6  run summaries per status, and statuses without a summary are not invented
 *   F7  trigger labels for every run mode; unknown modes are diagnosed
 *   F8  API error responses: status mapping, localized message/hint, generic-error shape (code 0)
 *   F9  success envelope `{ data }` and health `{ status, label }`
 *   F10 isolation: 4B/4E data untouched, no shared locale state, no clock, no env access,
 *       in-package imports only, JSON-safe output
 *
 * Run: node --test packages/workflow-lego/test/08-localization-run-path.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	PRODUCT_DICTIONARY_EXTENSION,
	RUN_MODES,
	SUMMARY_MESSAGE_KEYS,
	TRIGGER_MESSAGE_KEYS,
	createProductRuntime,
	nodeStateLabel,
	productKeys,
	runSummary,
	triggerLabel,
} from '../src/localization-vocabulary.ts';
import {
	buildExecutionLogRecord,
	durationBetween,
	formatExecutionLogLine,
	isKnownRunMode,
	nodeLinesOf,
	relocalizeNodeLine,
} from '../src/execution-log-record.ts';
import {
	GENERIC_ERROR_CODE,
	HINT_KEY_BY_ERROR_CODE,
	HTTP_STATUS_BY_ERROR_CODE,
	buildApiErrorResponse,
	buildApiSuccessResponse,
	buildHealthResponse,
} from '../src/api-error-response.ts';
import {
	API_ERROR_CODES,
	ENVELOPE_DICTIONARY_EXTENSION,
	buildRunEnvelope,
} from '../src/localization-envelope.ts';
import { SUPPORTED_LOCALE_CODES } from '../src/localization-runtime.ts';
import { NATIVE_DICTIONARIES, NativeLocalizationService } from '../src/backend-localization-service.ts';

const HERE = fileURLToPath(import.meta.url);
const PKG = join(HERE, '..', '..');
const LOCALES = ['id', 'en', 'jv', 'ar', 'zh', 'ru'] as const;

const runtimeFor = (locale: string) => createProductRuntime({ localeSource: { getLocale: () => locale } });

const sampleInput = {
	executionId: 'EX-42',
	workflowId: 'WF-7',
	workflowName: 'SMOKETEST001TEST',
	mode: 'manual' as const,
	status: 'success' as const,
	startedAt: '2026-09-17T10:00:00.000Z',
	stoppedAt: '2026-09-17T10:00:00.025Z',
	nodes: [
		{ nodeName: 'Webhook', status: 'success' as const, itemCount: 3, durationMs: 12 },
		{ nodeName: 'Code', status: 'success' as const },
	],
	itemCount: 3,
};

/* --- F1/F2 vocabulary ------------------------------------------------------------------- */

test('F1 the product vocabulary is consistent across all six locales', () => {
	const reference = productKeys('en');
	assert.equal(reference.length, 12);
	for (const locale of LOCALES) {
		assert.deepEqual([...productKeys(locale)].sort(), [...reference].sort(), `key drift in ${locale}`);
		for (const key of reference) {
			const value = PRODUCT_DICTIONARY_EXTENSION[locale]?.[key];
			assert.equal(typeof value, 'string', `${locale}:${key} missing`);
			assert.notEqual(value.trim(), '', `${locale}:${key} is empty`);
			assert.equal(new Set(Object.keys(PRODUCT_DICTIONARY_EXTENSION[locale])).size, reference.length);
		}
	}
	assert.deepEqual(productKeys('de'), [], 'an unknown locale exposes no keys and does not throw');
});

test('F1 the three vocabularies (4B / 4E / 4F) do not collide', () => {
	const product4b = new Set(Object.keys(NATIVE_DICTIONARIES['en']));
	const engine4e = new Set(Object.keys(ENVELOPE_DICTIONARY_EXTENSION['en']));
	for (const key of productKeys('en')) {
		assert.equal(product4b.has(key), false, `${key} duplicates a Phase 4B key`);
		assert.equal(engine4e.has(key), false, `${key} duplicates a Phase 4E key`);
	}
});

test('F2 every product key resolves in every locale and leaves no diagnostics', () => {
	for (const locale of SUPPORTED_LOCALE_CODES) {
		const rt = runtimeFor(locale);
		for (const key of productKeys('en')) {
			const value = rt.t(key, { duration: '1 ms', nodes: '1 node', items: '1 item' }, locale);
			assert.notEqual(value, key, `${locale}:${key} fell back to the key`);
			assert.notEqual(value.trim(), '', `${locale}:${key} is empty`);
			assert.equal(rt.has(key, locale), true, `${locale}:${key} reports as missing`);
		}
		assert.deepEqual([...rt.getMissingKeys()], [], `unexpected diagnostics in ${locale}`);
	}
});

/* --- F3 record shape -------------------------------------------------------------------- */

test('F3 the execution-log record carries the execution-row field names', () => {
	const record = buildExecutionLogRecord(sampleInput, runtimeFor('id'));
	assert.deepEqual(Object.keys(record), [
		'id',
		'workflowId',
		'workflowName',
		'mode',
		'status',
		'startedAt',
		'stoppedAt',
		'durationMs',
		'totalItems',
		'nodeRuns',
		'localized',
		'redacted',
	]);
	assert.equal(record.id, 'EX-42');
	assert.equal(record.workflowId, 'WF-7');
	assert.equal(record.mode, 'manual');
	assert.equal(record.startedAt, '2026-09-17T10:00:00.000Z');
	assert.equal(record.stoppedAt, '2026-09-17T10:00:00.025Z');
	assert.equal(record.durationMs, 25);
	assert.equal(record.totalItems, 3);
	assert.deepEqual(record.nodeRuns, [
		{ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 },
		{ nodeName: 'Code', status: 'success', itemCount: null, durationMs: null },
	]);
	assert.deepEqual(record.redacted, {});
});

test('F3 the localized block is resolved at write time and names its run locale', () => {
	const record = buildExecutionLogRecord(sampleInput, runtimeFor('jv'));
	assert.equal(record.localized.locale, 'jv');
	assert.equal(record.localized.direction, 'ltr');
	// `message` comes from the 4E execution-lifecycle vocabulary; `node.success` ("Kasil dilakokake")
	// is the *node* status string — the two are intentionally different keys.
	assert.equal(record.localized.message, 'Eksekusi rampung');
	assert.equal(record.localized.summary, 'Rampung sajrone 25 ms — 2 node, 3 item');
	assert.equal(record.localized.trigger, 'Dipicu manual');
	assert.equal(formatExecutionLogLine(record), 'EX-42 SMOKETEST001TEST [manual] Rampung sajrone 25 ms — 2 node, 3 item');
	assert.equal(nodeLinesOf(record)[0], '[Webhook] Kasil dilakokake (3 item, 12 ms)');
});

test('F3 a stoppedAt-less record stores nulls instead of fabricating a duration', () => {
	const record = buildExecutionLogRecord(
		{ ...sampleInput, status: 'running', stoppedAt: undefined, durationMs: undefined },
		runtimeFor('en'),
	);
	assert.equal(record.stoppedAt, null);
	assert.equal(record.durationMs, null);
	assert.equal(record.localized.summary, 'Running', 'a run without a summary key uses the status text');
	assert.equal(record.localized.missingKeys.length, 0);
	assert.equal(formatExecutionLogLine(record), 'EX-42 SMOKETEST001TEST [manual] Running');
});

/* --- F4 duration ------------------------------------------------------------------------ */

test('F4 durationBetween parses ISO timestamps and refuses unusable input', () => {
	assert.equal(durationBetween('2026-09-17T10:00:00.000Z', '2026-09-17T10:00:00.250Z'), 250);
	assert.equal(durationBetween('2026-09-17T10:00:00.000Z', '2026-09-17T10:00:00.000Z'), 0);
	assert.equal(durationBetween('2026-09-17T10:00:00.000Z', undefined), null);
	assert.equal(durationBetween('2026-09-17T10:00:00.000Z', ''), null);
	assert.equal(durationBetween('not-a-date', '2026-09-17T10:00:00.000Z'), null);
	assert.equal(durationBetween('2026-09-17T10:00:01.000Z', '2026-09-17T10:00:00.000Z'), null, 'negative deltas are refused');
});

test('F4 an explicit durationMs wins over the timestamps', () => {
	const record = buildExecutionLogRecord({ ...sampleInput, durationMs: 999 }, runtimeFor('en'));
	assert.equal(record.durationMs, 999);
	assert.equal(record.localized.summary, 'Finished in 999 ms — 2 node(s), 3 item(s)');
});

/* --- F5 envelope coherence -------------------------------------------------------------- */

test('F5 the record localized block is exactly the 4E envelope (no formatting drift)', () => {
	const rt = runtimeFor('ru');
	const record = buildExecutionLogRecord(sampleInput, rt);
	const envelope = buildRunEnvelope(
		{
			executionId: sampleInput.executionId,
			workflowName: sampleInput.workflowName,
			status: sampleInput.status,
			nodes: sampleInput.nodes,
			itemCount: sampleInput.itemCount,
			durationMs: 25,
			locale: 'ru',
		},
		runtimeFor('ru'),
	);
	assert.deepEqual([...nodeLinesOf(record)], [...envelope.nodeLines]);
	assert.deepEqual(record.localized.labels, envelope.labels);
	assert.equal(record.localized.message, envelope.message);
	assert.deepEqual([...record.localized.missingKeys], []);
});

test('F5 relocalizeNodeLine re-renders a node run for another locale without touching the record', () => {
	const record = buildExecutionLogRecord(sampleInput, runtimeFor('id'));
	const frozen = JSON.stringify(record);
	const line = relocalizeNodeLine(record.nodeRuns[0], runtimeFor('ar'), 'ar');
	assert.equal(line, '[Webhook] تم التنفيذ بنجاح (3 عنصر, 12 م.ث)');
	assert.equal(JSON.stringify(record), frozen, 'the record must not change when re-rendered');
});

/* --- F6/F7 summaries and triggers -------------------------------------------------------- */

test('F6 runSummary covers success/error/cancelled and never invents text for others', () => {
	const rt = runtimeFor('en');
	const parts = { duration: '25 ms', nodes: '2 node', items: '3 item' };
	assert.equal(runSummary('success', parts, rt).text, 'Finished in 25 ms — 2 node, 3 item');
	assert.equal(runSummary('error', parts, rt).text, 'Failed after 25 ms — 2 node, 3 item');
	assert.equal(runSummary('cancelled', parts, rt).text, 'Cancelled after 25 ms — 2 node, 3 item');
	for (const status of ['running', 'waiting']) {
		const result = runSummary(status, parts, rt);
		assert.equal(result.isSummary, false, `${status} must not pretend to be a summary`);
		assert.equal(result.messageKey, null);
		assert.notEqual(result.text, '', `${status} still yields a localized status text`);
		assert.deepEqual([...result.droppedParts], [], 'a status without a summary is not a partial summary');
	}
	assert.deepEqual(Object.keys(SUMMARY_MESSAGE_KEYS).sort(), ['cancelled', 'error', 'success']);
});

test('F6 summaries are localized per locale, with placeholders filled', () => {
	const parts = { duration: '25 ms', nodes: '2 node', items: '3 item' };
	const values = SUPPORTED_LOCALE_CODES.map((locale) => runSummary('success', parts, runtimeFor(locale), locale).text);
	assert.deepEqual(values, [
		'Selesai dalam 25 ms — 2 node, 3 item',
		'Finished in 25 ms — 2 node, 3 item',
		'Rampung sajrone 25 ms — 2 node, 3 item',
		'اكتمل في 25 ms — 2 node، 3 item',
		'已在 25 ms 内完成 — 2 node，3 item',
		'Завершено за 25 ms — 2 node, 3 item',
	]);
	for (const value of values) {
		assert.doesNotMatch(value, /\{|\}/, 'a summary must not keep placeholders');
	}
});

test('F6 labels supplied by the engine keep their own noun forms (no doubled nouns)', () => {
	const rt = runtimeFor('ru');
	const record = buildExecutionLogRecord(sampleInput, rt);
	assert.equal(record.localized.labels.nodes, '2 узел(ов)');
	assert.equal(record.localized.labels.items, '3 элемент(ов)');
	assert.equal(record.localized.summary, 'Завершено за 25 мс — 2 узел(ов), 3 элемент(ов)');
	assert.doesNotMatch(record.localized.summary, /узел.*узел|элемент.*элемент/, 'a noun must not be repeated');
});

test('F6 an incomplete run gets the lifecycle message instead of half a sentence', () => {
	const rt = runtimeFor('en');
	const partial = runSummary('error', { duration: '25 ms' }, rt);
	assert.equal(partial.text, 'Execution failed');
	assert.equal(partial.isSummary, false, 'a partial summary must not be presented as one');
	assert.equal(partial.messageKey, null);
	assert.deepEqual([...partial.droppedParts], ['nodes', 'items']);
	for (const text of [partial.text]) assert.doesNotMatch(text, /\{|\}|—\s*$/);

	const empty = runSummary('error', {}, rt);
	assert.equal(empty.text, 'Execution failed');
	assert.deepEqual([...empty.droppedParts], ['duration', 'nodes', 'items']);
	assert.deepEqual([...rt.getMissingKeys()], [], 'an incomplete run is not a vocabulary gap');

	const complete = runSummary('error', { duration: '25 ms', nodes: '2 node', items: '3 item' }, rt);
	assert.equal(complete.isSummary, true);
	assert.equal(complete.text, 'Failed after 25 ms — 2 node, 3 item');
	assert.deepEqual([...complete.droppedParts], []);
});

test('F7 trigger labels exist for every run mode in every locale', () => {
	for (const mode of RUN_MODES) {
		for (const locale of SUPPORTED_LOCALE_CODES) {
			const label = triggerLabel(mode, runtimeFor(locale), locale);
			assert.notEqual(label, TRIGGER_MESSAGE_KEYS[mode], `${locale}:${mode} fell back to the key`);
			assert.notEqual(label, mode, `${locale}:${mode} fell back to the raw mode`);
		}
	}
	assert.equal(triggerLabel('webhook', runtimeFor('id'), 'id'), 'Dipicu webhook');
	assert.equal(triggerLabel('schedule', runtimeFor('ru'), 'ru'), 'Запущено по расписанию');
	assert.deepEqual([...RUN_MODES], ['manual', 'webhook', 'schedule']);
	assert.equal(isKnownRunMode('manual'), true);
	assert.equal(isKnownRunMode('queue'), false);
});

test('F7 an unknown run mode is echoed and diagnosed, never guessed', () => {
	const rt = runtimeFor('en');
	assert.equal(triggerLabel('queue', rt), 'queue');
	assert.deepEqual([...rt.getMissingKeys()], ['execution.trigger.queue']);
});

test('F7 extra node states outside the 4E status map are localized', () => {
	assert.equal(nodeStateLabel('skipped', runtimeFor('id'), 'id'), 'Dilewati');
	assert.equal(nodeStateLabel('disabled', runtimeFor('zh'), 'zh'), '已禁用');
	const rt = runtimeFor('en');
	assert.equal(nodeStateLabel('paused', rt), 'node.status.paused');
	assert.deepEqual([...rt.getMissingKeys()], ['node.status.paused']);
});

/* --- F8 API errors ---------------------------------------------------------------------- */

test('F8 every error code maps to its reference HTTP status with localized message and hint', () => {
	const expectedStatus = { badRequest: 400, unauthorized: 401, notFound: 404, conflict: 409, internal: 500 };
	assert.deepEqual(HTTP_STATUS_BY_ERROR_CODE, expectedStatus);
	for (const code of API_ERROR_CODES) {
		for (const locale of SUPPORTED_LOCALE_CODES) {
			const response = buildApiErrorResponse({ code }, runtimeFor(locale));
			assert.equal(response.statusCode, HTTP_STATUS_BY_ERROR_CODE[code], `${code}/${locale} status`);
			assert.equal(response.body.code, code, `${code}/${locale} body.code`);
			assert.notEqual(response.body.message, code, `${code}/${locale} message is not localized`);
			assert.equal(response.localized.rawCode, code);
			assert.equal(response.localized.messageKey, `api.error.${code}`);
			assert.equal(response.localized.vocabularyHit, true);
			const hintKey = HINT_KEY_BY_ERROR_CODE[code];
			if (hintKey === null) {
				assert.equal(response.body.hint, undefined, `${code} must not carry a hint`);
			} else {
				assert.equal(typeof response.body.hint, 'string');
				assert.notEqual(response.body.hint, hintKey, `${code}/${locale} hint fell back to its key`);
			}
		}
	}
});

test('F8 an unknown error code degrades to the reference generic shape and keeps the raw code', () => {
	const rt = runtimeFor('ru');
	const response = buildApiErrorResponse({ code: 'teapot' }, rt);
	assert.equal(response.statusCode, 500);
	assert.equal(response.body.code, GENERIC_ERROR_CODE);
	assert.equal(response.body.code, 0);
	assert.equal(response.body.message, 'Внутренняя ошибка сервера');
	assert.equal(response.body.hint, undefined);
	assert.equal(response.localized.rawCode, 'teapot', 'the raw code must survive for diagnostics');
	assert.equal(response.localized.vocabularyHit, false, 'an unknown code has no vocabulary entry');
	assert.deepEqual([...rt.getMissingKeys()], [], 'a generic error is not a vocabulary gap');
});

test('F8 meta, stacktrace and status overrides follow the reference envelope', () => {
	const withMeta = buildApiErrorResponse(
		{ code: 'conflict', meta: { workflowId: 'WF-7' }, stacktrace: 'Error: boom\n  at x' },
		runtimeFor('en'),
	);
	assert.deepEqual(withMeta.body.meta, { workflowId: 'WF-7' });
	assert.match(withMeta.body.stacktrace ?? '', /Error: boom/);
	const overridden = buildApiErrorResponse({ code: 'badRequest', httpStatusCode: 422 }, runtimeFor('en'));
	assert.equal(overridden.statusCode, 422);
	assert.equal(overridden.body.code, 'badRequest');
	const raw = buildApiErrorResponse({ code: 'internal', rawMessage: 'Database is locked' }, runtimeFor('en'));
	assert.equal(raw.body.message, 'Database is locked', 'a caller-supplied message wins (it owns that text)');
});

/* --- F9 success + health ----------------------------------------------------------------- */

test('F9 the success envelope is exactly the reference `{ data }` wrapper', () => {
	assert.deepEqual(buildApiSuccessResponse({ count: 2, data: [] }), {
		statusCode: 200,
		body: { data: { count: 2, data: [] } },
	});
	assert.deepEqual(buildApiSuccessResponse(true).body, { data: true });
	assert.deepEqual(buildApiSuccessResponse(null).body, { data: null });
	assert.equal(buildApiSuccessResponse('x', 201).statusCode, 201);
});

test('F9 health keeps the machine field and adds a localized label', () => {
	const ready = buildHealthResponse('ready', runtimeFor('en'), 'en');
	assert.deepEqual(ready, { statusCode: 200, body: { status: 'ok', label: 'Healthy' } });
	const notReady = buildHealthResponse('not-ready', runtimeFor('id'), 'id');
	assert.equal(notReady.statusCode, 503);
	assert.equal(notReady.body.status, 'error', 'the reference field is never localized');
	assert.equal(notReady.body.label, 'Sehat');
	for (const locale of SUPPORTED_LOCALE_CODES) {
		assert.notEqual(buildHealthResponse('ready', runtimeFor(locale), locale).body.label, 'api.health.ok');
	}
});

test('F11 golden parity: reference payloads are reproducible field-for-field', () => {
	const REPO = join(PKG, '..', '..');
	const golden = JSON.parse(readFileSync(join(REPO, 'tests', 'reference', 'agent-4', 'golden', 'api.golden.json'), 'utf8'));

	// GET /healthz and /healthz/readiness — our body must keep the reference's machine field verbatim
	// and only *add* the localized label (an addition, never a rename).
	const ready = buildHealthResponse('ready', runtimeFor('en'), 'en');
	assert.equal(ready.statusCode, golden.cases.healthz.expected.status);
	assert.equal(ready.body.status, golden.cases.healthz.expected.body.status);
	assert.equal(golden.cases.healthz.expected.body.label, undefined, 'the reference has no label field');
	const down = buildHealthResponse('not-ready', runtimeFor('en'), 'en');
	assert.equal(down.statusCode, 503);
	assert.equal(down.body.status, 'error', 'the readiness failure field matches the 503 shape');

	// Unauthenticated: `contracts/api.contract.md` §3 calls this body out as the middleware layer,
	// "not the envelope" — but the envelope must agree on the status and the English text, and must
	// never grow the middleware's own `status` field.
	const unauth = buildApiErrorResponse({ code: 'unauthorized' }, runtimeFor('en'));
	assert.equal(unauth.statusCode, golden.cases.unauthenticated.expected.status);
	assert.equal(unauth.body.message, golden.cases.unauthenticated.expected.body.message);
	assert.equal('status' in unauth.body, false);

	// loginWrongPassword: the reference serializes `code: <errorCode || httpStatusCode>`, so a
	// ResponseError without an errorCode comes out with the numeric HTTP status as its code. The
	// caller owns that message text; the envelope is reproduced byte-for-byte.
	const login = buildApiErrorResponse({
		code: 401,
		httpStatusCode: 401,
		rawMessage: golden.cases.loginWrongPassword.expected.body.message,
	});
	assert.deepEqual(login.body, golden.cases.loginWrongPassword.expected.body);
	assert.equal(login.statusCode, golden.cases.loginWrongPassword.expected.status);
	assert.equal(login.localized.rawCode, '401');
	assert.equal(login.localized.vocabularyHit, false, 'a numeric code has no vocabulary entry');

	// loginValidationError: the raw zod issue object is the validator's body, not this module's — the
	// contract is where that split is recorded, so assert the record exists.
	const contractSource = readFileSync(join(REPO, 'contracts', 'api.contract.md'), 'utf8');
	assert.match(contractSource, /Zod validation failure/);
	assert.match(contractSource, /invalid_type/);
});

/* --- F10 isolation ---------------------------------------------------------------------- */

test('F10 Phase 4B and 4E data are never mutated by the run path', () => {
	const before4b = JSON.stringify(NATIVE_DICTIONARIES);
	const before4e = JSON.stringify(ENVELOPE_DICTIONARY_EXTENSION);
	const before4f = JSON.stringify(PRODUCT_DICTIONARY_EXTENSION);
	buildExecutionLogRecord(sampleInput, runtimeFor('jv'));
	buildApiErrorResponse({ code: 'unauthorized' }, runtimeFor('ar'));
	buildHealthResponse('ready');
	assert.equal(JSON.stringify(NATIVE_DICTIONARIES), before4b);
	assert.equal(JSON.stringify(ENVELOPE_DICTIONARY_EXTENSION), before4e);
	assert.equal(JSON.stringify(PRODUCT_DICTIONARY_EXTENSION), before4f);
	assert.equal(NativeLocalizationService.translate('execution.summary.ok', 'en'), 'execution.summary.ok');
});

test('F10 runtimes built by the product factory do not share locale state', () => {
	const a = runtimeFor('id');
	const b = runtimeFor('zh');
	assert.equal(buildExecutionLogRecord(sampleInput, a).localized.locale, 'id');
	assert.equal(buildExecutionLogRecord(sampleInput, b).localized.locale, 'zh');
	assert.equal(a.getLocale(), 'id');
	assert.equal(NativeLocalizationService.getLocale(), 'id');
});

test('F10 the run path is clock-free, env-free and imports only in-package modules', () => {
	for (const file of ['execution-log-record.ts', 'api-error-response.ts', 'localization-vocabulary.ts']) {
		const source = readFileSync(join(PKG, 'src', file), 'utf8');
		assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/, `${file} must not read the clock`);
		assert.doesNotMatch(source, /process\.env/, `${file} must not read the environment`);
		assert.doesNotMatch(source, /globalThis/, `${file} must not use global mutable state`);
		const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);
		for (const specifier of specifiers) {
			assert.match(specifier, /^\.\//, `${file} imports "${specifier}" which is not in-package`);
			assert.match(specifier, /\.ts$/, `${file} must use an explicit .ts specifier for ${specifier}`);
		}
	}
});

test('F10 records and responses are JSON-safe and deterministic', () => {
	const first = buildExecutionLogRecord(sampleInput, runtimeFor('ru'));
	const second = buildExecutionLogRecord(sampleInput, runtimeFor('ru'));
	assert.equal(JSON.stringify(first), JSON.stringify(second));
	const roundTripped = JSON.parse(JSON.stringify(first));
	assert.deepEqual(roundTripped, JSON.parse(JSON.stringify(second)));
	const response = buildApiErrorResponse({ code: 'notFound', meta: { id: 7 } }, runtimeFor('ru'));
	assert.deepEqual(JSON.parse(JSON.stringify(response)).body, { code: 'notFound', message: 'Не найдено', meta: { id: 7 } });
});
