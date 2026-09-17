// Backend Native Localization Hub & Multi-Language Dictionary
// Mendukung 6 Bahasa: Indonesia (id), English (en), Jawa (jv), Arab (ar), Mandarin (zh), Rusia (ru)
// 1:1 dari n8n 2.9.4 editor-ui localization, tanpa floating pills, 100% native bridge

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
    'workflow.active': 'Alur kerja aktif',
    'workflow.inactive': 'Alur kerja tidak aktif',
    'execution.started': 'Eksekusi dimulai',
    'execution.finished': 'Eksekusi selesai',
    'connection.valid': 'Koneksi valid',
    'connection.invalid': 'Koneksi tidak valid',
    'validation.cycle': 'Siklus terdeteksi',
    'validation.dangling': 'Koneksi menggantung',
    'error.natural': 'Node gagal dieksekusi',
    'banner.update.suppressed': 'Banner update diredam',
    'canvas.protected': 'Canvas dilindungi',
    'credential.sanitized': 'Kredensial disanitasi',
    'system.healthy': 'Sistem sehat',
    'system.recovered': 'Sistem dipulihkan otomatis',
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
    'workflow.active': 'Workflow active',
    'workflow.inactive': 'Workflow inactive',
    'execution.started': 'Execution started',
    'execution.finished': 'Execution finished',
    'connection.valid': 'Connection valid',
    'connection.invalid': 'Connection invalid',
    'validation.cycle': 'Cycle detected',
    'validation.dangling': 'Dangling connection',
    'error.natural': 'Node execution failed',
    'banner.update.suppressed': 'Update banner suppressed',
    'canvas.protected': 'Canvas protected',
    'credential.sanitized': 'Credential sanitized',
    'system.healthy': 'System healthy',
    'system.recovered': 'System auto-recovered',
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
    'workflow.active': 'Alur kerja aktif',
    'workflow.inactive': 'Alur kerja ora aktif',
    'execution.started': 'Eksekusi diwiwiti',
    'execution.finished': 'Eksekusi rampung',
    'connection.valid': 'Koneksi valid',
    'connection.invalid': 'Koneksi ora valid',
    'validation.cycle': 'Siklus kedeteksi',
    'validation.dangling': 'Koneksi nggantung',
    'error.natural': 'Node gagal dilakokake',
    'banner.update.suppressed': 'Banner update diredam',
    'canvas.protected': 'Canvas dilindungi',
    'credential.sanitized': 'Kredensial disanitasi',
    'system.healthy': 'Sistem sehat',
    'system.recovered': 'Sistem dipulihake otomatis',
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
    'workflow.active': 'سير العمل نشط',
    'workflow.inactive': 'سير العمل غير نشط',
    'execution.started': 'بدأ التنفيذ',
    'execution.finished': 'انتهى التنفيذ',
    'connection.valid': 'الاتصال صالح',
    'connection.invalid': 'الاتصال غير صالح',
    'validation.cycle': 'تم اكتشاف دورة',
    'validation.dangling': 'اتصال معلق',
    'error.natural': 'فشل تنفيذ العقدة',
    'banner.update.suppressed': 'تم كبح لافتة التحديث',
    'canvas.protected': 'اللوحة محمية',
    'credential.sanitized': 'تم تطهير بيانات الاعتماد',
    'system.healthy': 'النظام سليم',
    'system.recovered': 'تم استرداد النظام تلقائياً',
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
    'workflow.active': '工作流已激活',
    'workflow.inactive': '工作流未激活',
    'execution.started': '执行已开始',
    'execution.finished': '执行已完成',
    'connection.valid': '连接有效',
    'connection.invalid': '连接无效',
    'validation.cycle': '检测到循环',
    'validation.dangling': '悬空连接',
    'error.natural': '节点执行失败',
    'banner.update.suppressed': '更新横幅已抑制',
    'canvas.protected': '画布已保护',
    'credential.sanitized': '凭证已清理',
    'system.healthy': '系统健康',
    'system.recovered': '系统已自动恢复',
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
    'workflow.active': 'Процесс активен',
    'workflow.inactive': 'Процесс неактивен',
    'execution.started': 'Выполнение начато',
    'execution.finished': 'Выполнение завершено',
    'connection.valid': 'Соединение допустимо',
    'connection.invalid': 'Соединение недопустимо',
    'validation.cycle': 'Обнаружен цикл',
    'validation.dangling': 'Висячее соединение',
    'error.natural': 'Ошибка выполнения узла',
    'banner.update.suppressed': 'Баннер обновления подавлен',
    'canvas.protected': 'Холст защищён',
    'credential.sanitized': 'Учётные данные очищены',
    'system.healthy': 'Система исправна',
    'system.recovered': 'Система автоматически восстановлена',
  },
};

export class NativeLocalizationService {
  private static activeLocale: SupportedLocale = 'id';

  public static setLocale(locale: SupportedLocale): void {
    if (SUPPORTED_LOCALES[locale]) {
      this.activeLocale = locale;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('n8n_locale', locale);
      }
    }
  }

  public static getLocale(): SupportedLocale {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('n8n_locale') as SupportedLocale;
      if (stored && SUPPORTED_LOCALES[stored]) return stored;
    }
    return this.activeLocale;
  }

  public static getSupportedLocales(): LocaleMetadata[] {
    return Object.values(SUPPORTED_LOCALES);
  }

  public static translate(key: string, locale?: SupportedLocale): string {
    const loc = locale || this.getLocale();
    return NATIVE_DICTIONARIES[loc]?.[key] || NATIVE_DICTIONARIES['en']?.[key] || key;
  }

  public static isRTL(locale?: SupportedLocale): boolean {
    const loc = locale || this.getLocale();
    return SUPPORTED_LOCALES[loc]?.direction === 'rtl';
  }

  public static getDirection(locale?: SupportedLocale): 'ltr' | 'rtl' {
    const loc = locale || this.getLocale();
    return SUPPORTED_LOCALES[loc]?.direction || 'ltr';
  }

  public static suppressUpdateBanner(): boolean {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('n8n_update_notice_suppressed', 'true');
    }
    return true;
  }

  public static formatExecutionMessage(key: string, params?: Record<string, string>): string {
    let msg = this.translate(key);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(`{${k}}`, v);
      }
    }
    return msg;
  }
}

