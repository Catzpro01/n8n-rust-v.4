/**
 * Phase 4B — Backend Native Localization Hub (6 locales: id · en · jv · ar · zh · ru)
 *
 * Reference grounding — `reference/n8n/packages/frontend/@n8n/i18n` (n8n 2.9.4 ships
 * `@n8n/i18n` 2.9.2). The mechanism below mirrors that module 1:1; only the locale set and
 * the translations are product-supplied (upstream ships the English base text alone):
 *
 *   createI18n({ legacy:false, locale:'en', fallbackLocale:'en', messages:{ en }, warnHtmlMessage:false })
 *     → English base text terminates every fallback chain; messages keep their HTML as-is
 *       (no escaping of interpolated values); a missing key resolves to the key itself.
 *   type LocaleMessages = typeof englishBaseText & { numberFormats: { [key: string]: Intl.NumberFormatOptions } }
 *     → a locale may declare `numberFormats`; `formatNumber()` consumes them.
 *   type GetBaseTextKey<T> = T extends `_${string}` ? never : T
 *     → `_`-prefixed keys are plumbing and are excluded from the translatable key set.
 *   Reference message access is dotted (`t('execute.workflow')`, nested trees also work),
 *   plural choices use the `one | many` form with `{count}`, interpolation uses `{name}`.
 *
 * Boundary: this module imports nothing (no n8n runtime, no ports, no globals). It is
 * consumed by `settings-localization-adapter.ts` and, later, by the REST settings layer.
 * Browser storage is attached from the outside through `attachBrowserStorage()` /
 * `LocalizationPersistencePort`, which keeps the hub testable and free of `localStorage`
 * access in non-browser contexts. The Vue editor bundle under `reference/n8n/**` is never
 * touched (PROJECT_RULES §2).
 */

export type SupportedLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

/** The fallback locale, exactly like `createI18n({ fallbackLocale: 'en' })` upstream. */
export const FALLBACK_LOCALE: SupportedLocale = 'en';

/** Locale tags that are not part of the supported set but appear in the wild. */
export const LEGACY_LOCALE_ALIASES: Record<string, SupportedLocale> = {
	in: 'id', // ISO 639-1 legacy code for Indonesian
	jw: 'jv', // ISO 639-1 legacy code for Javanese
	zho: 'zh', // ISO 639-2/T
	chi: 'zh', // ISO 639-2/B
	cmn: 'zh', // Mandarin
	arb: 'ar', // Standard Arabic (ISO 639-3)
};

export interface LocaleMetadata {
	code: SupportedLocale;
	name: string;
	nativeName: string;
	direction: 'ltr' | 'rtl';
	/** Declared fallback chain, walked in order before `FALLBACK_LOCALE` terminates it. */
	fallbacks: SupportedLocale[];
	/** Accepted input tags (BCP-47 or legacy) that normalise onto this locale. */
	aliases: string[];
}

/**
 * Locale registry. The six product locales plus the declared fallback chains:
 * `jv → id → en` (Javanese readers are served Indonesian before English) and
 * `ar | zh | ru → en`.
 */
export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleMetadata> = {
	id: {
		code: 'id',
		name: 'Indonesian',
		nativeName: 'Bahasa Indonesia',
		direction: 'ltr',
		fallbacks: [],
		aliases: ['in', 'id-id', 'id_ID', 'bahasa', 'bahasa indonesia'],
	},
	en: {
		code: 'en',
		name: 'English',
		nativeName: 'English (US)',
		direction: 'ltr',
		fallbacks: [],
		aliases: ['en-us', 'en-gb', 'en_us', 'english'],
	},
	jv: {
		code: 'jv',
		name: 'Javanese',
		nativeName: 'Basa Jawa',
		direction: 'ltr',
		fallbacks: ['id'],
		aliases: ['jw', 'jv-id', 'jav', 'java'],
	},
	ar: {
		code: 'ar',
		name: 'Arabic',
		nativeName: 'العربية',
		direction: 'rtl',
		fallbacks: [],
		aliases: ['ar-sa', 'ar-eg', 'ar-ae', 'arb', 'arabic'],
	},
	zh: {
		code: 'zh',
		name: 'Chinese',
		nativeName: '中文 (简体)',
		direction: 'ltr',
		fallbacks: [],
		aliases: ['zh-cn', 'zh-hans', 'zh-sg', 'zh-tw', 'zh-hant', 'zh-hk', 'chinese', 'mandarin'],
	},
	ru: {
		code: 'ru',
		name: 'Russian',
		nativeName: 'Русский',
		direction: 'ltr',
		fallbacks: [],
		aliases: ['ru-ru', 'russian'],
	},
};

/** Message trees are nested objects; leaf values are the translatable strings. */
export type MessageValue = string | { [key: string]: MessageValue };
export type LocaleMessages = { [key: string]: MessageValue };
export type NumberFormats = Record<string, Intl.NumberFormatOptions>;

/**
 * Shipped dictionaries (six locales x 23 keys). All six locales are key-identical to the
 * English base text; `NativeLocalizationService.parityReport()` proves it on every run.
 */
/**
 * Shipped dictionaries (six locales x 23 keys) — merged verbatim from the Phase 4B seed on
 * this branch, now checked for key parity by `parityReport()`.
 */
export const NATIVE_DICTIONARIES: Record<SupportedLocale, LocaleMessages> = {
  id: {
    'execute.workflow': 'Jalankan alur kerja',
    'test.step': 'Uji langkah',
    'save.workflow': 'Simpan alur kerja',
    'add.step': 'Tambah langkah',
    'settings.title': 'Pengaturan',
    'settings.personal': 'Pengaturan Pribadi',
    'settings.language': 'Bahasa Tampilan',
    'node.success': 'Berhasil dieksekusi',
    'node.error': 'Gagal dieksekusi',
    'workflow.active': 'Alur kerja aktif',
    'workflow.inactive': 'Alur kerja tidak aktif',
    'execution.started': 'Eksekusi dimulai',
    'execution.finished': 'Eksekusi selesai',
    'connection.valid': 'Koneksi valid',
    'connection.invalid': 'Koneksi tidak valid',
    'validation.cycle': 'Siklus terdeteksi',
    'validation.dangling': 'Koneksi menggantung',
    'error.natural': 'Node gagal dieksekusi',
    'banner.update.suppressed': 'Banner update diredam',
    'canvas.protected': 'Canvas dilindungi',
    'credential.sanitized': 'Kredensial disanitasi',
    'system.healthy': 'Sistem sehat',
    'system.recovered': 'Sistem dipulihkan otomatis',
  },
  en: {
    'execute.workflow': 'Execute workflow',
    'test.step': 'Test step',
    'save.workflow': 'Save workflow',
    'add.step': 'Add step',
    'settings.title': 'Settings',
    'settings.personal': 'Personal Settings',
    'settings.language': 'Display Language',
    'node.success': 'Execution succeeded',
    'node.error': 'Execution failed',
    'workflow.active': 'Workflow active',
    'workflow.inactive': 'Workflow inactive',
    'execution.started': 'Execution started',
    'execution.finished': 'Execution finished',
    'connection.valid': 'Connection valid',
    'connection.invalid': 'Connection invalid',
    'validation.cycle': 'Cycle detected',
    'validation.dangling': 'Dangling connection',
    'error.natural': 'Node execution failed',
    'banner.update.suppressed': 'Update banner suppressed',
    'canvas.protected': 'Canvas protected',
    'credential.sanitized': 'Credential sanitized',
    'system.healthy': 'System healthy',
    'system.recovered': 'System auto-recovered',
  },
  jv: {
    'execute.workflow': 'Lakokake alur kerja',
    'test.step': 'Jajal jangkah',
    'save.workflow': 'Simpen alur kerja',
    'add.step': 'Tambah jangkah',
    'settings.title': 'Setelan',
    'settings.personal': 'Setelan Pribadi',
    'settings.language': 'Basa Tampilan',
    'node.success': 'Kasil dilakokake',
    'node.error': 'Gagal dilakokake',
    'workflow.active': 'Alur kerja aktif',
    'workflow.inactive': 'Alur kerja ora aktif',
    'execution.started': 'Eksekusi diwiwiti',
    'execution.finished': 'Eksekusi rampung',
    'connection.valid': 'Koneksi valid',
    'connection.invalid': 'Koneksi ora valid',
    'validation.cycle': 'Siklus kedeteksi',
    'validation.dangling': 'Koneksi nggantung',
    'error.natural': 'Node gagal dilakokake',
    'banner.update.suppressed': 'Banner update diredam',
    'canvas.protected': 'Canvas dilindungi',
    'credential.sanitized': 'Kredensial disanitasi',
    'system.healthy': 'Sistem sehat',
    'system.recovered': 'Sistem dipulihake otomatis',
  },
  ar: {
    'execute.workflow': 'تشغيل سير العمل',
    'test.step': 'اختبار الخطوة',
    'save.workflow': 'حفظ سير العمل',
    'add.step': 'إضافة خطوة',
    'settings.title': 'الإعدادات',
    'settings.personal': 'الإعدادات الشخصية',
    'settings.language': 'لغة العرض',
    'node.success': 'تم التنفيذ بنجاح',
    'node.error': 'فشل التنفيذ',
    'workflow.active': 'سير العمل نشط',
    'workflow.inactive': 'سير العمل غير نشط',
    'execution.started': 'بدأ التنفيذ',
    'execution.finished': 'انتهى التنفيذ',
    'connection.valid': 'الاتصال صالح',
    'connection.invalid': 'الاتصال غير صالح',
    'validation.cycle': 'تم اكتشاف دورة',
    'validation.dangling': 'اتصال معلق',
    'error.natural': 'فشل تنفيذ العقدة',
    'banner.update.suppressed': 'تم كبح لافتة التحديث',
    'canvas.protected': 'اللوحة محمية',
    'credential.sanitized': 'تم تطهير بيانات الاعتماد',
    'system.healthy': 'النظام سليم',
    'system.recovered': 'تم استرداد النظام تلقائياً',
  },
  zh: {
    'execute.workflow': '执行工作流',
    'test.step': '测试步骤',
    'save.workflow': '保存工作流',
    'add.step': '添加步骤',
    'settings.title': '设置',
    'settings.personal': '个人设置',
    'settings.language': '显示语言',
    'node.success': '执行成功',
    'node.error': '执行失败',
    'workflow.active': '工作流已激活',
    'workflow.inactive': '工作流未激活',
    'execution.started': '执行已开始',
    'execution.finished': '执行已完成',
    'connection.valid': '连接有效',
    'connection.invalid': '连接无效',
    'validation.cycle': '检测到循环',
    'validation.dangling': '悬空连接',
    'error.natural': '节点执行失败',
    'banner.update.suppressed': '更新横幅已抑制',
    'canvas.protected': '画布已保护',
    'credential.sanitized': '凭证已清理',
    'system.healthy': '系统健康',
    'system.recovered': '系统已自动恢复',
  },
  ru: {
    'execute.workflow': 'Запустить процесс',
    'test.step': 'Тестировать шаг',
    'save.workflow': 'Сохранить процесс',
    'add.step': 'Добавить шаг',
    'settings.title': 'Настройки',
    'settings.personal': 'Личные настройки',
    'settings.language': 'Язык интерфейса',
    'node.success': 'Успешно выполнено',
    'node.error': 'Ошибка выполнения',
    'workflow.active': 'Процесс активен',
    'workflow.inactive': 'Процесс неактивен',
    'execution.started': 'Выполнение начато',
    'execution.finished': 'Выполнение завершено',
    'connection.valid': 'Соединение допустимо',
    'connection.invalid': 'Соединение недопустимо',
    'validation.cycle': 'Обнаружен цикл',
    'validation.dangling': 'Висячее соединение',
    'error.natural': 'Ошибка выполнения узла',
    'banner.update.suppressed': 'Баннер обновления подавлен',
    'canvas.protected': 'Холст защищён',
    'credential.sanitized': 'Учётные данные очищены',
    'system.healthy': 'Система исправна',
    'system.recovered': 'Система автоматически восстановлена',
  },
};

/** `LocaleMessages["numberFormats"]` in the reference type, per locale. */
export const NATIVE_NUMBER_FORMATS: Record<SupportedLocale, NumberFormats> = {
	id: { default: { maximumFractionDigits: 2 } },
	en: { default: { maximumFractionDigits: 2 } },
	jv: { default: { maximumFractionDigits: 2 } },
	ar: { default: { maximumFractionDigits: 2 } },
	zh: { default: { maximumFractionDigits: 2 } },
	ru: { default: { maximumFractionDigits: 2 } },
};

/** The English base text — the fallback locale of the reference `createI18n` call. */
export const BASE_LOCALE_MESSAGES: LocaleMessages = NATIVE_DICTIONARIES[FALLBACK_LOCALE];

export interface LocaleParityReport {
	base: SupportedLocale;
	baseKeyCount: number;
	ok: boolean;
	locales: Array<{
		locale: SupportedLocale;
		keyCount: number;
		missing: string[];
		extra: string[];
	}>;
}

export interface TranslateOptions {
	/** Override the active locale for this call (BCP-47 tags are normalised). */
	locale?: SupportedLocale | string;
	/** `{name}` placeholders, inserted verbatim (never HTML-escaped). */
	interpolate?: Record<string, string | number>;
	/** Enables the `one | many` plural choice and the `{count}` placeholder. */
	count?: number;
	/** Returned when no locale in the chain resolves the key. */
	defaultValue?: string;
	/** `false` disables the English base fallback (only the requested locale is consulted). */
	fallback?: boolean;
}

/** Storage boundary for the user's language preference (n8n user settings / localStorage). */
export interface LocalizationPersistencePort {
	load(): string | null | undefined;
	save(locale: SupportedLocale): void;
}

/** The two browser storage keys the settings surface has always used. */
export const BROWSER_STORAGE_KEYS = {
	locale: 'n8n_locale',
	updateNoticeSuppressed: 'n8n_update_notice_suppressed',
} as const;

interface BrowserStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

type LocaleChangeListener = (locale: SupportedLocale, previous: SupportedLocale) => void;

/** `_`-prefixed keys are plumbing in the reference (`GetBaseTextKey`) and never translate. */
export function isTranslatableKey(key: string): boolean {
	return !key.startsWith('_');
}

const aliasIndex: Record<string, SupportedLocale> = (() => {
	const index: Record<string, SupportedLocale> = {};
	for (const meta of Object.values(SUPPORTED_LOCALES)) {
		index[meta.code] = meta.code;
		for (const alias of meta.aliases) index[alias.trim().toLowerCase().replace(/_/g, '-')] = meta.code;
	}
	return index;
})();

const canonicalize = (input: string): string => input.trim().toLowerCase().replace(/_/g, '-');

/**
 * Matches a single tag (BCP-47, legacy or alias) onto a supported locale, or `null`
 * when nothing matches. `normalizeLocale()` wraps this and applies the fallback.
 */
export function matchLocale(input: unknown): SupportedLocale | null {
	if (typeof input !== 'string') return null;
	const tag = canonicalize(input);
	if (!tag) return null;
	if (aliasIndex[tag]) return aliasIndex[tag];
	const legacy = LEGACY_LOCALE_ALIASES[tag];
	if (legacy) return legacy;
	// Drop subtags one at a time: `zh-hans-cn` → `zh-hans` → `zh`, `en-us` → `en`.
	const parts = tag.split('-').filter(Boolean);
	while (parts.length > 1) {
		parts.pop();
		const candidate = parts.join('-');
		if (aliasIndex[candidate]) return aliasIndex[candidate];
	}
	return null;
}

/** Normalises any input tag onto a supported locale; unknown input → `FALLBACK_LOCALE`. */
export function normalizeLocale(input: unknown): SupportedLocale {
	return matchLocale(input) ?? FALLBACK_LOCALE;
}

/**
 * Picks the best supported locale from an `Accept-Language` header, honouring the
 * `q` weights and ignoring anything that does not match (n8n serves the UI locale
 * from the request the same way).
 */
export function resolveAcceptLanguage(header: string | null | undefined): SupportedLocale {
	if (typeof header !== 'string' || !header.trim()) return FALLBACK_LOCALE;
	const ranked = header
		.split(',')
		.map((entry, position) => {
			const [rawTag, ...params] = entry.split(';');
			const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
			const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
			return { tag: rawTag.trim(), q: Number.isFinite(q) ? q : 0, position };
		})
		.filter((entry) => entry.tag.length > 0)
		.sort((a, b) => b.q - a.q || a.position - b.position);
	for (const entry of ranked) {
		if (entry.tag === '*') continue;
		const matched = matchLocale(entry.tag);
		if (matched) return matched;
	}
	return FALLBACK_LOCALE;
}

/** True when the locale renders right-to-left (`ar` is the only RTL locale here). */
export function isRtl(locale?: SupportedLocale | string | null): boolean {
	return SUPPORTED_LOCALES[normalizeLocale(locale)].direction === 'rtl';
}

/** The browser storage, when the hub runs inside one; `null` in Node (tests, backend). */
function browserStorage(): BrowserStorageLike | null {
	const candidate = (globalThis as { localStorage?: BrowserStorageLike }).localStorage;
	return candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function'
		? candidate
		: null;
}

/** Declared chain (excluding the terminal English base text unless `useFallback`). */
function fallbackChain(locale: SupportedLocale, useFallback: boolean): SupportedLocale[] {
	const chain: SupportedLocale[] = [locale];
	if (useFallback) {
		for (const step of SUPPORTED_LOCALES[locale].fallbacks) if (!chain.includes(step)) chain.push(step);
		if (!chain.includes(FALLBACK_LOCALE)) chain.push(FALLBACK_LOCALE);
	}
	return chain;
}

/** Dotted-path access with a flat-key fast path (both styles are valid upstream). */
function resolveMessage(messages: LocaleMessages | undefined, key: string): MessageValue | undefined {
	if (!messages) return undefined;
	const direct = messages[key];
	if (direct !== undefined) return direct;
	const parts = key.split('.');
	let node: MessageValue | undefined = messages;
	for (const part of parts) {
		if (typeof node !== 'object' || node === null) return undefined;
		node = node[part];
		if (node === undefined) return undefined;
	}
	return node;
}

function flattenKeys(messages: LocaleMessages, prefix = '', out: string[] = []): string[] {
	for (const [key, value] of Object.entries(messages)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') out.push(path);
		else flattenKeys(value, path, out);
	}
	return out;
}

/**
 * `{name}` interpolation plus the `one | many` plural choice, mirroring vue-i18n as
 * configured upstream: values are inserted verbatim and unknown placeholders stay
 * untouched so a missing parameter is visible instead of silently empty. Every
 * occurrence of a placeholder is replaced (the Phase 4B `formatExecutionMessage`
 * helper used a single-occurrence `String.replace`, which dropped repeated params).
 */
function interpolateMessage(
	message: string,
	params: Record<string, string | number> | undefined,
	count: number | undefined,
): string {
	let text = message;
	if (count !== undefined && text.includes('|')) {
		const forms = text
			.split('|')
			.map((form) => form.trim())
			.filter((form) => form.length > 0);
		const index = forms.length <= 1 ? 0 : Math.min(Math.max(Math.trunc(count) - 1, 0), forms.length - 1);
		text = forms[index] ?? text;
	}
	const values: Record<string, string | number> = { ...(params ?? {}) };
	if (count !== undefined && values.count === undefined) values.count = count;
	return text.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => {
		const value = values[name];
		return value === undefined ? placeholder : String(value);
	});
}

/**
 * Static localization hub. The API is intentionally static so the backend can call
 * `NativeLocalizationService.translate(...)` from anywhere without wiring, exactly like
 * the reference singleton `i18nInstance.global`.
 */
export class NativeLocalizationService {
	private static activeLocale: SupportedLocale = 'id';
	private static messages: Record<SupportedLocale, LocaleMessages> = NativeLocalizationService.freshMessages();
	private static cache = new Map<string, string>();
	private static listeners = new Set<LocaleChangeListener>();
	private static persistence: LocalizationPersistencePort | null = null;

	private static freshMessages(): Record<SupportedLocale, LocaleMessages> {
		return Object.fromEntries(
			(Object.keys(NATIVE_DICTIONARIES) as SupportedLocale[]).map((locale) => [
				locale,
				{ ...NATIVE_DICTIONARIES[locale] },
			]),
		) as Record<SupportedLocale, LocaleMessages>;
	}

	/** Applies a locale (normalised). Notifies listeners and the persistence port on change. */
	public static setLocale(locale: SupportedLocale | string): SupportedLocale {
		const next = normalizeLocale(locale);
		const previous = this.activeLocale;
		if (next === previous) return previous;
		this.activeLocale = next;
		this.cache.clear();
		for (const listener of this.listeners) listener(next, previous);
		if (this.persistence) this.persistence.save(next);
		return next;
	}

	public static getLocale(): SupportedLocale {
		return this.activeLocale;
	}

	public static getSupportedLocales(): LocaleMetadata[] {
		return Object.values(SUPPORTED_LOCALES);
	}

	public static getLocaleMetadata(locale?: SupportedLocale | string | null): LocaleMetadata {
		return SUPPORTED_LOCALES[normalizeLocale(locale ?? this.activeLocale)];
	}

	public static getDirection(locale?: SupportedLocale | string | null): 'ltr' | 'rtl' {
		return this.getLocaleMetadata(locale).direction;
	}

	public static isRtl(locale?: SupportedLocale | string | null): boolean {
		return this.getDirection(locale) === 'rtl';
	}

	/** Alias kept for the Phase 4B call sites that used the all-caps spelling. */
	public static isRTL(locale?: SupportedLocale | string | null): boolean {
		return this.isRtl(locale);
	}

	/**
	 * Resolves `key` for the request locale, walking the declared fallback chain and
	 * finally the English base text. `translate(key, 'ar')` is still supported for the
	 * original two-argument call shape.
	 */
	public static translate(key: string, options?: TranslateOptions | SupportedLocale | string): string {
		const opts: TranslateOptions = typeof options === 'string' ? { locale: options } : options ?? {};
		const locale = normalizeLocale(opts.locale ?? this.activeLocale);
		for (const candidate of fallbackChain(locale, opts.fallback !== false)) {
			const cacheKey = `${candidate}\u0000${key}`;
			let message = this.cache.get(cacheKey);
			if (message === undefined) {
				const resolved = resolveMessage(this.messages[candidate], key);
				message = typeof resolved === 'string' ? resolved : '';
				this.cache.set(cacheKey, message);
			}
			if (message) return interpolateMessage(message, opts.interpolate, opts.count);
		}
		return opts.defaultValue ?? key;
	}

	/** Short alias, same call shape as `i18n.t(...)` upstream. */
	public static t(key: string, options?: TranslateOptions | SupportedLocale | string): string {
		return this.translate(key, options);
	}

	/** `translate()` with named parameters — replaces every occurrence, unlike the seed helper. */
	public static formatExecutionMessage(
		key: string,
		params?: Record<string, string | number>,
		locale?: SupportedLocale | string,
	): string {
		return this.translate(key, { interpolate: params, locale });
	}

	public static exists(key: string, locale?: SupportedLocale | string): boolean {
		const target = normalizeLocale(locale ?? this.activeLocale);
		return typeof resolveMessage(this.messages[target], key) === 'string';
	}

	/** Translatable keys, sorted; `_`-prefixed plumbing keys are excluded. */
	public static listKeys(locale?: SupportedLocale | string): string[] {
		const target = normalizeLocale(locale ?? this.activeLocale);
		return flattenKeys(this.messages[target]).filter(isTranslatableKey).sort();
	}

	public static getMessages(locale?: SupportedLocale | string): LocaleMessages {
		return { ...this.messages[normalizeLocale(locale ?? this.activeLocale)] };
	}

	/** Keys the English base text defines but `locale` is missing. */
	public static missingKeys(locale?: SupportedLocale | string): string[] {
		const target = normalizeLocale(locale ?? this.activeLocale);
		const present = new Set(this.listKeys(target));
		return flattenKeys(BASE_LOCALE_MESSAGES).filter(isTranslatableKey).filter((key) => !present.has(key)).sort();
	}

	/** Parity proof consumed by the Phase 4B gate (`npm run i18n:check`). */
	public static parityReport(): LocaleParityReport {
		const baseKeys = flattenKeys(BASE_LOCALE_MESSAGES).filter(isTranslatableKey).sort();
		const baseSet = new Set(baseKeys);
		const locales = (Object.keys(SUPPORTED_LOCALES) as SupportedLocale[]).map((locale) => {
			const keys = this.listKeys(locale);
			const keySet = new Set(keys);
			return {
				locale,
				keyCount: keys.length,
				missing: baseKeys.filter((key) => !keySet.has(key)),
				extra: keys.filter((key) => !baseSet.has(key)),
			};
		});
		return {
			base: FALLBACK_LOCALE,
			baseKeyCount: baseKeys.length,
			ok: locales.every((entry) => entry.missing.length === 0 && entry.extra.length === 0),
			locales,
		};
	}

	/**
	 * Merges additional messages into a locale (community/product locale files, exactly
	 * where `@n8n/i18n` merges a locale payload over the English base text).
	 */
	public static registerMessages(locale: SupportedLocale | string, messages: LocaleMessages): void {
		const target = normalizeLocale(locale);
		this.messages[target] = { ...this.messages[target], ...messages };
		this.cache.clear();
	}

	/** Restores the shipped dictionaries (used after `registerMessages`, incl. by tests). */
	public static resetRegistry(): void {
		this.messages = NativeLocalizationService.freshMessages();
		this.cache.clear();
	}

	public static onLocaleChange(listener: LocaleChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Binds the user-preference store (n8n user settings); `hydrate()` restores it. */
	public static attachPersistence(port: LocalizationPersistencePort | null): void {
		this.persistence = port;
	}

	/**
	 * Binds `localStorage` when the hub runs in a browser context and hydrates the stored
	 * preference in one step. Returns the locale in effect afterwards.
	 */
	public static attachBrowserStorage(): SupportedLocale {
		const storage = browserStorage();
		this.attachPersistence(
			storage
				? {
						load: () => storage.getItem(BROWSER_STORAGE_KEYS.locale),
						save: (locale) => storage.setItem(BROWSER_STORAGE_KEYS.locale, locale),
					}
				: null,
		);
		return this.hydrate();
	}

	/** Loads the stored preference when it is a supported locale; otherwise keeps the default. */
	public static hydrate(): SupportedLocale {
		const stored = this.persistence?.load() ?? null;
		const matched = matchLocale(stored);
		if (matched) this.activeLocale = matched;
		return this.activeLocale;
	}

	/**
	 * Phase 4A behaviour kept: the aggressive update banner stays suppressed. The flag is
	 * written to browser storage when available — never to a global in Node.
	 */
	public static suppressUpdateBanner(): boolean {
		browserStorage()?.setItem(BROWSER_STORAGE_KEYS.updateNoticeSuppressed, 'true');
		return true;
	}

	/** `Intl.NumberFormat` through the locale's declared `numberFormats`. */
	public static formatNumber(
		value: number,
		format: string | Intl.NumberFormatOptions = 'default',
		locale?: SupportedLocale | string,
	): string {
		const target = normalizeLocale(locale ?? this.activeLocale);
		const declared = NATIVE_NUMBER_FORMATS[target];
		const options = typeof format === 'string' ? declared[format] ?? declared.default ?? {} : format;
		return new Intl.NumberFormat(target, options).format(value);
	}

	public static clearCache(): void {
		this.cache.clear();
	}
}
