/**
 * Phase 4F — Product & API-hint vocabulary (third vocabulary owner).
 *
 * Vocabulary ownership across the localization line, deliberately split so that no file has to be
 * rewritten by another phase:
 *
 *   Phase 4B  `backend-localization-service.ts`   the frozen product catalogue (9 keys, 6 locales)
 *   Phase 4E  `localization-envelope.ts`          engine/API error vocabulary (14 keys)
 *   Phase 4F  `localization-vocabulary.ts` (this) run summaries, trigger labels, extra node states,
 *                                                 API *hints* (12 keys)
 *
 * Everything here is additive: Phase 4B is never edited, and every key set is parity-checked in all
 * six locales by gate checks G10 (4E) and G14 (this file).
 *
 * BOUNDARY: this module imports three in-package modules — the runtime (4C), the product catalogue
 * (4B) and the engine/API vocabulary (4E) — and composes them into one runtime. No dependency edge
 * between LEGOs is added, no environment variable is read, and no global mutable state is used (the
 * gate asserts all three from the source text).
 *
 * RUST: none. Erasable-syntax TypeScript only.
 */

import {
	FALLBACK_LOCALE,
	createLocalizationRuntime,
	hasUnfilledPlaceholder,
	mergeOverlays,
	type LocalizationOptions,
	type LocalizationRuntime,
} from './localization-runtime.ts';
import { NativeLocalizationService } from './backend-localization-service.ts';
import { ENVELOPE_DICTIONARY_EXTENSION } from './localization-envelope.ts';

/* ------------------------------------------------------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Product strings for run records and API hints.
 *
 * Placeholders: `{duration}`, `{nodes}`, `{items}` — filled by `runSummary()`, so a caller formats
 * only the parts and never concatenates translations by hand.
 */
export const PRODUCT_DICTIONARY_EXTENSION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	id: {
		'execution.summary.ok': 'Selesai dalam {duration} — {nodes}, {items}',
		'execution.summary.error': 'Gagal dalam {duration} — {nodes}, {items}',
		'execution.summary.cancelled': 'Dibatalkan setelah {duration} — {nodes}, {items}',
		'execution.trigger.manual': 'Dipicu manual',
		'execution.trigger.webhook': 'Dipicu webhook',
		'execution.trigger.schedule': 'Dipicu jadwal',
		'node.status.skipped': 'Dilewati',
		'node.status.disabled': 'Dinonaktifkan',
		'api.hint.retry': 'Coba lagi beberapa saat lagi',
		'api.hint.credentials': 'Periksa kembali kredensial yang dipakai',
		'api.hint.permission': 'Hubungi administrator workspace',
		'api.hint.payload': 'Periksa kembali isi permintaan',
	},
	en: {
		'execution.summary.ok': 'Finished in {duration} — {nodes}, {items}',
		'execution.summary.error': 'Failed after {duration} — {nodes}, {items}',
		'execution.summary.cancelled': 'Cancelled after {duration} — {nodes}, {items}',
		'execution.trigger.manual': 'Triggered manually',
		'execution.trigger.webhook': 'Triggered by webhook',
		'execution.trigger.schedule': 'Triggered by schedule',
		'node.status.skipped': 'Skipped',
		'node.status.disabled': 'Disabled',
		'api.hint.retry': 'Retry in a moment',
		'api.hint.credentials': 'Check the credentials in use',
		'api.hint.permission': 'Ask a workspace administrator',
		'api.hint.payload': 'Check the request payload',
	},
	jv: {
		'execution.summary.ok': 'Rampung sajrone {duration} — {nodes}, {items}',
		'execution.summary.error': 'Gagal sawise {duration} — {nodes}, {items}',
		'execution.summary.cancelled': 'Dibatalake sawise {duration} — {nodes}, {items}',
		'execution.trigger.manual': 'Dipicu manual',
		'execution.trigger.webhook': 'Dipicu webhook',
		'execution.trigger.schedule': 'Dipicu jadwal',
		'node.status.skipped': 'Dilewati',
		'node.status.disabled': 'Dipateni',
		'api.hint.retry': 'Coba maneh sedhela',
		'api.hint.credentials': 'Priksa maneh kredensial sing dipigunakake',
		'api.hint.permission': 'Hubungi admin workspace',
		'api.hint.payload': 'Priksa maneh isine panjalukan',
	},
	ar: {
		'execution.summary.ok': 'اكتمل في {duration} — {nodes}، {items}',
		'execution.summary.error': 'فشل بعد {duration} — {nodes}، {items}',
		'execution.summary.cancelled': 'أُلغي بعد {duration} — {nodes}، {items}',
		'execution.trigger.manual': 'تم التشغيل يدويًا',
		'execution.trigger.webhook': 'تم التشغيل عبر ويب هوك',
		'execution.trigger.schedule': 'تم التشغيل بالجدولة',
		'node.status.skipped': 'تم التخطي',
		'node.status.disabled': 'معطّل',
		'api.hint.retry': 'أعد المحاولة بعد قليل',
		'api.hint.credentials': 'تحقق من بيانات الاعتماد المستخدمة',
		'api.hint.permission': 'تواصل مع مسؤول مساحة العمل',
		'api.hint.payload': 'تحقق من محتوى الطلب',
	},
	zh: {
		'execution.summary.ok': '已在 {duration} 内完成 — {nodes}，{items}',
		'execution.summary.error': '在 {duration} 后失败 — {nodes}，{items}',
		'execution.summary.cancelled': '在 {duration} 后取消 — {nodes}，{items}',
		'execution.trigger.manual': '手动触发',
		'execution.trigger.webhook': '由 Webhook 触发',
		'execution.trigger.schedule': '由计划触发',
		'node.status.skipped': '已跳过',
		'node.status.disabled': '已禁用',
		'api.hint.retry': '请稍后重试',
		'api.hint.credentials': '请检查使用的凭据',
		'api.hint.permission': '请联系工作区管理员',
		'api.hint.payload': '请检查请求内容',
	},
	ru: {
		'execution.summary.ok': 'Завершено за {duration} — {nodes}, {items}',
		'execution.summary.error': 'Ошибка после {duration} — {nodes}, {items}',
		'execution.summary.cancelled': 'Отменено через {duration} — {nodes}, {items}',
		'execution.trigger.manual': 'Запущено вручную',
		'execution.trigger.webhook': 'Запущено веб-хуком',
		'execution.trigger.schedule': 'Запущено по расписанию',
		'node.status.skipped': 'Пропущено',
		'node.status.disabled': 'Отключено',
		'api.hint.retry': 'Повторите попытку позже',
		'api.hint.credentials': 'Проверьте используемые учётные данные',
		'api.hint.permission': 'Обратитесь к администратору рабочего пространства',
		'api.hint.payload': 'Проверьте полезную нагрузку запроса',
	},
} as const;

/** Vocabulary keys of a locale, in declaration order. */
export function productKeys(locale: string = FALLBACK_LOCALE): readonly string[] {
	return Object.keys(PRODUCT_DICTIONARY_EXTENSION[locale] ?? {});
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Runtime factory + helpers
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * The runtime used by the Phase 4F run path: Phase 4B product catalogue + Phase 4E engine/API
 * vocabulary + this file's product strings. Later overlays win, so a caller can still override.
 *
 * Composed explicitly (never through module-level mutable state): the 4E vocabulary is imported,
 * not looked up, so two runtimes can hold different overlays without influencing each other.
 */
export function createProductRuntime(options: LocalizationOptions = {}): LocalizationRuntime {
	return createLocalizationRuntime({
		dictionaries: NativeLocalizationService,
		...options,
		overlay: mergeOverlays(
			ENVELOPE_DICTIONARY_EXTENSION as Record<string, Record<string, string>>,
			PRODUCT_DICTIONARY_EXTENSION as Record<string, Record<string, string>>,
			options.overlay,
		),
	});
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Run summary — the one place that formats a run's outcome
 * ------------------------------------------------------------------------------------------------------------------ */

/** Run modes the reconstructed engine reports (n8n's execution `mode`). */
export const RUN_MODES = ['manual', 'webhook', 'schedule'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** Vocabulary key of a run mode's trigger label. */
export const TRIGGER_MESSAGE_KEYS: Readonly<Record<RunMode, string>> = {
	manual: 'execution.trigger.manual',
	webhook: 'execution.trigger.webhook',
	schedule: 'execution.trigger.schedule',
};

/** Summary key per run status; `waiting` deliberately has none (a run that is not finished has no summary). */
export const SUMMARY_MESSAGE_KEYS: Readonly<Record<string, string>> = {
	success: 'execution.summary.ok',
	error: 'execution.summary.error',
	cancelled: 'execution.summary.cancelled',
};

export interface RunSummaryParts {
	/** Localized duration label, e.g. "25 ms". */
	readonly duration?: string;
	/** Localized node-count label, e.g. "2 node" / "2 个节点" — a complete label, not a bare number. */
	readonly nodes?: string;
	/** Localized item-count label, e.g. "3 item". */
	readonly items?: string;
}

/**
 * Format the localized one-line summary of a finished run.
 *
 * The templates render COMPLETE labels (`{nodes}` = "2 node", never a bare `2`), which keeps plural
 * forms and counters inside each translation instead of in code.
 *
 * **All three parts are required.** A summary is a full sentence; producing half of one ("Failed
 * after", "Finished in 2 node(s)") is worse than not producing it, so a run that did not report
 * duration, node count and item count gets the localized lifecycle message instead and
 * `droppedParts` names what was missing. The same guarantee covers template drift: if the filled
 * text still contains a placeholder, the status text is returned rather than a raw `{items}`.
 *
 * `status` without a summary key (e.g. `running`, `waiting`) also returns the localized status text,
 * and `isSummary: false` tells the caller which of the two it received.
 */
export function runSummary(
	status: string,
	parts: RunSummaryParts,
	runtime: LocalizationRuntime,
	locale?: string,
): { text: string; isSummary: boolean; messageKey: string | null; droppedParts: readonly string[] } {
	const messageKey = SUMMARY_MESSAGE_KEYS[status] ?? null;
	if (messageKey === null) {
		return {
			text: runtime.tStatus(status as never, undefined, locale),
			isSummary: false,
			messageKey: null,
			droppedParts: [],
		};
	}

	const missing = (['duration', 'nodes', 'items'] as const).filter((part) => parts[part] === undefined);
	if (missing.length > 0) {
		return {
			text: runtime.tStatus(status as never, undefined, locale),
			isSummary: false,
			messageKey: null,
			droppedParts: missing,
		};
	}

	const filled = runtime.t(
		messageKey,
		{ duration: parts.duration, nodes: parts.nodes, items: parts.items },
		locale,
	);
	if (hasUnfilledPlaceholder(filled)) {
		// Vocabulary/template drift — never ship a placeholder to a human.
		return {
			text: runtime.tStatus(status as never, undefined, locale),
			isSummary: false,
			messageKey: null,
			droppedParts: [],
		};
	}

	return { text: filled, isSummary: true, messageKey, droppedParts: [] };
}

/** Localized trigger label for a run mode; an unknown mode is diagnosed, never guessed. */
export function triggerLabel(mode: string, runtime: LocalizationRuntime, locale?: string): string {
	const key = TRIGGER_MESSAGE_KEYS[mode as RunMode];
	if (typeof key !== 'string') {
		runtime.t(`execution.trigger.${mode}`, undefined, locale);
		return mode;
	}
	return runtime.t(key, undefined, locale);
}

/** Localized label for node states the 4E status map does not cover. */
export function nodeStateLabel(state: 'skipped' | 'disabled' | string, runtime: LocalizationRuntime, locale?: string): string {
	return runtime.t(`node.status.${state}`, undefined, locale);
}
