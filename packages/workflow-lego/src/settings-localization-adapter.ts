// Native Settings Localization Adapter (Phase 4A → harmonized in Phase 4C)
// Menyediakan bridge pengaturan bahasa resmi ke antarmuka pengguna tanpa floating pills.
//
// Phase 4C: daftar bahasa tidak lagi di-hardcode 2 entri (id/en) — kini diturunkan
// penuh dari SUPPORTED_LOCALES milik NativeLocalizationService (6 bahasa), dan
// setLanguage() menyinkronkan locale aktif pada hub sehingga seluruh pesan
// backend (termasuk validasi parameter) mengikuti satu sumber kebenaran.

import {
  SUPPORTED_LOCALES,
  NativeLocalizationService,
  type SupportedLocale,
} from './backend-localization-service';

export type LanguageCode = SupportedLocale;

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  direction: 'ltr' | 'rtl';
}

export interface LocalizationSettingsState {
  currentLanguage: LanguageCode;
  supportedLanguages: Array<{ code: LanguageCode; label: string }>;
  isUpdateNoticeSuppressed: boolean;
}

const languageOptions: LanguageOption[] = Object.values(SUPPORTED_LOCALES).map((meta) => ({
  code: meta.code,
  label: meta.nativeName,
  direction: meta.direction,
}));

export class SettingsLocalizationAdapter {
  private static state: LocalizationSettingsState = {
    currentLanguage: 'id',
    supportedLanguages: languageOptions.map(({ code, label }) => ({ code, label })),
    isUpdateNoticeSuppressed: true,
  };

  public static getState(): LocalizationSettingsState {
    return { ...this.state };
  }

  public static getSupportedLanguages(): LanguageOption[] {
    return languageOptions.map((option) => ({ ...option }));
  }

  public static setLanguage(lang: LanguageCode): boolean {
    if (!SUPPORTED_LOCALES[lang]) {
      return false;
    }
    this.state.currentLanguage = lang;
    // Satu sumber kebenaran: locale hub ikut berubah agar pesan backend
    // (validasi parameter, notifikasi) dirender dalam bahasa yang sama.
    NativeLocalizationService.setLocale(lang);
    return true;
  }

  public static getDirection(): 'ltr' | 'rtl' {
    return SUPPORTED_LOCALES[this.state.currentLanguage].direction;
  }

  public static suppressAggressiveUpdateNotice(): boolean {
    this.state.isUpdateNoticeSuppressed = true;
    return true;
  }
}
