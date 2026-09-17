/**
 * Phase 4C — Native Localization Runtime (backend data-flow seam).
 *
 * This module is the *runtime* half of the native localization line:
 *   Phase 4A  `settings-localization-adapter.ts`   settings state (which language the user picked)
 *   Phase 4B  `backend-localization-service.ts`    catalog + dictionaries + translate()
 *   Phase 4C  `localization-runtime.ts` (this)     locale resolution -> direction -> interpolation
 *                                                  -> engine-facing status/error messages
 *                                                  -> missing-key diagnostics
 *
 * BOUNDARY (see contracts/localization.contract.md)
 *   owns         : BCP-47 normalization/aliasing, the resolution chain, RTL/LTR direction,
 *                  template interpolation, status/error message mapping, diagnostics
 *   does NOT own : the dictionaries and the canonical language catalog (Phase 4B provides them),
 *                  user-settings persistence (Phase 4A adapter is injected through a port),
 *                  editor-ui strings or translation bundles (UI stays 100% upstream n8n)
 *
 * ZERO IMPORTS by design: every collaborator (dictionary service, settings adapter, environment)
 * is injected through a declared port, so the module cannot smuggle a hidden dependency across a
 * LEGO boundary. `scripts/run-lego-tests.sh` / `tools/localization-gate.mjs` wire the real
 * Phase 4A/4B modules in the tests.
 *
 * RUST: none. Pure TypeScript, erasable-syntax only (runs directly under `node --test`).
 */

/* ------------------------------------------------------------------------------------------------------------------ *
 * Catalog — the contract-visible language table.
 * The runtime must never invent a language the dictionaries do not have, and the dictionaries must
 * never offer one the runtime cannot resolve. `test/06-localization-runtime.test.ts` proves this
 * table still equals the Phase 4B `SUPPORTED_LOCALES` table.
 * ------------------------------------------------------------------------------------------------------------------ */

/** Direction of a script, as consumed by renderers downstream (backend only — no UI bundle here). */
export type Direction = 'ltr' | 'rtl';

export interface LocaleDescriptor {
	/** Canonical primary subtag, matching the Phase 4B dictionary keys. */
	readonly code: string;
	/** English name. */
	readonly name: string;
	/** Endonym, shown to the operator. */
	readonly nativeName: string;
	/** Script direction. */
	readonly direction: Direction;
	/** Additional tags that must resolve to this locale (ISO-639-1 legacy codes and endonyms). */
	readonly aliases: readonly string[];
}

export const LOCALE_CATALOG: readonly LocaleDescriptor[] = [
	{
		code: 'id',
		name: 'Indonesian',
		nativeName: 'Bahasa Indonesia',
		direction: 'ltr',
		aliases: ['in', 'ind', 'bahasa', 'bahasa-indonesia'],
	},
	{
		code: 'en',
		name: 'English',
		nativeName: 'English (US)',
		direction: 'ltr',
		aliases: ['eng', 'en-us', 'en-gb'],
	},
	{
		code: 'jv',
		name: 'Javanese',
		nativeName: 'Basa Jawa',
		direction: 'ltr',
		aliases: ['jw', 'jav', 'java', 'basa-jawa'],
	},
	{
		code: 'ar',
		name: 'Arabic',
		nativeName: 'العربية',
		direction: 'rtl',
		aliases: ['ara', 'ar-sa', 'ar-eg'],
	},
	{
		code: 'zh',
		name: 'Chinese',
		nativeName: '中文 (简体)',
		direction: 'ltr',
		aliases: ['cmn', 'zh-cn', 'zh-hans', 'zh-sg', 'mandarin'],
	},
	{
		code: 'ru',
		name: 'Russian',
		nativeName: 'Русский',
		direction: 'ltr',
		aliases: ['rus', 'ru-ru'],
	},
] as const;

/** Canonical locale codes, in catalog order. */
export const SUPPORTED_LOCALE_CODES: readonly string[] = LOCALE_CATALOG.map((l) => l.code);

/** Never-translated default: the project's operational fallback language. */
export const FALLBACK_LOCALE = 'en';

/**
 * Locale tags accepted by the runtime: canonical code plus every alias.
 * Lookup is exact first, then progressively shorter subtags (`zh-hans-cn` -> `zh-hans` -> `zh`).
 */
const RESOLUTION_TABLE: ReadonlyMap<string, string> = (() => {
	const table = new Map<string, string>();
	for (const locale of LOCALE_CATALOG) {
		table.set(locale.code, locale.code);
		for (const alias of locale.aliases) table.set(alias, locale.code);
	}
	return table;
})();

/* ------------------------------------------------------------------------------------------------------------------ *
 * Errors — documented error behaviour (contract §Error behavior).
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Thrown when an *explicit* locale request cannot be honoured.
 *
 * A bad locale coming from the resolution chain (settings/environment) is NOT an error: it degrades
 * to the fallback so that a bad user setting can never break an execution. Only an explicit
 * programmatic request is strict — a silent typo in code is worse than a loud failure.
 */
export class UnsupportedLocaleError extends Error {
	public readonly input: string;
	public readonly supported: readonly string[];

	public constructor(input: string, supported: readonly string[] = SUPPORTED_LOCALE_CODES) {
		super(`Unsupported locale "${input}" — supported: ${supported.join(', ')}`);
		this.name = 'UnsupportedLocaleError';
		this.input = input;
		this.supported = supported;
	}
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Ports — structural interfaces; the runtime imports none of its collaborators.
 * ------------------------------------------------------------------------------------------------------------------ */

/** Any dictionary owner able to translate a key for a given locale (Phase 4B service satisfies this). */
export interface DictionaryPort {
	translate(key: string, locale?: string): string;
}

/** Any locale provider (Phase 4A settings adapter / request context / session). */
export interface LocaleSourcePort {
	getLocale(): string | null | undefined;
}

/** Minimal shape of the Phase 4A `SettingsLocalizationAdapter` (state object, not a value). */
export interface SettingsStatePort {
	getState(): { currentLanguage?: string | null };
}

/** Diagnostics handed to telemetry/evidence writers. */
export interface LocalizationSnapshot {
	readonly locale: string;
	readonly direction: Direction;
	readonly fallbackLocale: string;
	readonly supportedLocales: readonly string[];
	readonly missingKeys: readonly string[];
}

export type InterpolationParams = Record<string, string | number | boolean | null | undefined>;

export interface LocalizationOptions {
	/** Dictionary owner; when absent only the overlay (if any) is consulted. */
	readonly dictionaries?: DictionaryPort;
	/** Locale provider consulted when no explicit locale is passed. */
	readonly localeSource?: LocaleSourcePort;
	/** Extra/overridden keys per locale. Overlay wins over the dictionary owner; never mutates it. */
	readonly overlay?: Record<string, Record<string, string>>;
	/** Locale used when the chain yields nothing usable. Defaults to `en`. */
	readonly fallbackLocale?: string;
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Normalize any BCP-47-ish tag to a canonical catalog code.
 *
 * Accepts `id`, `id-ID`, `ID_id`, `zh-Hans-CN`, ` ar ` — separator, case and script subtags are
 * folded. Returns `null` for anything the catalog does not cover (never guesses a language).
 */
export function normalizeLocale(input: string | null | undefined): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (trimmed === '') return null;

	const folded = trimmed.toLowerCase().replace(/_/g, '-');
	const direct = RESOLUTION_TABLE.get(folded);
	if (direct) return direct;

	// Progressive subtag fallback: 'zh-hans-cn' -> 'zh-hans' -> 'zh'
	const parts = folded.split('-').filter((p) => p !== '');
	while (parts.length > 1) {
		parts.pop();
		const candidate = RESOLUTION_TABLE.get(parts.join('-'));
		if (candidate) return candidate;
	}
	return RESOLUTION_TABLE.get(parts[0] ?? '') ?? null;
}

/** `true` when the tag is required to be resolved by the catalog. */
export function isSupportedLocale(input: string | null | undefined): boolean {
	return normalizeLocale(input) !== null;
}

/** Direction of a locale; unknown input is treated as `ltr` (never crashes a renderer). */
export function directionOf(locale: string | null | undefined): Direction {
	const code = normalizeLocale(locale);
	if (code === null) return 'ltr';
	return LOCALE_CATALOG.find((l) => l.code === code)?.direction ?? 'ltr';
}

/** Describe a locale for API payloads. `null` when unsupported. */
export function describeLocale(input: string | null | undefined): LocaleDescriptor | null {
	const code = normalizeLocale(input);
	if (code === null) return null;
	return LOCALE_CATALOG.find((l) => l.code === code) ?? null;
}

/**
 * Placeholder syntax of the whole line: `{key}` and `{{ key }}`.
 * Exported so downstream phases reuse one definition instead of re-deriving the regex.
 */
export const PLACEHOLDER_SOURCE = '\\{\\{\\s*([A-Za-z0-9_.]+)\\s*\\}\\}|\\{\\s*([A-Za-z0-9_.]+)\\s*\\}';
const PLACEHOLDER = new RegExp(PLACEHOLDER_SOURCE, 'g');

/**
 * Interpolate `{name}` / `{{ name }}` placeholders.
 *
 * Unknown placeholders are left verbatim — a visibly unfilled `{count}` is safer than an empty
 * string that hides a wiring bug. `null`/`undefined` params count as unknown; numbers and booleans
 * are stringified.
 */
export function interpolate(template: string, params?: InterpolationParams): string {
	if (!params) return template;
	return template.replace(PLACEHOLDER, (match, brace2: string, brace1: string) => {
		const key = brace2 ?? brace1;
		const value = params[key];
		if (value === undefined || value === null) return match;
		return String(value);
	});
}

/** True when a template still contains at least one unfilled placeholder. */
export function hasUnfilledPlaceholder(value: string): boolean {
	PLACEHOLDER.lastIndex = 0;
	return PLACEHOLDER.test(value);
}

/**
 * Index of the first unfilled placeholder, or `-1` when the value is complete.
 * Used by callers that must drop an optional trailing segment instead of shipping `{items}` to a user.
 */
export function firstPlaceholderIndex(value: string): number {
	PLACEHOLDER.lastIndex = 0;
	const match = PLACEHOLDER.exec(value);
	return match === null ? -1 : match.index;
}

export interface DictionaryParityReport {
	readonly referenceLocale: string;
	readonly locales: readonly string[];
	readonly missingByLocale: Record<string, readonly string[]>;
	readonly extraByLocale: Record<string, readonly string[]>;
	readonly emptyValues: readonly string[];
	readonly consistent: boolean;
}

/**
 * Compare a flat `locale -> key -> value` dictionary set against a reference locale.
 *
 * Guards the exact failure mode that makes localization rot silently: a key added in one language
 * and forgotten in the other five. `emptyValues` catches `''` placeholders that look translated.
 */
export function dictionaryParity(
	dictionaries: Record<string, Record<string, string>>,
	referenceLocale: string = FALLBACK_LOCALE,
): DictionaryParityReport {
	const reference = dictionaries[referenceLocale];
	if (!reference) {
		throw new Error(`dictionaryParity: reference locale "${referenceLocale}" is absent`);
	}
	const referenceKeys = Object.keys(reference).sort();
	const locales = Object.keys(dictionaries).sort();
	const missingByLocale: Record<string, readonly string[]> = {};
	const extraByLocale: Record<string, readonly string[]> = {};
	const emptyValues: string[] = [];

	for (const locale of locales) {
		const keys = Object.keys(dictionaries[locale] ?? {});
		missingByLocale[locale] = referenceKeys.filter((k) => !keys.includes(k));
		extraByLocale[locale] = keys.filter((k) => !referenceKeys.includes(k)).sort();
		for (const [key, value] of Object.entries(dictionaries[locale] ?? {})) {
			if (typeof value !== 'string' || value.trim() === '') emptyValues.push(`${locale}:${key}`);
		}
	}

	const consistent =
		emptyValues.length === 0 &&
		locales.every(
			(l) => (missingByLocale[l] ?? []).length === 0 && (extraByLocale[l] ?? []).length === 0,
		);

	return { referenceLocale, locales, missingByLocale, extraByLocale, emptyValues, consistent };
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Engine-facing message keys
 * ------------------------------------------------------------------------------------------------------------------ */

/** Execution statuses the reconstructed engine reports per node run. */
export type ExecutionStatus = 'success' | 'error' | 'running' | 'waiting' | 'cancelled';

/**
 * Statuses that Phase 4B ships a string for. Anything outside this map resolves through
 * `node.<status>`, which the diagnostics layer records as a missing key rather than inventing text.
 */
export const STATUS_MESSAGE_KEYS: Readonly<Record<ExecutionStatus, string>> = {
	success: 'node.success',
	error: 'node.error',
	running: 'node.running',
	waiting: 'node.waiting',
	cancelled: 'node.cancelled',
};

/**
 * Strings for the statuses Phase 4B does not ship (`success`/`error` come from the dictionaries).
 *
 * Ownership is explicit: the runtime owns *engine* messages, the dictionary service owns *product*
 * labels. Keeping them apart means a dictionary refresh cannot silently un-translate a status the
 * execution logger already emits. A caller overlay always wins over these defaults.
 */
export const ENGINE_STATUS_OVERLAY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	id: { 'node.running': 'Sedang dieksekusi', 'node.waiting': 'Menunggu', 'node.cancelled': 'Dibatalkan' },
	en: { 'node.running': 'Running', 'node.waiting': 'Waiting', 'node.cancelled': 'Cancelled' },
	jv: { 'node.running': 'Lagi dilakokake', 'node.waiting': 'Ngenteni', 'node.cancelled': 'Dibatalake' },
	ar: { 'node.running': 'قيد التنفيذ', 'node.waiting': 'في الانتظار', 'node.cancelled': 'أُلغيت' },
	zh: { 'node.running': '执行中', 'node.waiting': '等待中', 'node.cancelled': '已取消' },
	ru: { 'node.running': 'Выполняется', 'node.waiting': 'Ожидание', 'node.cancelled': 'Отменено' },
};

/** Merge overlays per locale/per key; later overlays win. Never mutates its inputs. */
export function mergeOverlays(
	...overlays: Array<Record<string, Record<string, string>> | undefined>
): Record<string, Record<string, string>> {
	const merged: Record<string, Record<string, string>> = {};
	for (const overlay of overlays) {
		if (!overlay) continue;
		for (const [locale, keys] of Object.entries(overlay)) {
			merged[locale] = { ...(merged[locale] ?? {}), ...keys };
		}
	}
	return merged;
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Locale-aware message runtime for the reconstructed backend.
 *
 * Deterministic by construction: the active locale is instance state, the Phase 4B static
 * `activeLocale` is never read or written, and nothing outside the injected ports is consulted.
 * Two runtimes with different locales therefore cannot influence each other.
 */
export class LocalizationRuntime {
	private readonly dictionaries: DictionaryPort | null;
	private readonly localeSource: LocaleSourcePort | null;
	private readonly overlay: Record<string, Record<string, string>>;
	private readonly fallbackLocale: string;
	/** Locale forced through `setLocale()`; `null` means "ask the sources". */
	private override: string | null;
	private readonly missing = new Set<string>();

	public constructor(options: LocalizationOptions = {}) {
		this.dictionaries = options.dictionaries ?? null;
		this.localeSource = options.localeSource ?? null;
		this.overlay = mergeOverlays(ENGINE_STATUS_OVERLAY as Record<string, Record<string, string>>, options.overlay);
		const fallback = normalizeLocale(options.fallbackLocale ?? FALLBACK_LOCALE);
		this.fallbackLocale = fallback ?? FALLBACK_LOCALE;
		this.override = null;
	}

	/** Resolve a locale through the chain: explicit -> settings/environment -> fallback. */
	public resolveLocale(explicit?: string | null): string {
		const fromExplicit = normalizeLocale(explicit);
		if (fromExplicit) return fromExplicit;

		if (this.localeSource) {
			let provided: string | null | undefined;
			try {
				provided = this.localeSource.getLocale();
			} catch {
				// A broken settings store must never break an execution — degrade to the fallback.
				provided = undefined;
			}
			const fromSource = normalizeLocale(provided);
			if (fromSource) return fromSource;
		}
		return this.fallbackLocale;
	}

	/** Active locale (the resolution chain, re-evaluated on every read). */
	public getLocale(): string {
		return this.resolveLocale(this.override);
	}

	/** Force the active locale. Strict: an unknown tag raises `UnsupportedLocaleError`. */
	public setLocale(input: string): string {
		const normalized = normalizeLocale(input);
		if (normalized === null) throw new UnsupportedLocaleError(input, this.getSupportedLocales());
		this.override = normalized;
		return normalized;
	}

	/** Drop an explicit `setLocale()` override and fall back to the sources again. */
	public clearLocale(): void {
		this.override = null;
	}

	/** Active script direction, for downstream serializers. */
	public getDirection(locale?: string | null): Direction {
		return directionOf(this.resolveLocale(locale ?? this.override));
	}

	/** Catalog codes (canonical only, aliases excluded). */
	public getSupportedLocales(): readonly string[] {
		return SUPPORTED_LOCALE_CODES;
	}

	/** Catalog metadata for the active locale (never `null` — falls back to the catalog entry). */
	public describe(locale?: string | null): LocaleDescriptor {
		const resolved = this.resolveLocale(locale ?? this.override);
		return (
			describeLocale(resolved) ??
			LOCALE_CATALOG.find((l) => l.code === this.fallbackLocale) ?? LOCALE_CATALOG[0]
		);
	}

	/** `true` when a key can be translated (overlay or dictionary owner). */
	public has(key: string, locale?: string | null): boolean {
		const resolved = this.resolveLocale(locale ?? this.override);
		if (typeof this.overlay[resolved]?.[key] === 'string') return true;
		const translated = this.lookup(key, resolved);
		return translated !== null && translated !== key;
	}

	/**
	 * Translate `key` for the active (or given) locale, then interpolate.
	 *
	 * Fallback order: overlay -> dictionary owner -> `en` overlay -> `en` dictionary -> the key
	 * itself. A key that had to fall through to itself is recorded in `getMissingKeys()`.
	 */
	public t(key: string, params?: InterpolationParams, locale?: string | null): string {
		const resolved = this.resolveLocale(locale ?? this.override);
		const template =
			this.overlay[resolved]?.[key] ??
			this.lookup(key, resolved) ??
			this.overlay[this.fallbackLocale]?.[key] ??
			this.lookup(key, this.fallbackLocale);

		if (template === null) {
			this.missing.add(key);
			return interpolate(key, params);
		}
		return interpolate(template, params);
	}

	/** Localize an engine execution status (`success` -> "Execution succeeded" in the active locale). */
	public tStatus(status: ExecutionStatus, params?: InterpolationParams, locale?: string | null): string {
		const key = STATUS_MESSAGE_KEYS[status];
		if (typeof key !== 'string') {
			this.missing.add(`status.${String(status)}`);
			return interpolate(String(status), params);
		}
		return this.t(key, params, locale);
	}

	/** Per-run audit payload for the execution logger. */
	public snapshot(): LocalizationSnapshot {
		const locale = this.getLocale();
		return {
			locale,
			direction: this.getDirection(locale),
			fallbackLocale: this.fallbackLocale,
			supportedLocales: SUPPORTED_LOCALE_CODES,
			missingKeys: this.getMissingKeys(),
		};
	}

	/** Keys that could not be translated since the last reset, sorted and de-duplicated. */
	public getMissingKeys(): readonly string[] {
		return [...this.missing].sort();
	}

	/** Clear diagnostics (called between executions so run data stays per-run). */
	public resetDiagnostics(): void {
		this.missing.clear();
	}

	/**
	 * Dictionary owner lookup. `null` when the owner has nothing for the key — including the
	 * "echo the key back" convention Phase 4B uses for unknown keys, which must stay diagnosable.
	 */
	private lookup(key: string, locale: string): string | null {
		if (!this.dictionaries) return null;
		try {
			const value = this.dictionaries.translate(key, locale);
			if (typeof value !== 'string' || value === '' || value === key) return null;
			return value;
		} catch {
			// A dictionary that throws is a diagnostics event, not an execution failure.
			return null;
		}
	}
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Wiring helpers — the only place the runtime touches the outside world, and only structurally.
 * ------------------------------------------------------------------------------------------------------------------ */

/** Build a runtime from an options bag (the exact shape Phase 4A/4B collaborators satisfy). */
export function createLocalizationRuntime(options: LocalizationOptions = {}): LocalizationRuntime {
	return new LocalizationRuntime(options);
}

/** Adapt the Phase 4A settings state object to a locale source without importing it. */
export function fromSettingsState(adapter: SettingsStatePort): LocaleSourcePort {
	return {
		getLocale: (): string | null => {
			try {
				return adapter.getState()?.currentLanguage ?? null;
			} catch {
				return null;
			}
		},
	};
}

/** Adapt a process environment map (`N8N_DEFAULT_LOCALE`, then `LANG`) to a locale source. */
export function fromEnvironment(env: Record<string, string | undefined> = {}): LocaleSourcePort {
	return {
		getLocale: (): string | null => env['N8N_DEFAULT_LOCALE'] ?? env['LANG'] ?? null,
	};
}

/** Fixed locale source — useful for deterministic tests and for pinned API responses. */
export function fromConstant(locale: string): LocaleSourcePort {
	return { getLocale: (): string => locale };
}

/** First source that resolves wins; `null` when none does. */
export function firstResolvingSource(...sources: LocaleSourcePort[]): LocaleSourcePort {
	return {
		getLocale: (): string | null => {
			for (const source of sources) {
				try {
					const value = normalizeLocale(source.getLocale());
					if (value) return value;
				} catch {
					// skip a broken source, keep walking the chain
				}
			}
			return null;
		},
	};
}
