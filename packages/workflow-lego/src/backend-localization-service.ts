// Backend Native Localization Hub & Multi-Language Dictionary
// Mendukung 6 Bahasa: Indonesia (id), English (en), Jawa (jv), Arab (ar), Mandarin (zh), Rusia (ru)
//
// Phase 4C: ditambah kunci kamus `param.*` (validasi parameter node) untuk keenam
// bahasa, interpolasi `{placeholder}` pada translate(), dan isSupported().

export type SupportedLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export interface LocaleMetadata {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
}

export type TranslationParams = Record<string, string | number>;

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
    'param.required': 'Parameter "{name}" wajib diisi.',
    'param.invalid_number': 'Nilai "{value}" harus berupa angka yang valid.',
    'param.below_min': 'Nilai {value} lebih kecil dari batas minimum {min}.',
    'param.above_max': 'Nilai {value} lebih besar dari batas maksimum {max}.',
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
    'param.required': 'Parameter "{name}" is required.',
    'param.invalid_number': 'Value "{value}" must be a valid number.',
    'param.below_min': 'Value {value} is below the minimum limit of {min}.',
    'param.above_max': 'Value {value} exceeds the maximum limit of {max}.',
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
    'param.required': 'Parameter "{name}" kudu diisi.',
    'param.invalid_number': 'Nilai "{value}" kudu awujud angka sing bener.',
    'param.below_min': 'Nilai {value} luwih cilik saka wates minimal {min}.',
    'param.above_max': 'Nilai {value} luwih gedhe saka wates maksimal {max}.',
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
    'param.required': 'المعامل "{name}" مطلوب.',
    'param.invalid_number': 'يجب أن تكون القيمة "{value}" رقمًا صالحًا.',
    'param.below_min': 'القيمة {value} أصغر من الحد الأدنى {min}.',
    'param.above_max': 'القيمة {value} أكبر من الحد الأقصى {max}.',
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
    'param.required': '参数 "{name}" 为必填项。',
    'param.invalid_number': '值 "{value}" 必须是有效的数字。',
    'param.below_min': '值 {value} 小于最小限制 {min}。',
    'param.above_max': '值 {value} 大于最大限制 {max}。',
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
    'param.required': 'Параметр "{name}" обязателен для заполнения.',
    'param.invalid_number': 'Значение "{value}" должно быть корректным числом.',
    'param.below_min': 'Значение {value} меньше минимального предела {min}.',
    'param.above_max': 'Значение {value} больше максимального предела {max}.',
  },
};

const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
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

  public static isSupported(locale: string): locale is SupportedLocale {
    return Object.prototype.hasOwnProperty.call(SUPPORTED_LOCALES, locale);
  }

  public static getSupportedLocales(): LocaleMetadata[] {
    return Object.values(SUPPORTED_LOCALES);
  }

  public static translate(key: string, locale?: SupportedLocale, params?: TranslationParams): string {
    const loc = locale || this.activeLocale;
    const template =
      NATIVE_DICTIONARIES[loc]?.[key] || NATIVE_DICTIONARIES['en']?.[key] || key;
    return interpolate(template, params);
  }
}
