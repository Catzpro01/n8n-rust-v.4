/**
 * Native Settings Localization Adapter (Phase 4A → Phase 4B) — a thin projection of the
 * hub (`backend-localization-service.ts`).
 *
 * Phase 4A carried its own two-language list ('id' | 'en') and Phase 4B widened it to six
 * entries with hand-written labels; both were second sources of truth that would drift on
 * the next locale change. The adapter now reads `SUPPORTED_LOCALES`, so the locale set, the
 * display names, the writing direction and the active locale live in exactly one place.
 *
 * It is a settings *state* projection only: it renders nothing and never touches the Vue
 * editor bundle (PROJECT_RULES §2). Browser storage is delegated to the hub's persistence
 * port, so this module stays free of `localStorage` access in Node.
 *
 * The Phase 4A/4B call shapes are preserved: `label` (English name), `nativeLabel`
 * (native name), `nativeName` (alias), `getSupportedLanguages()`, `isRTL()`,
 * `suppressAggressiveUpdateNotice()`.
 */
import {
	NativeLocalizationService,
	SUPPORTED_LOCALES,
	type LocaleMetadata,
	type SupportedLocale,
	type TranslateOptions,
} from './backend-localization-service';

/** Widened from 'id' | 'en' to the full supported set (superset, so old callers keep working). */
export type LanguageCode = SupportedLocale;

export interface SupportedLanguageEntry {
	code: LanguageCode;
	/** English display name (`'Javanese'`). */
	label: string;
	/** Native display name (`'Basa Jawa'`). */
	nativeLabel: string;
	/** Alias of `nativeLabel` (Phase 4B spelling). */
	nativeName: string;
	direction: 'ltr' | 'rtl';
}

export interface LocalizationSettingsState {
	currentLanguage: LanguageCode;
	supportedLanguages: SupportedLanguageEntry[];
	isUpdateNoticeSuppressed: boolean;
	/** Writing direction of `currentLanguage` — RTL locales must not flip the layout blindly. */
	direction: 'ltr' | 'rtl';
}

const toEntry = (meta: LocaleMetadata): SupportedLanguageEntry => ({
	code: meta.code,
	label: meta.name,
	nativeLabel: meta.nativeName,
	nativeName: meta.nativeName,
	direction: meta.direction,
});

export class SettingsLocalizationAdapter {
	private static isUpdateNoticeSuppressed = true;

	public static getState(): LocalizationSettingsState {
		const currentLanguage = NativeLocalizationService.getLocale();
		return {
			currentLanguage,
			supportedLanguages: Object.values(SUPPORTED_LOCALES).map(toEntry),
			isUpdateNoticeSuppressed: this.isUpdateNoticeSuppressed,
			direction: NativeLocalizationService.getDirection(currentLanguage),
		};
	}

	/** Normalises the input through the hub (`'ar-SA'` → `'ar'`, unknown → English base). */
	public static setLanguage(lang: LanguageCode | string): LanguageCode {
		return NativeLocalizationService.setLocale(lang);
	}

	public static getSupportedLanguages(): SupportedLanguageEntry[] {
		return Object.values(SUPPORTED_LOCALES).map(toEntry);
	}

	public static isRTL(lang?: LanguageCode | string): boolean {
		return NativeLocalizationService.isRtl(lang ?? NativeLocalizationService.getLocale());
	}

	public static suppressAggressiveUpdateNotice(): boolean {
		this.isUpdateNoticeSuppressed = true;
		NativeLocalizationService.suppressUpdateBanner();
		return true;
	}

	/** Binds `localStorage` (browser only) and hydrates the stored preference. */
	public static attachBrowserStorage(): LanguageCode {
		return NativeLocalizationService.attachBrowserStorage();
	}

	/** Convenience passthrough so settings views do not import the hub directly. */
	public static translate(key: string, options?: TranslateOptions | LanguageCode | string): string {
		return NativeLocalizationService.translate(key, options);
	}
}
