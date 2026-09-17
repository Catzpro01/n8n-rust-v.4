/**
 * Phase 4E — Localization envelope: the CONSUMER seam of the native localization line.
 *
 * Phase 4A decides the language, 4B owns the catalog + product dictionaries, 4C/4D provide the
 * runtime and put it on the package surface. 4E is where the reconstructed backend actually uses it:
 *
 *   * run data      — the per-execution block the execution logger persists (`snapshot()` + messages)
 *   * node status   — one localized line per node run for the run log
 *   * API envelope  — the `code -> localized text` mapping for error responses and health
 *   * CLI/tooling   — `node tools/localization-inspect.mjs --envelope` prints exactly this shape
 *
 * BOUNDARY (contracts/localization.contract.md §4.9, §10)
 *   owns         : envelope shape, engine/API vocabulary EXTENSION, per-run message assembly,
 *                  node status lines, API error-code mapping
 *   does NOT own : dictionaries/catalog (4B), the runtime semantics (4C), settings (4A),
 *                  HTTP transport, the editor UI, or which locale a run uses (the runtime resolves it)
 *
 * IMPORTS: exactly two — the runtime and the service, both inside this package, both with an
 * explicit `.ts` specifier so the module runs under `node --test` with no build step (Node's ESM
 * loader has no extensionless/directory resolution; `allowImportingTsExtensions` in tsconfig.json
 * keeps `npm run typecheck` happy). Anything else (transport, logger, database, node core) is
 * injected as data, so no new dependency edge appears between LEGOs. Gate check G11 asserts the
 * import list from the source text.
 *
 * RUST: none. Erasable-syntax TypeScript only (runs directly under `node --test`).
 */

import {
	FALLBACK_LOCALE,
	LocalizationRuntime,
	SUPPORTED_LOCALE_CODES,
	createLocalizationRuntime,
	dictionaryParity,
	mergeOverlays,
	type DictionaryParityReport,
	type ExecutionStatus,
	type InterpolationParams,
	type LocalizationOptions,
} from './localization-runtime.ts';
import { NativeLocalizationService } from './backend-localization-service.ts';

/* ------------------------------------------------------------------------------------------------------------------ *
 * Vocabulary extension — engine/API strings that Phase 4B does not ship.
 * Kept here (not edited into 4B) so the catalogue file stays frozen and the parity rules below are
 * provable: identical key sets in all six locales, no empty values.
 * ------------------------------------------------------------------------------------------------------------------ */

export const ENVELOPE_DICTIONARY_EXTENSION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	id: {
		'execution.started': 'Eksekusi dimulai',
		'execution.finished': 'Eksekusi selesai',
		'execution.failed': 'Eksekusi gagal',
		'execution.cancelled': 'Eksekusi dibatalkan',
		'execution.waiting': 'Eksekusi menunggu',
		'run.items': '{count} item',
		'run.nodes': '{count} node',
		'run.duration': '{ms} ms',
		'api.health.ok': 'Sehat',
		'api.error.badRequest': 'Permintaan tidak valid',
		'api.error.unauthorized': 'Tidak diizinkan',
		'api.error.notFound': 'Tidak ditemukan',
		'api.error.conflict': 'Konflik data',
		'api.error.internal': 'Kesalahan internal server',
	},
	en: {
		'execution.started': 'Execution started',
		'execution.finished': 'Execution finished',
		'execution.failed': 'Execution failed',
		'execution.cancelled': 'Execution cancelled',
		'execution.waiting': 'Execution waiting',
		'run.items': '{count} item(s)',
		'run.nodes': '{count} node(s)',
		'run.duration': '{ms} ms',
		'api.health.ok': 'Healthy',
		'api.error.badRequest': 'Bad request',
		'api.error.unauthorized': 'Unauthorized',
		'api.error.notFound': 'Not found',
		'api.error.conflict': 'Conflict',
		'api.error.internal': 'Internal server error',
	},
	jv: {
		'execution.started': 'Eksekusi diwiwiti',
		'execution.finished': 'Eksekusi rampung',
		'execution.failed': 'Eksekusi gagal',
		'execution.cancelled': 'Eksekusi dibatalake',
		'execution.waiting': 'Eksekusi ngenteni',
		'run.items': '{count} item',
		'run.nodes': '{count} node',
		'run.duration': '{ms} ms',
		'api.health.ok': 'Sehat',
		'api.error.badRequest': 'Panjalukan ora sah',
		'api.error.unauthorized': 'Ora diidini',
		'api.error.notFound': 'Ora ditemokake',
		'api.error.conflict': 'Konflik data',
		'api.error.internal': 'Kesalahan internal server',
	},
	ar: {
		'execution.started': 'بدأ التنفيذ',
		'execution.finished': 'انتهى التنفيذ',
		'execution.failed': 'فشل التنفيذ',
		'execution.cancelled': 'أُلغي التنفيذ',
		'execution.waiting': 'التنفيذ في الانتظار',
		'run.items': '{count} عنصر',
		'run.nodes': '{count} عقدة',
		'run.duration': '{ms} م.ث',
		'api.health.ok': 'سليم',
		'api.error.badRequest': 'طلب غير صالح',
		'api.error.unauthorized': 'غير مصرح',
		'api.error.notFound': 'غير موجود',
		'api.error.conflict': 'تعارض في البيانات',
		'api.error.internal': 'خطأ داخلي في الخادم',
	},
	zh: {
		'execution.started': '执行已开始',
		'execution.finished': '执行已完成',
		'execution.failed': '执行失败',
		'execution.cancelled': '执行已取消',
		'execution.waiting': '执行等待中',
		'run.items': '{count} 个项目',
		'run.nodes': '{count} 个节点',
		'run.duration': '{ms} 毫秒',
		'api.health.ok': '运行正常',
		'api.error.badRequest': '请求无效',
		'api.error.unauthorized': '未授权',
		'api.error.notFound': '未找到',
		'api.error.conflict': '数据冲突',
		'api.error.internal': '服务器内部错误',
	},
	ru: {
		'execution.started': 'Выполнение начато',
		'execution.finished': 'Выполнение завершено',
		'execution.failed': 'Выполнение не удалось',
		'execution.cancelled': 'Выполнение отменено',
		'execution.waiting': 'Выполнение ожидает',
		'run.items': '{count} элемент(ов)',
		'run.nodes': '{count} узел(ов)',
		'run.duration': '{ms} мс',
		'api.health.ok': 'Работает',
		'api.error.badRequest': 'Некорректный запрос',
		'api.error.unauthorized': 'Не авторизовано',
		'api.error.notFound': 'Не найдено',
		'api.error.conflict': 'Конфликт данных',
		'api.error.internal': 'Внутренняя ошибка сервера',
	},
} as const;

/** Extension keys of a given locale (canonical order: as written above). */
export function extensionKeys(locale: string = FALLBACK_LOCALE): readonly string[] {
	return Object.keys(ENVELOPE_DICTIONARY_EXTENSION[locale] ?? {});
}

/** Build a runtime that speaks the full engine/API vocabulary: 4B dictionaries + 4C overlay + 4E extension. */
export function createEnvelopeRuntime(options: LocalizationOptions = {}): LocalizationRuntime {
	return createLocalizationRuntime({
		dictionaries: NativeLocalizationService,
		...options,
		overlay: mergeOverlays(
			ENVELOPE_DICTIONARY_EXTENSION as Record<string, Record<string, string>>,
			options.overlay,
		),
	});
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Execution lifecycle messages
 * ------------------------------------------------------------------------------------------------------------------ */

/** Lifecycle phases of a run, in the order the execution logger emits them. */
export const EXECUTION_LIFECYCLE: readonly ExecutionStatus[] = ['running', 'success', 'error', 'waiting', 'cancelled'];

/** Message key reported for each lifecycle phase. */
export const EXECUTION_MESSAGE_KEYS: Readonly<Record<ExecutionStatus, string>> = {
	success: 'execution.finished',
	error: 'execution.failed',
	cancelled: 'execution.cancelled',
	running: 'execution.started',
	waiting: 'execution.waiting',
};

/* ------------------------------------------------------------------------------------------------------------------ *
 * Node status lines
 * ------------------------------------------------------------------------------------------------------------------ */

export interface NodeRunResult {
	/** Node name as it appears in the workflow. */
	readonly nodeName: string;
	/** Outcome of the node run. */
	readonly status: ExecutionStatus;
	/** Number of items leaving the node, when known. */
	readonly itemCount?: number;
	/** Wall-clock duration in milliseconds, when known. */
	readonly durationMs?: number;
}

export interface LocalizedNodeStatusLine {
	readonly nodeName: string;
	readonly status: ExecutionStatus;
	/** Localized status text, e.g. "Gagal dieksekusi". */
	readonly statusText: string;
	/** Localized item count, e.g. "3 item" — absent when the run reported no count. */
	readonly itemsText?: string;
	/** Localized duration, e.g. "12 ms" — absent when the run reported no duration. */
	readonly durationText?: string;
	/** One-line rendering for human logs: `[Webhook] Gagal dieksekusi (3 item, 12 ms)`. */
	readonly line: string;
}

/** Localize one node run into a status line. Never throws, never invents text. */
export function localizeNodeStatus(
	result: NodeRunResult,
	runtime: LocalizationRuntime,
	locale?: string,
): LocalizedNodeStatusLine {
	const statusText = runtime.tStatus(result.status, undefined, locale);
	const itemsText =
		result.itemCount === undefined
			? undefined
			: runtime.t('run.items', { count: result.itemCount }, locale);
	const durationText =
		result.durationMs === undefined
			? undefined
			: runtime.t('run.duration', { ms: result.durationMs }, locale);

	const extras = [itemsText, durationText].filter((v): v is string => typeof v === 'string');
	const line = `[${result.nodeName}] ${statusText}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;

	return { nodeName: result.nodeName, status: result.status, statusText, itemsText, durationText, line };
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * API error envelope
 * ------------------------------------------------------------------------------------------------------------------ */

/** Error codes the reconstructed API can return; the key is `api.error.<code>`. */
export const API_ERROR_CODES = [
	'badRequest',
	'unauthorized',
	'notFound',
	'conflict',
	'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface LocalizedApiError {
	readonly code: string;
	readonly messageKey: string;
	readonly message: string;
	/** `true` when the code has no vocabulary — the caller sees the raw code, and diagnostics record it. */
	readonly fallbackUsed: boolean;
}

/** Map an API error code to localized text. Unknown codes are echoed and diagnosed, never invented. */
export function localizeApiError(
	code: string,
	runtime: LocalizationRuntime,
	params?: InterpolationParams,
	locale?: string,
): LocalizedApiError {
	const messageKey = `api.error.${code}`;
	const known = runtime.has(messageKey, locale);
	const message = runtime.t(messageKey, params, locale);
	return {
		code,
		messageKey,
		message: known ? message : code,
		fallbackUsed: !known,
	};
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Run envelope
 * ------------------------------------------------------------------------------------------------------------------ */

export interface RunEnvelopeInput {
	readonly executionId: string;
	readonly workflowName: string;
	readonly status: ExecutionStatus;
	/** Per-node results, in execution order. */
	readonly nodes?: readonly NodeRunResult[];
	/** Total items that passed through the run, when known. */
	readonly itemCount?: number;
	/** Total duration in milliseconds, when known. */
	readonly durationMs?: number;
	/** Explicit locale override for this run (otherwise the runtime resolves it). */
	readonly locale?: string;
}

export interface RunEnvelope {
	readonly executionId: string;
	readonly workflowName: string;
	readonly status: ExecutionStatus;
	readonly locale: string;
	readonly direction: 'ltr' | 'rtl';
	readonly message: string;
	readonly messages: {
		readonly started: string;
		readonly finished: string;
		readonly failed: string;
		readonly cancelled: string;
		readonly waiting: string;
	};
	readonly labels: {
		readonly items?: string;
		readonly nodes?: string;
		readonly duration?: string;
	};
	readonly nodeStatusLines: readonly LocalizedNodeStatusLine[];
	readonly nodeLines: readonly string[];
	readonly fallbackLocale: string;
	readonly supportedLocales: readonly string[];
	readonly diagnostics: {
		readonly missingKeys: readonly string[];
	};
}

/**
 * Assemble the run-data block an execution logger persists and an API response can embed.
 *
 * Deterministic: no clock, no randomness, key order fixed. Diagnostics are read AFTER assembly and
 * reported, never swallowed (`missingKeys` is how a gap in the vocabulary surfaces in run data).
 */
export function buildRunEnvelope(
	input: RunEnvelopeInput,
	runtime: LocalizationRuntime,
): RunEnvelope {
	const locale = runtime.resolveLocale(input.locale);
	const nodes = input.nodes ?? [];

	const messages = {
		started: runtime.t(EXECUTION_MESSAGE_KEYS.running, undefined, locale),
		finished: runtime.t(EXECUTION_MESSAGE_KEYS.success, undefined, locale),
		failed: runtime.t(EXECUTION_MESSAGE_KEYS.error, undefined, locale),
		cancelled: runtime.t(EXECUTION_MESSAGE_KEYS.cancelled, undefined, locale),
		waiting: runtime.t(EXECUTION_MESSAGE_KEYS.waiting, undefined, locale),
	};

	const labels: { items?: string; nodes?: string; duration?: string } = {};
	if (input.itemCount !== undefined) labels.items = runtime.t('run.items', { count: input.itemCount }, locale);
	if (nodes.length > 0) labels.nodes = runtime.t('run.nodes', { count: nodes.length }, locale);
	if (input.durationMs !== undefined) labels.duration = runtime.t('run.duration', { ms: input.durationMs }, locale);

	const nodeStatusLines = nodes.map((node) => localizeNodeStatus(node, runtime, locale));

	return {
		executionId: input.executionId,
		workflowName: input.workflowName,
		status: input.status,
		locale,
		direction: runtime.getDirection(locale),
		message: runtime.t(EXECUTION_MESSAGE_KEYS[input.status], undefined, locale),
		messages,
		labels,
		nodeStatusLines,
		nodeLines: nodeStatusLines.map((line) => line.line),
		fallbackLocale: runtime.snapshot().fallbackLocale,
		supportedLocales: [...SUPPORTED_LOCALE_CODES],
		diagnostics: { missingKeys: runtime.getMissingKeys() },
	};
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Diagnostics helpers
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Parity report of the engine/API vocabulary (Phase 4B dictionaries are NOT included: they have their
 * own parity check in `dictionaryParity(NATIVE_DICTIONARIES, 'en')`).
 */
export function envelopeDictionaryParity(
	referenceLocale: string = FALLBACK_LOCALE,
): DictionaryParityReport {
	return dictionaryParity(
		ENVELOPE_DICTIONARY_EXTENSION as Record<string, Record<string, string>>,
		referenceLocale,
	);
}

/** Locales with vocabulary coverage: the intersection of the 4B catalog and this extension. */
export function envelopeLocales(): readonly string[] {
	const extensionLocales = Object.keys(ENVELOPE_DICTIONARY_EXTENSION);
	return SUPPORTED_LOCALE_CODES.filter((code) => extensionLocales.includes(code));
}
