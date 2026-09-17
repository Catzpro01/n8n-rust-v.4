#!/usr/bin/env node
/**
 * Native localization inspector — a runnable view of the promoted (Phase 4D) surface.
 *
 * The point is not the pretty output: it is that the package surface can be *executed* from a
 * checkout, with no build step and no dependencies, and that what it prints is exactly what the
 * gate verifies. `tools/localization-gate.mjs` runs this binary as check G9.
 *
 * usage:
 *   node tools/localization-inspect.mjs [--lang <tag>] [--key <k>] [--text <t>] [--param k=v]
 *                                       [--envelope] [--status <s>] [--json]
 *
 *   node tools/localization-inspect.mjs                                  # full catalog table
 *   node tools/localization-inspect.mjs --lang jv --key settings.title    # one string
 *   node tools/localization-inspect.mjs --text "Node {name} selesai" --param name=Webhook
 *   node tools/localization-inspect.mjs --lang ar --envelope              # run-data block (Phase 4E)
 *   node tools/localization-inspect.mjs --lang id --record                # persisted run record (Phase 4F)
 *   node tools/localization-inspect.mjs --lang ru --api-error unauthorized # localized API error (Phase 4F)
 *
 * exit: 0 ok · 2 unusable arguments/locale
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	LOCALE_CATALOG,
	STATUS_MESSAGE_KEYS,
	SUPPORTED_LOCALE_CODES,
	createLocalizationRuntime,
	directionOf,
	normalizeLocale,
} from '../packages/workflow-lego/src/localization-runtime.ts';
import { NativeLocalizationService } from '../packages/workflow-lego/src/backend-localization-service.ts';
import {
	API_ERROR_CODES,
	buildRunEnvelope,
	createEnvelopeRuntime,
	extensionKeys,
	localizeApiError,
} from '../packages/workflow-lego/src/localization-envelope.ts';
import {
	buildExecutionLogRecord,
	formatExecutionLogLine,
} from '../packages/workflow-lego/src/execution-log-record.ts';
import {
	buildApiErrorResponse,
	buildApiSuccessResponse,
	buildHealthResponse,
} from '../packages/workflow-lego/src/api-error-response.ts';
import { createProductRuntime } from '../packages/workflow-lego/src/localization-vocabulary.ts';

const argv = process.argv.slice(2);
const flag = (name) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);
const params = {};
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--param') {
		const [k, ...rest] = (argv[i + 1] ?? '').split('=');
		if (k) params[k] = rest.join('=');
	}
}

const runtime = createLocalizationRuntime({
	dictionaries: NativeLocalizationService,
	fallbackLocale: 'en',
});
const envelopeRuntime = createEnvelopeRuntime({ fallbackLocale: 'en' });

const requested = flag('lang');
let locale = runtime.getLocale();
if (requested !== undefined) {
	const normalized = normalizeLocale(requested);
	if (normalized === null) {
		console.error(
			`error: unsupported locale "${requested}" — supported: ${SUPPORTED_LOCALE_CODES.join(', ')}`,
		);
		process.exit(2);
	}
	locale = normalized;
}

const json = has('json');
const emit = (payload, lines) => {
	if (json) {
		console.log(JSON.stringify(payload, null, 2));
		return;
	}
	for (const line of lines) console.log(line);
};

/* --- run envelope (Phase 4E) ------------------------------------------------------------ */
if (has('envelope')) {
	const status = flag('status') ?? 'success';
	const envelope = buildRunEnvelope(
		{
			executionId: flag('execution') ?? 'EX-DEMO-01',
			workflowName: flag('workflow') ?? 'SMOKETEST001TEST',
			status,
			locale,
			itemCount: Number(flag('items') ?? 3),
			durationMs: Number(flag('duration') ?? 25),
			nodes: [
				{ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 },
				{ nodeName: 'Code', status },
			],
		},
		envelopeRuntime,
	);
	const apiErrors = API_ERROR_CODES.map((code) => localizeApiError(code, envelopeRuntime, undefined, locale));
	const payload = { envelope, vocabulary: extensionKeys('en').length, apiErrors };
	if (json) {
		console.log(JSON.stringify(payload, null, 2));
	} else {
		console.log(`run envelope — ${envelope.locale} (${envelope.direction})  status=${envelope.status}`);
		console.log(`  message     : ${envelope.message}`);
		console.log(`  labels      : ${JSON.stringify(envelope.labels)}`);
		for (const line of envelope.nodeLines) console.log(`  node        : ${line}`);
		for (const error of apiErrors) console.log(`  api error   : ${error.code} -> ${error.message}`);
		console.log(`  diagnostics : ${envelope.diagnostics.missingKeys.length} missing key(s)`);
	}
	process.exit(0);
}

/* --- persisted run record (Phase 4F) ---------------------------------------------------- */
if (has('record')) {
	const runtime = createProductRuntime({ localeSource: { getLocale: () => locale } });
	const record = buildExecutionLogRecord(
		{
			executionId: flag('execution') ?? 'EX-DEMO-01',
			workflowId: flag('workflow-id') ?? 'WF-DEMO-01',
			workflowName: flag('workflow') ?? 'SMOKETEST001TEST',
			mode: flag('mode') ?? 'webhook',
			status: flag('status') ?? 'success',
			startedAt: '2026-09-17T10:00:00.000Z',
			stoppedAt: '2026-09-17T10:00:00.025Z',
			itemCount: Number(flag('items') ?? 3),
			nodes: [
				{ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 },
				{ nodeName: 'Code', status: 'success' },
			],
		},
		runtime,
	);
	if (json) {
		console.log(JSON.stringify(record, null, 2));
	} else {
		console.log(`execution record — ${record.localized.locale} (${record.localized.direction})`);
		console.log(`  line        : ${formatExecutionLogLine(record)}`);
		console.log(`  trigger     : ${record.localized.trigger}`);
		console.log(`  message     : ${record.localized.message}`);
		console.log(`  duration    : ${record.durationMs} ms (from timestamps)`);
		for (const line of record.localized.nodeLines) console.log(`  node        : ${line}`);
		console.log(`  diagnostics : ${record.localized.missingKeys.length} missing key(s)`);
	}
	process.exit(0);
}

/* --- API response (Phase 4F) ------------------------------------------------------------ */
const apiErrorCode = flag('api-error');
if (apiErrorCode !== undefined) {
	const runtime = createProductRuntime({ localeSource: { getLocale: () => locale } });
	const error = buildApiErrorResponse({ code: apiErrorCode }, runtime);
	const health = buildHealthResponse('ready', runtime, locale);
	const success = buildApiSuccessResponse({ executionId: flag('execution') ?? 'EX-DEMO-01' });
	if (json) {
		console.log(JSON.stringify({ error, success, health }, null, 2));
	} else {
		console.log(`api error   — ${error.localized.locale}  HTTP ${error.statusCode}`);
		console.log(`  body        : ${JSON.stringify(error.body)}`);
		console.log(`  messageKey  : ${error.localized.messageKey} (hint: ${error.localized.hintKey ?? 'none'})`);
		console.log(`  rawCode     : ${error.localized.rawCode}${error.localized.vocabularyHit ? '' : ' (not in vocabulary -> generic shape)'}`);
		console.log(`  success     : ${success.statusCode} ${JSON.stringify(success.body)}`);
		console.log(`  health      : ${health.statusCode} ${JSON.stringify(health.body)}`);
	}
	process.exit(0);
}

/* --- single key ------------------------------------------------------------------------ */
const key = flag('key');
if (key !== undefined) {
	const value = runtime.t(key, params, locale);
	emit(
		{ locale, direction: directionOf(locale), key, value, missing: runtime.getMissingKeys() },
		[`${locale} (${directionOf(locale)})  ${key} = ${value}`],
	);
	process.exit(0);
}

/* --- raw template ---------------------------------------------------------------------- */
const text = flag('text');
if (text !== undefined) {
	// A template that is not a dictionary key still interpolates: t() falls back to the key
	// itself, so this is the same code path the engine uses for overlay/dictionary strings.
	const value = runtime.t(text, params, locale);
	emit({ locale, direction: directionOf(locale), template: text, value, params }, [value]);
	process.exit(0);
}

/* --- catalog overview -------------------------------------------------------------------- */
const rows = LOCALE_CATALOG.map((entry) => {
	const rtl = entry.direction === 'rtl' ? 'RTL' : 'LTR';
	return {
		code: entry.code,
		nativeName: entry.nativeName,
		name: entry.name,
		direction: entry.direction,
		sample: runtime.t('settings.title', undefined, entry.code),
		statusSuccess: runtime.tStatus('success', undefined, entry.code),
		statusRunning: runtime.tStatus('running', undefined, entry.code),
		rtl,
	};
});

const shared = {
	tool: fileURLToPath(import.meta.url).replace(`${join(dirname(fileURLToPath(import.meta.url)), '..')}/`, ''),
	activeLocale: locale,
	fallbackLocale: 'en',
	supportedLocales: [...SUPPORTED_LOCALE_CODES],
	statusKeys: { ...STATUS_MESSAGE_KEYS },
	locales: rows,
};

emit(shared, [
	`native localization — ${shared.tool}`,
	`active: ${locale}   fallback: en   locales: ${SUPPORTED_LOCALE_CODES.join(', ')}`,
	'',
	'code  direction  locale              settings.title     node.success',
	'----  ---------  ------------------  -----------------  ------------------------',
	...rows.map(
		(r) =>
			`${r.code.padEnd(4)}  ${r.direction.padEnd(9)}  ${r.nativeName.padEnd(18)}  ${r.sample.padEnd(17)}  ${r.statusSuccess}`,
	),
]);
