// Native Settings Localization Adapter (Phase 4A → disinkronkan ke Phase 4B)
// Menyediakan bridge pengaturan bahasa resmi ke antarmuka pengguna tanpa floating pills.
// Sejak Phase 4B: mendukung 6 locale (id, en, jv, ar, zh, ru) dan meneruskan
// pilihan bahasa ke NativeLocalizationService sebagai sumber kebenaran backend.

import {
	NativeLocalizationService,
	SUPPORTED_LOCALES,
} from './backend-localization-service';
import type { SupportedLocale } from './backend-localization-service';

/** Kode bahasa yang didukung (Phase 4B: 6 locale). Alias SupportedLocale. */
export type LanguageCode = SupportedLocale;

export interface LocalizationSettingsState {
	currentLanguage: LanguageCode;
	supportedLanguages: Array<{ code: LanguageCode; label: string }>;
	isUpdateNoticeSuppressed: boolean;
}

export class SettingsLocalizationAdapter {
	private static state: LocalizationSettingsState = {
		currentLanguage: NativeLocalizationService.getLocale(),
		supportedLanguages: Object.values(SUPPORTED_LOCALES).map((meta) => ({
			code: meta.code,
			label: meta.nativeName,
		})),
		isUpdateNoticeSuppressed: true,
	};

	public static getState(): LocalizationSettingsState {
		return {
			...this.state,
			// Sumber kebenaran locale adalah NativeLocalizationService (Phase 4B).
			currentLanguage: NativeLocalizationService.getLocale(),
			supportedLanguages: this.state.supportedLanguages.map((entry) => ({ ...entry })),
		};
	}

	/**
	 * Ganti bahasa tampilan. Kode di luar 6 locale yang didukung ditolak
	 * (state tidak berubah) — perilaku Phase 4A dipertahankan untuk id/en.
	 */
	public static setLanguage(lang: LanguageCode): void {
		if (!SUPPORTED_LOCALES[lang]) return;
		NativeLocalizationService.setLocale(lang);
		this.state.currentLanguage = lang;
	}

	public static suppressAggressiveUpdateNotice(): boolean {
		this.state.isUpdateNoticeSuppressed = true;
		return true;
	}
}
