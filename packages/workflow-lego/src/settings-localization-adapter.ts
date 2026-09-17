// Native Settings Localization Adapter (Phase 4A)
// Menyediakan bridge pengaturan bahasa resmi ke antarmuka pengguna tanpa floating pills.

import {
  NativeLocalizationService,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALES,
  type LocaleInput,
  type SupportedLocale,
} from './backend-localization-service';

export type LanguageCode = SupportedLocale;

export interface LocalizationSettingsState {
  currentLanguage: LanguageCode;
  supportedLanguages: Array<{ code: LanguageCode; label: string }>;
  isUpdateNoticeSuppressed: boolean;
}

export class SettingsLocalizationAdapter {
  private static state: LocalizationSettingsState = {
    currentLanguage: 'id',
    supportedLanguages: SUPPORTED_LOCALE_CODES.map((code) => ({
      code,
      label: SUPPORTED_LOCALES[code].nativeName,
    })),
    isUpdateNoticeSuppressed: true,
  };

  public static getState(): LocalizationSettingsState {
    return {
      ...this.state,
      supportedLanguages: this.state.supportedLanguages.map((language) => ({ ...language })),
    };
  }

  public static setLanguage(language: LocaleInput): LanguageCode {
    const normalized = NativeLocalizationService.normalizeLocale(language, this.state.currentLanguage);
    this.state.currentLanguage = normalized;
    NativeLocalizationService.setLocale(normalized);
    return normalized;
  }

  public static getLanguage(): LanguageCode {
    return this.state.currentLanguage;
  }

  public static suppressAggressiveUpdateNotice(): boolean {
    this.state.isUpdateNoticeSuppressed = true;
    return true;
  }
}
