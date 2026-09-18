// Native Settings Localization Adapter (Phase 4A → Agent-5 locale-parity fix)
// Menyediakan bridge pengaturan bahasa resmi ke antarmuka pengguna tanpa floating pills.
//
// OWNERSHIP: language-preference persistence. `manifest/ownership.json` of this
// package explicitly lists "persistence" under `doesNotOwn`, so this file is
// maintained by LEGO 05 — PERSISTENCE (agent-5), not by the Workflow LEGO.
// It stays self-contained (no imports) so it cannot widen the Workflow LEGO
// boundary; the locale set is kept in parity with the two other locale
// surfaces by tools/localization-leak-gate.mjs (gate G08):
//   - packages/workflow-lego/src/backend-localization-service.ts
//   - packages/reconstructed-engine/src/persistence-locale-store.ts
//
// PHASE-4A BUG FIXED HERE: the adapter only offered `id` and `en` while the
// runtime dictionary offers six locales (id, en, jv, ar, zh, ru). Picking
// Javanese, Arabic, Chinese or Russian in the backend therefore left the
// settings screen in Indonesian — a cross-language inconsistency that the
// Zero-Cross-Language-Leak rule forbids.

export type LanguageCode = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export interface SupportedLanguage {
	code: LanguageCode;
	label: string;
	nativeName: string;
	direction: 'ltr' | 'rtl';
}

export interface LocalizationSettingsState {
	currentLanguage: LanguageCode;
	supportedLanguages: SupportedLanguage[];
	isUpdateNoticeSuppressed: boolean;
}

/** Mirrors the minimal storage contract of the persistence store (no import on purpose). */
export interface SettingsStorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export const SETTINGS_LOCALE_STORAGE_KEY = 'n8n.persistence.locale';

export const DEFAULT_LANGUAGE: LanguageCode = 'id';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
	{ code: 'id', label: 'Bahasa Indonesia', nativeName: 'Bahasa Indonesia', direction: 'ltr' },
	{ code: 'en', label: 'English (US)', nativeName: 'English (US)', direction: 'ltr' },
	{ code: 'jv', label: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr' },
	{ code: 'ar', label: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
	{ code: 'zh', label: 'Chinese', nativeName: '中文 (简体)', direction: 'ltr' },
	{ code: 'ru', label: 'Russian', nativeName: 'Русский', direction: 'ltr' },
];

const MEMORY_FALLBACK = new Map<string, string>();

export class SettingsLocalizationAdapter {
	private static state: LocalizationSettingsState = {
		currentLanguage: DEFAULT_LANGUAGE,
		supportedLanguages: SUPPORTED_LANGUAGES.map((entry) => ({ ...entry })),
		isUpdateNoticeSuppressed: true,
	};

	private static storage: SettingsStorageLike | null = null;

	public static getState(): LocalizationSettingsState {
		return {
			...this.state,
			supportedLanguages: this.state.supportedLanguages.map((entry) => ({ ...entry })),
		};
	}

	/** Injects the persistence backend (localStorage in the browser, memory in Node). */
	public static useStorage(storage: SettingsStorageLike | null): void {
		this.storage = storage;
		if (storage) {
			this.hydrate();
		}
	}

	/** Restores the persisted preference; unknown values fall back to `id`. */
	public static hydrate(): LanguageCode {
		if (!this.storage) {
			return this.state.currentLanguage;
		}
		let persisted: string | null = null;
		try {
			persisted = this.storage.getItem(SETTINGS_LOCALE_STORAGE_KEY);
		} catch {
			persisted = null;
		}
		return this.setLanguage(persisted ?? this.state.currentLanguage, false);
	}

	/** Applies (and persists) the display language. Unknown codes fall back to `id`. */
	public static setLanguage(lang: string, persist = true): LanguageCode {
		const next = this.isSupported(lang) ? (lang as LanguageCode) : DEFAULT_LANGUAGE;
		this.state.currentLanguage = next;
		if (persist) {
			this.persist(next);
		}
		return next;
	}

	public static isSupported(lang: string): boolean {
		return SUPPORTED_LANGUAGES.some((entry) => entry.code === lang);
	}

	public static getSupportedLanguages(): SupportedLanguage[] {
		return SUPPORTED_LANGUAGES.map((entry) => ({ ...entry }));
	}

	public static getDirection(): 'ltr' | 'rtl' {
		const match = SUPPORTED_LANGUAGES.find((entry) => entry.code === this.state.currentLanguage);
		return match ? match.direction : 'ltr';
	}

	public static suppressAggressiveUpdateNotice(): boolean {
		this.state.isUpdateNoticeSuppressed = true;
		return true;
	}

	private static persist(language: LanguageCode): void {
		if (this.storage) {
			try {
				this.storage.setItem(SETTINGS_LOCALE_STORAGE_KEY, language);
				return;
			} catch {
				/* fall through to the in-memory fallback */
			}
		}
		MEMORY_FALLBACK.set(SETTINGS_LOCALE_STORAGE_KEY, language);
	}
}
