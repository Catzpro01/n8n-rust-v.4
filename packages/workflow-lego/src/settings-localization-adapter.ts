// Native Settings Localization Adapter (Phase 4A)
// Menyediakan bridge pengaturan bahasa resmi ke antarmuka pengguna tanpa floating pills.

export type LanguageCode = 'id' | 'en';

export interface LocalizationSettingsState {
  currentLanguage: LanguageCode;
  supportedLanguages: Array<{ code: LanguageCode; label: string }>;
  isUpdateNoticeSuppressed: boolean;
}

export class SettingsLocalizationAdapter {
  private static state: LocalizationSettingsState = {
    currentLanguage: 'id',
    supportedLanguages: [
      { code: 'id', label: 'Bahasa Indonesia' },
      { code: 'en', label: 'English (US)' },
    ],
    isUpdateNoticeSuppressed: true,
  };

  public static getState(): LocalizationSettingsState {
    return { ...this.state };
  }

  public static setLanguage(lang: LanguageCode): void {
    this.state.currentLanguage = lang;
  }

  public static suppressAggressiveUpdateNotice(): boolean {
    this.state.isUpdateNoticeSuppressed = true;
    return true;
  }
}
