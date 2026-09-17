// Native Settings Localization Adapter (Phase 4B — 6 languages)
// Menyediakan bridge pengaturan bahasa resmi ke antarmuka pengguna tanpa floating pills.
// 1:1 dari NativeLocalizationService, mendukung 6 bahasa: ID, EN, JV, AR, ZH, RU

export type LanguageCode = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export interface LocalizationSettingsState {
  currentLanguage: LanguageCode;
  supportedLanguages: Array<{ code: LanguageCode; label: string; nativeLabel: string; direction: 'ltr' | 'rtl' }>;
  isUpdateNoticeSuppressed: boolean;
}

export class SettingsLocalizationAdapter {
  private static state: LocalizationSettingsState = {
    currentLanguage: 'id',
    supportedLanguages: [
      { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', direction: 'ltr' },
      { code: 'en', label: 'English', nativeLabel: 'English (US)', direction: 'ltr' },
      { code: 'jv', label: 'Javanese', nativeLabel: 'Basa Jawa', direction: 'ltr' },
      { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', direction: 'rtl' },
      { code: 'zh', label: 'Chinese', nativeLabel: '中文 (简体)', direction: 'ltr' },
      { code: 'ru', label: 'Russian', nativeLabel: 'Русский', direction: 'ltr' },
    ],
    isUpdateNoticeSuppressed: true,
  };

  public static getState(): LocalizationSettingsState {
    return { ...this.state, supportedLanguages: [...this.state.supportedLanguages] };
  }

  public static setLanguage(lang: LanguageCode): void {
    if (this.state.supportedLanguages.some(l => l.code === lang)) {
      this.state.currentLanguage = lang;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('n8n_locale', lang);
      }
    }
  }

  public static suppressAggressiveUpdateNotice(): boolean {
    this.state.isUpdateNoticeSuppressed = true;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('n8n_update_notice_suppressed', 'true');
    }
    return true;
  }

  public static getSupportedLanguages(): LocalizationSettingsState['supportedLanguages'] {
    return [...this.state.supportedLanguages];
  }

  public static isRTL(lang?: LanguageCode): boolean {
    const code = lang || this.state.currentLanguage;
    return this.state.supportedLanguages.find(l => l.code === code)?.direction === 'rtl';
  }
}

