#!/usr/bin/env node
/**
 * Native localization inspector — a runnable view of the promoted (Phase 4D) surface.
 *
 * The point is not the pretty output: it is that the package surface can be *executed* from a
 * checkout, with no build step and no dependencies, and that what it prints is exactly what the
 * gate verifies. `tools/localization-gate.mjs` runs this binary as check G9.
 *
 * usage:
 *   node tools/localization-inspect.mjs [--lang <tag>] [--key <k>] [--text <template>] [--param k=v] [--json]
 *
 *   node tools/localization-inspect.mjs                                  # full catalog table
 *   node tools/localization-inspect.mjs --lang jv --key settings.title    # one string
 *   node tools/localization-inspect.mjs --text "Node {name} selesai" --param name=Webhook
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
