// Settings Personal View Bridge — Native Language Switcher Integration
// Mengadaptasi SettingsPersonalView.vue asli n8n 2.9.4 tanpa mengubah UI

export type LanguageCode = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export interface PersonalSettingsBridge {
  currentLanguage: LanguageCode;
  timezone: string;
  theme: 'light' | 'dark' | 'system';
}

export class SettingsPersonalViewBridge {
  private static instance: SettingsPersonalViewBridge;
  private state: PersonalSettingsBridge = {
    currentLanguage: 'id',
    timezone: 'Asia/Jakarta',
    theme: 'system',
  };

  static getInstance(): SettingsPersonalViewBridge {
    if (!this.instance) this.instance = new SettingsPersonalViewBridge();
    return this.instance;
  }

  getState(): PersonalSettingsBridge {
    return { ...this.state };
  }

  setLanguage(lang: LanguageCode): void {
    this.state.currentLanguage = lang;
    // Bridge ke NativeLocalizationService tanpa floating pills
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('n8n_locale', lang);
    }
  }

  suppressUpdateNotice(): boolean {
    // Redam banner update agresif — hanya flag, tidak ubah UI
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('n8n_update_notice_suppressed', 'true');
    }
    return true;
  }
}
