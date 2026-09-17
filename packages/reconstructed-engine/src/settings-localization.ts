// Settings & Native Localization Hub
// Menyediakan manajemen preferensi bahasa (Bahasa Indonesia / English) native di Settings.
export type SupportedLanguage = 'en' | 'id';

export interface UserLocalizationConfig {
  locale: SupportedLanguage;
  dateFormat: string;
  numberFormat: string;
}

export class LocalizationManager {
  private static currentLocale: SupportedLanguage = 'id';

  public static setLocale(locale: SupportedLanguage): void {
    this.currentLocale = locale;
  }

  public static getLocale(): SupportedLanguage {
    return this.currentLocale;
  }

  public static getTranslations(locale: SupportedLanguage): Record<string, string> {
    if (locale === 'id') {
      return {
        'settings.personal.title': 'Pengaturan Pribadi',
        'settings.personal.language': 'Bahasa Tampilan',
        'settings.personal.save': 'Simpan Pengaturan',
      };
    }
    return {
      'settings.personal.title': 'Personal Settings',
      'settings.personal.language': 'Display Language',
      'settings.personal.save': 'Save Settings',
    };
  }
}
