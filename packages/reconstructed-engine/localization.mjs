/**
 * Native backend localization primitives for the reconstructed engine.
 *
 * This is the runtime companion to workflow-lego/src/backend-localization-service.ts.
 * It intentionally localizes only known human-facing fields and never mutates the
 * caller's workflow or execution data.
 */

export const SUPPORTED_LOCALE_CODES = Object.freeze(['id', 'jv', 'ar', 'zh', 'ru', 'en']);

export const SUPPORTED_LOCALES = Object.freeze({
  id: Object.freeze({ code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr' }),
  jv: Object.freeze({ code: 'jv', name: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr' }),
  ar: Object.freeze({ code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' }),
  zh: Object.freeze({ code: 'zh', name: 'Chinese', nativeName: '中文 (简体)', direction: 'ltr' }),
  ru: Object.freeze({ code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr' }),
  en: Object.freeze({ code: 'en', name: 'English', nativeName: 'English (US)', direction: 'ltr' }),
});

export const PROTECTED_MACHINE_KEYS = Object.freeze([
  'name',
  'type',
  'value',
  'inputs',
  'outputs',
  'routing',
  'requestRules',
]);

const PROTECTED_MACHINE_KEY_SET = new Set(PROTECTED_MACHINE_KEYS.map((key) => key.toLowerCase()));
export const HUMAN_FACING_KEYS = Object.freeze([
  'label',
  'displayName',
  'description',
  'placeholder',
  'hint',
  'title',
  'message',
  'text',
  'summary',
  'statusText',
  'errorMessage',
  'successMessage',
  'failureMessage',
  'helpText',
  'tooltip',
  'buttonLabel',
  'labelText',
  'caption',
  'ariaLabel',
  'header',
  'subheader',
  'emptyState',
  'optionLabel',
  'inputLabel',
  'send',
  'newSession',
  'session',
  'input',
  'inputPlaceholder',
  'zoomIn',
  'zoomOut',
  'fitView',
  'cancel',
  'confirm',
  'close',
  'back',
  'next',
  'loading',
  'retry',
  'parameter',
  'parameters',
  'option',
  'options',
  'subtitle',
  'workspace',
]);
const HUMAN_FACING_KEY_SET = new Set(HUMAN_FACING_KEYS.map((key) => key.toLowerCase()));
const NON_LOCALIZABLE_KEYS = new Set([
  'node',
  'id',
  'uuid',
  'key',
  'index',
  'inputcount',
  'outputcount',
  'durationms',
  'data',
  'json',
  'parameters',
  'staticdata',
  'pindata',
  'connections',
  'credentials',
  'binary',
  'expression',
  'status',
]);
const TRANSLATION_KEY_FIELDS = new Set(['i18nkey', 'translationkey', 'localekey']);

export const NATIVE_DICTIONARIES = Object.freeze({
  id: Object.freeze({
    'execute.workflow': 'Jalankan alur kerja',
    'test.step': 'Uji langkah',
    'save.workflow': 'Simpan alur kerja',
    'add.step': 'Tambah langkah',
    'settings.title': 'Pengaturan',
    'settings.personal': 'Pengaturan Pribadi',
    'settings.language': 'Bahasa Tampilan',
    'node.success': 'Berhasil dieksekusi',
    'node.error': 'Gagal dieksekusi',
    'node.description': 'Deskripsi node',
    'node.parameters': 'Parameter',
    'node.options': 'Opsi',
    'node.placeholder': 'Masukkan nilai',
    'node.hint': 'Petunjuk',
    'node.required': 'Wajib diisi',
    'node.optional': 'Opsional',
    'execution.running': 'Sedang berjalan',
    'execution.waiting': 'Menunggu',
    'execution.completed': 'Selesai',
    'execution.failed': 'Gagal',
    'execution.cancelled': 'Dibatalkan',
    'execution.success': 'Berhasil',
    'execution.error': 'Kesalahan eksekusi',
    'chat.session': 'Sesi chat',
    'chat.newSession': 'Sesi baru',
    'chat.send': 'Kirim',
    'chat.inputPlaceholder': 'Tulis pesan...',
    'chat.empty': 'Belum ada pesan',
    'chat.error': 'Terjadi kesalahan pada chat',
    'canvas.subtitle': 'Kanvas alur kerja',
    'canvas.zoomIn': 'Perbesar',
    'canvas.zoomOut': 'Perkecil',
    'canvas.fitView': 'Sesuaikan tampilan',
    'common.cancel': 'Batal',
    'common.confirm': 'Konfirmasi',
    'common.close': 'Tutup',
    'common.back': 'Kembali',
    'common.next': 'Berikutnya',
    'common.loading': 'Memuat',
    'common.retry': 'Coba lagi',
  }),
  jv: Object.freeze({
    'execute.workflow': 'Lakokake alur kerja',
    'test.step': 'Jajal jangkah',
    'save.workflow': 'Simpen alur kerja',
    'add.step': 'Tambah jangkah',
    'settings.title': 'Setelan',
    'settings.personal': 'Setelan Pribadi',
    'settings.language': 'Basa Tampilan',
    'node.success': 'Kasil dilakokake',
    'node.error': 'Gagal dilakokake',
    'node.description': 'Andharan node',
    'node.parameters': 'Parameter',
    'node.options': 'Pilihan',
    'node.placeholder': 'Lebokna nilai',
    'node.hint': 'Pituduh',
    'node.required': 'Kudu diisi',
    'node.optional': 'Ora wajib',
    'execution.running': 'Lagi mlaku',
    'execution.waiting': 'Ngenteni',
    'execution.completed': 'Rampung',
    'execution.failed': 'Gagal',
    'execution.cancelled': 'Dibatalake',
    'execution.success': 'Kasil',
    'execution.error': 'Kaluputan eksekusi',
    'chat.session': 'Sesi chat',
    'chat.newSession': 'Sesi anyar',
    'chat.send': 'Kirim',
    'chat.inputPlaceholder': 'Tulis pesen...',
    'chat.empty': 'Durung ana pesen',
    'chat.error': 'Ana kaluputan ing chat',
    'canvas.subtitle': 'Kanvas alur kerja',
    'canvas.zoomIn': 'Gedhekna',
    'canvas.zoomOut': 'Cilikna',
    'canvas.fitView': 'Cocogna tampilan',
    'common.cancel': 'Batal',
    'common.confirm': 'Konfirmasi',
    'common.close': 'Tutup',
    'common.back': 'Mbalik',
    'common.next': 'Sabanjure',
    'common.loading': 'Muat',
    'common.retry': 'Coba maneh',
  }),
  ar: Object.freeze({
    'execute.workflow': 'تشغيل سير العمل',
    'test.step': 'اختبار الخطوة',
    'save.workflow': 'حفظ سير العمل',
    'add.step': 'إضافة خطوة',
    'settings.title': 'الإعدادات',
    'settings.personal': 'الإعدادات الشخصية',
    'settings.language': 'لغة العرض',
    'node.success': 'تم التنفيذ بنجاح',
    'node.error': 'فشل التنفيذ',
    'node.description': 'وصف العقدة',
    'node.parameters': 'المعلمات',
    'node.options': 'الخيارات',
    'node.placeholder': 'أدخل قيمة',
    'node.hint': 'تلميح',
    'node.required': 'مطلوب',
    'node.optional': 'اختياري',
    'execution.running': 'قيد التشغيل',
    'execution.waiting': 'في الانتظار',
    'execution.completed': 'اكتمل',
    'execution.failed': 'فشل',
    'execution.cancelled': 'تم الإلغاء',
    'execution.success': 'نجح',
    'execution.error': 'خطأ في التنفيذ',
    'chat.session': 'جلسة الدردشة',
    'chat.newSession': 'جلسة جديدة',
    'chat.send': 'إرسال',
    'chat.inputPlaceholder': 'اكتب رسالة...',
    'chat.empty': 'لا توجد رسائل بعد',
    'chat.error': 'حدث خطأ في الدردشة',
    'canvas.subtitle': 'لوحة سير العمل',
    'canvas.zoomIn': 'تكبير',
    'canvas.zoomOut': 'تصغير',
    'canvas.fitView': 'ملاءمة العرض',
    'common.cancel': 'إلغاء',
    'common.confirm': 'تأكيد',
    'common.close': 'إغلاق',
    'common.back': 'رجوع',
    'common.next': 'التالي',
    'common.loading': 'جار التحميل',
    'common.retry': 'إعادة المحاولة',
  }),
  zh: Object.freeze({
    'execute.workflow': '执行工作流',
    'test.step': '测试步骤',
    'save.workflow': '保存工作流',
    'add.step': '添加步骤',
    'settings.title': '设置',
    'settings.personal': '个人设置',
    'settings.language': '显示语言',
    'node.success': '执行成功',
    'node.error': '执行失败',
    'node.description': '节点描述',
    'node.parameters': '参数',
    'node.options': '选项',
    'node.placeholder': '输入值',
    'node.hint': '提示',
    'node.required': '必填',
    'node.optional': '可选',
    'execution.running': '正在运行',
    'execution.waiting': '等待中',
    'execution.completed': '已完成',
    'execution.failed': '失败',
    'execution.cancelled': '已取消',
    'execution.success': '成功',
    'execution.error': '执行错误',
    'chat.session': '聊天会话',
    'chat.newSession': '新会话',
    'chat.send': '发送',
    'chat.inputPlaceholder': '输入消息...',
    'chat.empty': '暂无消息',
    'chat.error': '聊天发生错误',
    'canvas.subtitle': '工作流画布',
    'canvas.zoomIn': '放大',
    'canvas.zoomOut': '缩小',
    'canvas.fitView': '适应视图',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.close': '关闭',
    'common.back': '返回',
    'common.next': '下一步',
    'common.loading': '加载中',
    'common.retry': '重试',
  }),
  ru: Object.freeze({
    'execute.workflow': 'Запустить процесс',
    'test.step': 'Проверить шаг',
    'save.workflow': 'Сохранить процесс',
    'add.step': 'Добавить шаг',
    'settings.title': 'Настройки',
    'settings.personal': 'Личные настройки',
    'settings.language': 'Язык интерфейса',
    'node.success': 'Выполнено успешно',
    'node.error': 'Ошибка выполнения',
    'node.description': 'Описание узла',
    'node.parameters': 'Параметры',
    'node.options': 'Параметры выбора',
    'node.placeholder': 'Введите значение',
    'node.hint': 'Подсказка',
    'node.required': 'Обязательно',
    'node.optional': 'Необязательно',
    'execution.running': 'Выполняется',
    'execution.waiting': 'Ожидание',
    'execution.completed': 'Завершено',
    'execution.failed': 'Не выполнено',
    'execution.cancelled': 'Отменено',
    'execution.success': 'Успешно',
    'execution.error': 'Ошибка выполнения',
    'chat.session': 'Сеанс чата',
    'chat.newSession': 'Новый сеанс',
    'chat.send': 'Отправить',
    'chat.inputPlaceholder': 'Введите сообщение...',
    'chat.empty': 'Сообщений пока нет',
    'chat.error': 'Ошибка чата',
    'canvas.subtitle': 'Холст процесса',
    'canvas.zoomIn': 'Увеличить',
    'canvas.zoomOut': 'Уменьшить',
    'canvas.fitView': 'Вписать в экран',
    'common.cancel': 'Отмена',
    'common.confirm': 'Подтвердить',
    'common.close': 'Закрыть',
    'common.back': 'Назад',
    'common.next': 'Далее',
    'common.loading': 'Загрузка',
    'common.retry': 'Повторить',
  }),
  en: Object.freeze({
    'execute.workflow': 'Execute workflow',
    'test.step': 'Test step',
    'save.workflow': 'Save workflow',
    'add.step': 'Add step',
    'settings.title': 'Settings',
    'settings.personal': 'Personal Settings',
    'settings.language': 'Display Language',
    'node.success': 'Execution succeeded',
    'node.error': 'Execution failed',
    'node.description': 'Node description',
    'node.parameters': 'Parameters',
    'node.options': 'Options',
    'node.placeholder': 'Enter a value',
    'node.hint': 'Hint',
    'node.required': 'Required',
    'node.optional': 'Optional',
    'execution.running': 'Running',
    'execution.waiting': 'Waiting',
    'execution.completed': 'Completed',
    'execution.failed': 'Failed',
    'execution.cancelled': 'Cancelled',
    'execution.success': 'Success',
    'execution.error': 'Execution error',
    'chat.session': 'Chat session',
    'chat.newSession': 'New session',
    'chat.send': 'Send',
    'chat.inputPlaceholder': 'Write a message...',
    'chat.empty': 'No messages yet',
    'chat.error': 'A chat error occurred',
    'canvas.subtitle': 'Workflow canvas',
    'canvas.zoomIn': 'Zoom in',
    'canvas.zoomOut': 'Zoom out',
    'canvas.fitView': 'Fit view',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.loading': 'Loading',
    'common.retry': 'Retry',
  }),
});

const LOCALE_ALIASES = {
  id: 'id', 'id-id': 'id',
  jv: 'jv', 'jv-id': 'jv',
  ar: 'ar', 'ar-sa': 'ar', 'ar-eg': 'ar',
  zh: 'zh', 'zh-cn': 'zh', 'zh-sg': 'zh',
  ru: 'ru', 'ru-ru': 'ru',
  en: 'en', 'en-us': 'en', 'en-gb': 'en',
};

const STATUS_ALIASES = {
  success: 'execution.success',
  succeeded: 'execution.success',
  completed: 'execution.completed',
  complete: 'execution.completed',
  running: 'execution.running',
  waiting: 'execution.waiting',
  pending: 'execution.waiting',
  failed: 'execution.failed',
  failure: 'execution.failed',
  cancelled: 'execution.cancelled',
  canceled: 'execution.cancelled',
  error: 'execution.error',
};

function normalizeLocale(locale, fallback = 'id') {
  if (typeof locale !== 'string') return fallback;
  const normalized = locale.trim().toLowerCase().replaceAll('_', '-');
  return LOCALE_ALIASES[normalized] ?? LOCALE_ALIASES[normalized.split('-')[0]] ?? fallback;
}

export function isProtectedMachineKey(key) {
  return typeof key === 'string' && PROTECTED_MACHINE_KEY_SET.has(key.toLowerCase());
}

const protectedKey = isProtectedMachineKey;

function copyWithoutLocalization(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);

  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copyWithoutLocalization(item, seen));
    return copy;
  }

  const copy = {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) copy[key] = copyWithoutLocalization(child, seen);
  return copy;
}

function findKeyForText(text) {
  const normalized = text.toLocaleLowerCase();
  if (STATUS_ALIASES[normalized]) return STATUS_ALIASES[normalized];
  for (const locale of SUPPORTED_LOCALE_CODES) {
    for (const [key, value] of Object.entries(NATIVE_DICTIONARIES[locale])) {
      if (value.toLocaleLowerCase() === normalized) return key;
    }
  }
  return undefined;
}

function translateText(text, locale = 'id', overrides = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const leading = match?.[1] ?? '';
  const body = match?.[2] ?? text;
  const trailing = match?.[3] ?? '';
  const key = Object.hasOwn(NATIVE_DICTIONARIES[normalizeLocale(locale)], body)
    ? body
    : findKeyForText(body);
  if (key && overrides[key] !== undefined) return `${leading}${overrides[key]}${trailing}`;
  if (!key) return text;
  return `${leading}${NATIVE_DICTIONARIES[normalizeLocale(locale)][key] ?? NATIVE_DICTIONARIES.en[key] ?? body}${trailing}`;
}

export class UniversalLocaleEnforcer {
  constructor(options = {}) {
    this.locale = normalizeLocale(options.locale, 'id');
    this.translations = {};
    for (const locale of SUPPORTED_LOCALE_CODES) {
      this.translations[locale] = { ...(options.translations?.[locale] ?? {}) };
    }
  }

  getLocale() {
    return this.locale;
  }

  setLocale(locale) {
    this.locale = normalizeLocale(locale, this.locale);
    return this.locale;
  }

  getSupportedLocales() {
    return SUPPORTED_LOCALE_CODES.map((code) => ({ ...SUPPORTED_LOCALES[code] }));
  }

  registerTranslations(locale, translations) {
    const target = normalizeLocale(locale, this.locale);
    this.translations[target] = { ...this.translations[target], ...translations };
  }

  translate(key, locale = this.locale) {
    const target = normalizeLocale(locale, this.locale);
    return this.translations[target][key] ?? NATIVE_DICTIONARIES[target][key] ?? NATIVE_DICTIONARIES.en[key] ?? key;
  }

  translateText(text, locale = this.locale) {
    const target = normalizeLocale(locale, this.locale);
    if (Object.hasOwn(this.translations[target], text)) return this.translations[target][text];
    const customKey = Object.entries(this.translations[target]).find(([, value]) => value === text)?.[0];
    if (customKey) return this.translate(customKey, target);
    const key = findKeyForText(String(text));
    if (key && this.translations[target][key] !== undefined) return this.translations[target][key];
    return translateText(text, target, this.translations[target]);
  }

  enforce(payload, locale = this.locale) {
    const target = normalizeLocale(locale, this.locale);
    return this.#walk(payload, undefined, target, new WeakMap());
  }

  enforceExecutionLog(log, locale = this.locale) {
    const target = normalizeLocale(locale, this.locale);
    if (Array.isArray(log)) return log.map((entry) => this.enforceExecutionLog(entry, target));
    const localized = this.enforce(log, target);
    if (localized && typeof localized === 'object' && !Array.isArray(localized) && typeof localized.status === 'string') {
      localized.statusText = this.translateStatus(localized.status, target);
    }
    return localized;
  }

  enforceExecutionResponse(payload, locale = this.locale) {
    const target = normalizeLocale(locale, this.locale);
    const localized = this.enforce(payload, target);
    if (!localized || typeof localized !== 'object' || Array.isArray(localized)) return localized;
    if (Array.isArray(localized.executionLog)) localized.executionLog = this.enforceExecutionLog(localized.executionLog, target);
    if (typeof localized.status === 'string' && localized.statusText === undefined) {
      localized.statusText = this.translateStatus(localized.status, target);
    }
    return localized;
  }

  enforceChatSession(session, locale = this.locale) {
    return this.enforce(session, locale);
  }

  enforceNodeDescription(node, locale = this.locale) {
    return this.enforce(node, locale);
  }

  translateStatus(status, locale = this.locale) {
    const key = STATUS_ALIASES[String(status).toLocaleLowerCase()];
    return key ? this.translate(key, locale) : this.translateText(status, locale);
  }

  #walk(value, parentKey, locale, seen) {
    if (typeof value === 'string') {
      return HUMAN_FACING_KEY_SET.has(String(parentKey).toLowerCase()) ? this.translateText(value, locale) : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (protectedKey(parentKey) || NON_LOCALIZABLE_KEYS.has(String(parentKey).toLowerCase())) {
      return copyWithoutLocalization(value);
    }
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const copy = [];
      seen.set(value, copy);
      for (const item of value) copy.push(this.#walk(item, parentKey, locale, seen));
      return copy;
    }

    const copy = {};
    seen.set(value, copy);
    for (const [key, child] of Object.entries(value)) {
      if (protectedKey(key) || NON_LOCALIZABLE_KEYS.has(key.toLowerCase())) {
        copy[key] = copyWithoutLocalization(child);
      } else if (TRANSLATION_KEY_FIELDS.has(key.toLowerCase()) && typeof child === 'string') {
        copy[key] = this.translate(child, locale);
      } else {
        copy[key] = this.#walk(child, key, locale, seen);
      }
    }
    return copy;
  }
}

export function createUniversalLocaleEnforcer(options = {}) {
  return new UniversalLocaleEnforcer(options);
}

export function interceptLocalizedResponse(payload, locale = 'id') {
  return new UniversalLocaleEnforcer({ locale }).enforceExecutionResponse(payload);
}

export function normalizeSupportedLocale(locale, fallback = 'id') {
  return normalizeLocale(locale, fallback);
}
