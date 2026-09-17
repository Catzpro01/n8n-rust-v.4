// Backend Native Localization Hub & Multi-Language Dictionary
// Mendukung 6 Bahasa: Indonesia (id), English (en), Jawa (jv), Arab (ar), Mandarin (zh), Rusia (ru)

export type SupportedLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export interface LocaleMetadata {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
}

export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleMetadata> = {
  id: { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr' },
  en: { code: 'en', name: 'English', nativeName: 'English (US)', direction: 'ltr' },
  jv: { code: 'jv', name: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr' },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  zh: { code: 'zh', name: 'Chinese', nativeName: '中文 (简体)', direction: 'ltr' },
  ru: { code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr' },
};

export const NATIVE_DICTIONARIES: Record<SupportedLocale, Record<string, string>> = {
  id: {
    'execute.workflow': 'Jalankan alur kerja',
    'test.step': 'Uji langkah',
    'save.workflow': 'Simpan alur kerja',
    'add.step': 'Tambah langkah',
    'settings.title': 'Pengaturan',
    'settings.personal': 'Pengaturan Pribadi',
    'settings.language': 'Bahasa Tampilan',
    'node.success': 'Berhasil dieksekusi',
    'node.error': 'Gagal dieksekusi',
  },
  en: {
    'execute.workflow': 'Execute workflow',
    'test.step': 'Test step',
    'save.workflow': 'Save workflow',
    'add.step': 'Add step',
    'settings.title': 'Settings',
    'settings.personal': 'Personal Settings',
    'settings.language': 'Display Language',
    'node.success': 'Execution succeeded',
    'node.error': 'Execution failed',
  },
  jv: {
    'execute.workflow': 'Lakokake alur kerja',
    'test.step': 'Jajal jangkah',
    'save.workflow': 'Simpen alur kerja',
    'add.step': 'Tambah jangkah',
    'settings.title': 'Setelan',
    'settings.personal': 'Setelan Pribadi',
    'settings.language': 'Basa Tampilan',
    'node.success': 'Kasil dilakokake',
    'node.error': 'Gagal dilakokake',
  },
  ar: {
    'execute.workflow': 'تشغيل سير العمل',
    'test.step': 'اختبار الخطوة',
    'save.workflow': 'حفظ سير العمل',
    'add.step': 'إضافة خطوة',
    'settings.title': 'الإعدادات',
    'settings.personal': 'الإعدادات الشخصية',
    'settings.language': 'لغة العرض',
    'node.success': 'تم التنفيذ بنجاح',
    'node.error': 'فشل التنفيذ',
  },
  zh: {
    'execute.workflow': '执行工作流',
    'test.step': '测试步骤',
    'save.workflow': '保存工作流',
    'add.step': '添加步骤',
    'settings.title': '设置',
    'settings.personal': '个人设置',
    'settings.language': '显示语言',
    'node.success': '执行成功',
    'node.error': '执行失败',
  },
  ru: {
    'execute.workflow': 'Запустить процесс',
    'test.step': 'Тестировать шаг',
    'save.workflow': 'Сохранить процесс',
    'add.step': 'Добавить шаг',
    'settings.title': 'Настройки',
    'settings.personal': 'Личные настройки',
    'settings.language': 'Язык интерфейса',
    'node.success': 'Успешно выполнено',
    'node.error': 'Ошибка выполнения',
  },
};

export class NativeLocalizationService {
  private static activeLocale: SupportedLocale = 'id';

  public static setLocale(locale: SupportedLocale): void {
    if (SUPPORTED_LOCALES[locale]) {
      this.activeLocale = locale;
    }
  }

  public static getLocale(): SupportedLocale {
    return this.activeLocale;
  }

  public static getSupportedLocales(): LocaleMetadata[] {
    return Object.values(SUPPORTED_LOCALES);
  }

  public static translate(key: string, locale?: SupportedLocale): string {
    const loc = locale || this.activeLocale;
    return NATIVE_DICTIONARIES[loc]?.[key] || NATIVE_DICTIONARIES['en']?.[key] || key;
  }
}
