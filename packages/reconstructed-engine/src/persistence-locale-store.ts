/**
 * AGENT-5 · LEGO: PERSISTENCE — Execution-state & language-preference localization store.
 *
 * Zero Rust. This module is plain TypeScript that runs on Node.js (native type
 * stripping) and in the browser; it is the persistence-side counterpart of the
 * n8n 2.9.4 editor strings (localStorage / profile-settings responsibility).
 *
 * REFERENCE GROUNDING (1:1, read-only source)
 *   n8n version      : 2.9.4
 *   upstream commit  : b6dc2787c45677a29a9612cd27eb911302961a83
 *   English source   : reference/n8n/packages/frontend/@n8n/i18n/src/locales/en.json
 *   en.json sha256   : 1367f71aacc45ca656b88a058564637965967d672fd3b14b70cacf3793d5bef4
 *   status vocabulary: reference/n8n/packages/workflow/src/execution-status.ts
 *                      (ExecutionStatusList: canceled | crashed | error | new |
 *                       running | success | unknown | waiting)
 *
 * Every `en` value below is copied verbatim from that en.json (or derived from a
 * listed sibling key — see `PERSISTENCE_KEY_PROVENANCE`). The other five locales
 * are native translations of the same English string; they are never a mix of
 * two languages, which is what tools/localization-leak-gate.mjs enforces.
 *
 * Locale set is fixed by NativeLocalizationService / UniversalLocaleEnforcer
 * (id, en, jv, ar, zh, ru). Default is `id`; an unknown persisted value falls
 * back to `id` and never leaks another language.
 */

import { UniversalLocaleEnforcer } from './universal-locale-enforcer.ts';

/* ------------------------------------------------------------------------- */
/* Locale set                                                                */
/* ------------------------------------------------------------------------- */

export type PersistenceLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export interface PersistenceLocaleMetadata {
	code: PersistenceLocale;
	name: string;
	nativeName: string;
	direction: 'ltr' | 'rtl';
}

export const PERSISTENCE_DEFAULT_LOCALE: PersistenceLocale = 'id';

/** localStorage key used for the persisted language preference (profile settings). */
export const PERSISTENCE_STORAGE_KEY = 'n8n.persistence.locale';

export const PERSISTENCE_LOCALES: Record<PersistenceLocale, PersistenceLocaleMetadata> = {
	id: { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr' },
	en: { code: 'en', name: 'English', nativeName: 'English (US)', direction: 'ltr' },
	jv: { code: 'jv', name: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr' },
	ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
	zh: { code: 'zh', name: 'Chinese', nativeName: '中文 (简体)', direction: 'ltr' },
	ru: { code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr' },
};

export const PERSISTENCE_LOCALE_CODES: PersistenceLocale[] = [
	'id',
	'en',
	'jv',
	'ar',
	'zh',
	'ru',
];

/* ------------------------------------------------------------------------- */
/* Execution status vocabulary (1:1 with n8n ExecutionStatusList)             */
/* ------------------------------------------------------------------------- */

export const EXECUTION_STATUSES = [
	'canceled',
	'crashed',
	'error',
	'new',
	'running',
	'success',
	'unknown',
	'waiting',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

const EXECUTION_STATUS_KEYS: Record<ExecutionStatus, string> = {
	canceled: 'execution.status.canceled',
	crashed: 'execution.status.crashed',
	error: 'execution.status.error',
	new: 'execution.status.new',
	running: 'execution.status.running',
	success: 'execution.status.success',
	unknown: 'execution.status.unknown',
	waiting: 'execution.status.waiting',
};

/* ------------------------------------------------------------------------- */
/* Canonical key list                                                        */
/* ------------------------------------------------------------------------- */

export const PERSISTENCE_TEXT_KEYS = [
	// execution status labels
	'execution.status.new',
	'execution.status.running',
	'execution.status.success',
	'execution.status.error',
	'execution.status.waiting',
	'execution.status.canceled',
	'execution.status.crashed',
	'execution.status.unknown',
	// run data / execution detail
	'runData.executionStatus.success',
	'runData.executionStatus.failed',
	'runData.executionStatus.canceled',
	'executionDetails.executionWasSuccessful',
	'executionDetails.newMessage',
	// executions-list chrome
	'executionsList.status',
	'executionsList.id',
	'executionsList.runTime',
	'executionsList.startedAt',
	'executionsList.startingSoon',
	'executionsList.filters',
	'executionsList.anyStatus',
	'executionsList.selectStatus',
	'executionsList.workflowExecutions',
	'executionsList.empty',
	'executionsList.activeExecutions.none',
	'executionsList.loadMore',
	// persistence lifecycle messages
	'executionsList.showMessage.stopExecution.title',
	'executionsList.showMessage.handleDeleteSelected.title',
	'executionsList.showMessage.retrySuccess.title',
	'executionsList.showMessage.retryError.title',
	'executionsList.showMessage.retryWaiting.title',
	'executionsList.showMessage.retryRunning.title',
	'executionsList.showMessage.retryCanceled.title',
	'executionsList.showMessage.retryCrashed.title',
	'executionsList.showError.refreshData.title',
	'executionsList.showError.stopExecution.title',
	'executionsList.showError.handleDeleteSelected.title',
	// destructive confirmation
	'executionsList.confirmMessage.headline',
	'executionsList.confirmMessage.message',
	// execution modes
	'executionsList.modes.manual',
	'executionsList.modes.trigger',
	'executionsList.modes.webhook',
	'executionsList.modes.integrated',
	'executionsList.modes.retry',
	'executionsList.modes.error',
	// engine-owned persistence texts (reconstruction only, not upstream UI copy)
	'persistence.language.saved',
	'persistence.language.restored',
	'persistence.execution.pruned',
	'persistence.storage.unavailable',
] as const;

export type PersistenceTextKey = (typeof PERSISTENCE_TEXT_KEYS)[number];

/**
 * Where every `en` value comes from. `reconstruction:*` marks the four engine
 * strings that do not exist upstream — they are the reconstructed engine's own
 * persistence notices, not n8n UI copy.
 */
export const PERSISTENCE_KEY_PROVENANCE: Record<string, string> = {
	'execution.status.new': 'en.json:executionsList.new',
	'execution.status.running': 'en.json:executionsList.running',
	'execution.status.success': 'en.json:executionsList.success',
	'execution.status.error': 'en.json:executionsList.error',
	'execution.status.waiting': 'en.json:executionsList.waiting',
	'execution.status.canceled': 'en.json:executionsList.canceled',
	'execution.status.crashed': 'derived:en.json:executionsList.showMessage.retryCrashed.title',
	'execution.status.unknown': 'en.json:executionsList.unknown',
	'runData.executionStatus.success': 'en.json:runData.executionStatus.success',
	'runData.executionStatus.failed': 'en.json:runData.executionStatus.failed',
	'runData.executionStatus.canceled': 'en.json:runData.executionStatus.canceled',
	'executionDetails.executionWasSuccessful': 'en.json:executionDetails.executionWasSuccessful',
	'executionDetails.newMessage': 'en.json:executionDetails.newMessage',
	'executionsList.status': 'en.json:executionsList.status',
	'executionsList.id': 'en.json:executionsList.id',
	'executionsList.runTime': 'en.json:executionsList.runTime',
	'executionsList.startedAt': 'en.json:executionsList.startedAt',
	'executionsList.startingSoon': 'en.json:executionsList.startingSoon',
	'executionsList.filters': 'en.json:executionsList.filters',
	'executionsList.anyStatus': 'en.json:executionsList.anyStatus',
	'executionsList.selectStatus': 'en.json:executionsList.selectStatus',
	'executionsList.workflowExecutions': 'en.json:executionsList.workflowExecutions',
	'executionsList.empty': 'en.json:executionsList.empty',
	'executionsList.activeExecutions.none': 'en.json:executionsList.activeExecutions.none',
	'executionsList.loadMore': 'en.json:executionsList.loadMore',
	'executionsList.showMessage.stopExecution.title':
		'en.json:executionsList.showMessage.stopExecution.title',
	'executionsList.showMessage.handleDeleteSelected.title':
		'en.json:executionsList.showMessage.handleDeleteSelected.title',
	'executionsList.showMessage.retrySuccess.title':
		'en.json:executionsList.showMessage.retrySuccess.title',
	'executionsList.showMessage.retryError.title':
		'en.json:executionsList.showMessage.retryError.title',
	'executionsList.showMessage.retryWaiting.title':
		'en.json:executionsList.showMessage.retryWaiting.title',
	'executionsList.showMessage.retryRunning.title':
		'en.json:executionsList.showMessage.retryRunning.title',
	'executionsList.showMessage.retryCanceled.title':
		'en.json:executionsList.showMessage.retryCanceled.title',
	'executionsList.showMessage.retryCrashed.title':
		'en.json:executionsList.showMessage.retryCrashed.title',
	'executionsList.showError.refreshData.title':
		'en.json:executionsList.showError.refreshData.title',
	'executionsList.showError.stopExecution.title':
		'en.json:executionsList.showError.stopExecution.title',
	'executionsList.showError.handleDeleteSelected.title':
		'en.json:executionsList.showError.handleDeleteSelected.title',
	'executionsList.confirmMessage.headline': 'en.json:executionsList.confirmMessage.headline',
	'executionsList.confirmMessage.message': 'en.json:executionsList.confirmMessage.message',
	'executionsList.modes.manual': 'en.json:executionsList.modes.manual',
	'executionsList.modes.trigger': 'en.json:executionsList.modes.trigger',
	'executionsList.modes.webhook': 'en.json:executionsList.modes.webhook',
	'executionsList.modes.integrated': 'en.json:executionsList.modes.integrated',
	'executionsList.modes.retry': 'en.json:executionsList.modes.retry',
	'executionsList.modes.error': 'en.json:executionsList.modes.error',
	'persistence.language.saved': 'reconstruction:agent-5/persistence',
	'persistence.language.restored': 'reconstruction:agent-5/persistence',
	'persistence.execution.pruned': 'reconstruction:agent-5/persistence',
	'persistence.storage.unavailable': 'reconstruction:agent-5/persistence',
};

/* ------------------------------------------------------------------------- */
/* Six-locale dictionary                                                     */
/* ------------------------------------------------------------------------- */

export const PERSISTENCE_DICTIONARIES: Record<PersistenceLocale, Record<string, string>> = {
	en: {
		'execution.status.new': 'Queued',
		'execution.status.running': 'Running',
		'execution.status.success': 'Success',
		'execution.status.error': 'Error',
		'execution.status.waiting': 'Waiting',
		'execution.status.canceled': 'Canceled',
		'execution.status.crashed': 'Crashed',
		'execution.status.unknown': 'Could not complete',
		'runData.executionStatus.success': 'Executed successfully',
		'runData.executionStatus.failed': 'Execution failed',
		'runData.executionStatus.canceled': 'Execution canceled',
		'executionDetails.executionWasSuccessful': 'Execution was successful',
		'executionDetails.newMessage': 'Execution waiting in the queue.',
		'executionsList.status': 'Status',
		'executionsList.id': 'Exec. ID',
		'executionsList.runTime': 'Run time',
		'executionsList.startedAt': 'Started',
		'executionsList.startingSoon': 'Starting soon',
		'executionsList.filters': 'Filters',
		'executionsList.anyStatus': 'Any Status',
		'executionsList.selectStatus': 'Select Status',
		'executionsList.workflowExecutions': 'Executions',
		'executionsList.empty': 'No executions',
		'executionsList.activeExecutions.none': 'No active executions',
		'executionsList.loadMore': 'Load more',
		'executionsList.showMessage.stopExecution.title': 'Execution stopped',
		'executionsList.showMessage.handleDeleteSelected.title': 'Execution deleted',
		'executionsList.showMessage.retrySuccess.title': 'Retry successful',
		'executionsList.showMessage.retryError.title': 'Retry unsuccessful',
		'executionsList.showMessage.retryWaiting.title': 'Retry waiting',
		'executionsList.showMessage.retryRunning.title': 'Retry running',
		'executionsList.showMessage.retryCanceled.title': 'Retry canceled',
		'executionsList.showMessage.retryCrashed.title': 'Retry crashed',
		'executionsList.showError.refreshData.title': 'Problem loading data',
		'executionsList.showError.stopExecution.title': 'Problem stopping execution',
		'executionsList.showError.handleDeleteSelected.title': 'Problem deleting executions',
		'executionsList.confirmMessage.headline': 'Delete Executions?',
		'executionsList.confirmMessage.message':
			'Are you sure that you want to delete the {count} selected execution(s)?',
		'executionsList.modes.manual': 'manual',
		'executionsList.modes.trigger': 'trigger',
		'executionsList.modes.webhook': 'webhook',
		'executionsList.modes.integrated': 'integrated',
		'executionsList.modes.retry': 'retry',
		'executionsList.modes.error': 'error',
		'persistence.language.saved': 'Language preference saved',
		'persistence.language.restored': 'Language preference restored',
		'persistence.execution.pruned': 'Execution data pruned',
		'persistence.storage.unavailable':
			'Local storage unavailable — using in-memory session storage',
	},

	id: {
		'execution.status.new': 'Dalam antrean',
		'execution.status.running': 'Berjalan',
		'execution.status.success': 'Berhasil',
		'execution.status.error': 'Gagal',
		'execution.status.waiting': 'Menunggu',
		'execution.status.canceled': 'Dibatalkan',
		'execution.status.crashed': 'Terhenti mendadak',
		'execution.status.unknown': 'Tidak dapat diselesaikan',
		'runData.executionStatus.success': 'Berhasil dieksekusi',
		'runData.executionStatus.failed': 'Eksekusi gagal',
		'runData.executionStatus.canceled': 'Eksekusi dibatalkan',
		'executionDetails.executionWasSuccessful': 'Eksekusi berhasil',
		'executionDetails.newMessage': 'Eksekusi menunggu dalam antrean.',
		'executionsList.status': 'Status',
		'executionsList.id': 'ID Eksekusi',
		'executionsList.runTime': 'Waktu berjalan',
		'executionsList.startedAt': 'Dimulai',
		'executionsList.startingSoon': 'Segera dimulai',
		'executionsList.filters': 'Filter',
		'executionsList.anyStatus': 'Status Apa Saja',
		'executionsList.selectStatus': 'Pilih Status',
		'executionsList.workflowExecutions': 'Eksekusi',
		'executionsList.empty': 'Tidak ada eksekusi',
		'executionsList.activeExecutions.none': 'Tidak ada eksekusi aktif',
		'executionsList.loadMore': 'Muat lebih banyak',
		'executionsList.showMessage.stopExecution.title': 'Eksekusi dihentikan',
		'executionsList.showMessage.handleDeleteSelected.title': 'Eksekusi dihapus',
		'executionsList.showMessage.retrySuccess.title': 'Ulang eksekusi berhasil',
		'executionsList.showMessage.retryError.title': 'Ulang eksekusi gagal',
		'executionsList.showMessage.retryWaiting.title': 'Ulang eksekusi menunggu',
		'executionsList.showMessage.retryRunning.title': 'Ulang eksekusi berjalan',
		'executionsList.showMessage.retryCanceled.title': 'Ulang eksekusi dibatalkan',
		'executionsList.showMessage.retryCrashed.title': 'Ulang eksekusi terhenti mendadak',
		'executionsList.showError.refreshData.title': 'Gagal memuat data',
		'executionsList.showError.stopExecution.title': 'Gagal menghentikan eksekusi',
		'executionsList.showError.handleDeleteSelected.title': 'Gagal menghapus eksekusi',
		'executionsList.confirmMessage.headline': 'Hapus Eksekusi?',
		'executionsList.confirmMessage.message':
			'Apakah Anda yakin ingin menghapus {count} eksekusi yang dipilih?',
		'executionsList.modes.manual': 'manual',
		'executionsList.modes.trigger': 'pemicu',
		'executionsList.modes.webhook': 'webhook',
		'executionsList.modes.integrated': 'terintegrasi',
		'executionsList.modes.retry': 'ulangi',
		'executionsList.modes.error': 'galat',
		'persistence.language.saved': 'Preferensi bahasa disimpan',
		'persistence.language.restored': 'Preferensi bahasa dimuat ulang',
		'persistence.execution.pruned': 'Data eksekusi dibersihkan',
		'persistence.storage.unavailable':
			'Penyimpanan lokal tidak tersedia — menggunakan memori sesi',
	},

	jv: {
		'execution.status.new': 'Ngantri',
		'execution.status.running': 'Mlaku',
		'execution.status.success': 'Kasil',
		'execution.status.error': 'Gagal',
		'execution.status.waiting': 'Ngenteni',
		'execution.status.canceled': 'Dibatalake',
		'execution.status.crashed': 'Macet dumadakan',
		'execution.status.unknown': 'Ora bisa rampung',
		'runData.executionStatus.success': 'Kasil dieksekusi',
		'runData.executionStatus.failed': 'Eksekusi gagal',
		'runData.executionStatus.canceled': 'Eksekusi dibatalake',
		'executionDetails.executionWasSuccessful': 'Eksekusi kasil',
		'executionDetails.newMessage': 'Eksekusi ngenteni ing antrean.',
		'executionsList.status': 'Status',
		'executionsList.id': 'ID Eksekusi',
		'executionsList.runTime': 'Suwene mlaku',
		'executionsList.startedAt': 'Diwiwiti',
		'executionsList.startingSoon': 'Arep diwiwiti',
		'executionsList.filters': 'Filter',
		'executionsList.anyStatus': 'Status Apa Wae',
		'executionsList.selectStatus': 'Pilih Status',
		'executionsList.workflowExecutions': 'Eksekusi',
		'executionsList.empty': 'Ora ana eksekusi',
		'executionsList.activeExecutions.none': 'Ora ana eksekusi aktif',
		'executionsList.loadMore': 'Muat liyane',
		'executionsList.showMessage.stopExecution.title': 'Eksekusi diendheg',
		'executionsList.showMessage.handleDeleteSelected.title': 'Eksekusi dibusak',
		'executionsList.showMessage.retrySuccess.title': 'Coba maneh kasil',
		'executionsList.showMessage.retryError.title': 'Coba maneh gagal',
		'executionsList.showMessage.retryWaiting.title': 'Coba maneh ngenteni',
		'executionsList.showMessage.retryRunning.title': 'Coba maneh mlaku',
		'executionsList.showMessage.retryCanceled.title': 'Coba maneh dibatalake',
		'executionsList.showMessage.retryCrashed.title': 'Coba maneh macet',
		'executionsList.showError.refreshData.title': 'Gagal momot data',
		'executionsList.showError.stopExecution.title': 'Gagal mungkasi eksekusi',
		'executionsList.showError.handleDeleteSelected.title': 'Gagal mbusak eksekusi',
		'executionsList.confirmMessage.headline': 'Busak Eksekusi?',
		'executionsList.confirmMessage.message':
			'Apa sampeyan yakin arep mbusak {count} eksekusi sing dipilih?',
		'executionsList.modes.manual': 'manual',
		'executionsList.modes.trigger': 'pamicu',
		'executionsList.modes.webhook': 'webhook',
		'executionsList.modes.integrated': 'terintegrasi',
		'executionsList.modes.retry': 'coba maneh',
		'executionsList.modes.error': 'kaluputan',
		'persistence.language.saved': 'Preferensi basa disimpen',
		'persistence.language.restored': 'Preferensi basa dimuat',
		'persistence.execution.pruned': 'Data eksekusi diresiki',
		'persistence.storage.unavailable':
			'Panyimpenan lokal ora kasedhiya — nganggo memori sesi',
	},

	ar: {
		'execution.status.new': 'قيد الانتظار',
		'execution.status.running': 'قيد التشغيل',
		'execution.status.success': 'نجاح',
		'execution.status.error': 'خطأ',
		'execution.status.waiting': 'بانتظار',
		'execution.status.canceled': 'ملغى',
		'execution.status.crashed': 'تعطل',
		'execution.status.unknown': 'تعذر الإكمال',
		'runData.executionStatus.success': 'تم التنفيذ بنجاح',
		'runData.executionStatus.failed': 'فشل التنفيذ',
		'runData.executionStatus.canceled': 'تم إلغاء التنفيذ',
		'executionDetails.executionWasSuccessful': 'كان التنفيذ ناجحاً',
		'executionDetails.newMessage': 'التنفيذ ينتظر في قائمة الانتظار.',
		'executionsList.status': 'الحالة',
		'executionsList.id': 'معرّف التنفيذ',
		'executionsList.runTime': 'مدة التشغيل',
		'executionsList.startedAt': 'وقت البدء',
		'executionsList.startingSoon': 'سيبدأ قريباً',
		'executionsList.filters': 'عوامل التصفية',
		'executionsList.anyStatus': 'أي حالة',
		'executionsList.selectStatus': 'اختر الحالة',
		'executionsList.workflowExecutions': 'التنفيذات',
		'executionsList.empty': 'لا توجد تنفيذات',
		'executionsList.activeExecutions.none': 'لا توجد تنفيذات نشطة',
		'executionsList.loadMore': 'تحميل المزيد',
		'executionsList.showMessage.stopExecution.title': 'تم إيقاف التنفيذ',
		'executionsList.showMessage.handleDeleteSelected.title': 'تم حذف التنفيذ',
		'executionsList.showMessage.retrySuccess.title': 'نجاح إعادة المحاولة',
		'executionsList.showMessage.retryError.title': 'فشل إعادة المحاولة',
		'executionsList.showMessage.retryWaiting.title': 'إعادة المحاولة قيد الانتظار',
		'executionsList.showMessage.retryRunning.title': 'إعادة المحاولة قيد التشغيل',
		'executionsList.showMessage.retryCanceled.title': 'تم إلغاء إعادة المحاولة',
		'executionsList.showMessage.retryCrashed.title': 'تعطلت إعادة المحاولة',
		'executionsList.showError.refreshData.title': 'مشكلة في تحميل البيانات',
		'executionsList.showError.stopExecution.title': 'مشكلة في إيقاف التنفيذ',
		'executionsList.showError.handleDeleteSelected.title': 'مشكلة في حذف التنفيذات',
		'executionsList.confirmMessage.headline': 'حذف التنفيذات؟',
		'executionsList.confirmMessage.message':
			'هل أنت متأكد أنك تريد حذف {count} من التنفيذات المحددة؟',
		'executionsList.modes.manual': 'يدوي',
		'executionsList.modes.trigger': 'مشغّل',
		'executionsList.modes.webhook': 'خطاف ويب',
		'executionsList.modes.integrated': 'مدمج',
		'executionsList.modes.retry': 'إعادة المحاولة',
		'executionsList.modes.error': 'خطأ',
		'persistence.language.saved': 'تم حفظ تفضيل اللغة',
		'persistence.language.restored': 'تم استعادة تفضيل اللغة',
		'persistence.execution.pruned': 'تم تنظيف بيانات التنفيذ',
		'persistence.storage.unavailable':
			'التخزين المحلي غير متاح — يتم استخدام ذاكرة الجلسة',
	},

	zh: {
		'execution.status.new': '排队中',
		'execution.status.running': '运行中',
		'execution.status.success': '成功',
		'execution.status.error': '错误',
		'execution.status.waiting': '等待中',
		'execution.status.canceled': '已取消',
		'execution.status.crashed': '崩溃',
		'execution.status.unknown': '未能完成',
		'runData.executionStatus.success': '执行成功',
		'runData.executionStatus.failed': '执行失败',
		'runData.executionStatus.canceled': '执行已取消',
		'executionDetails.executionWasSuccessful': '执行已成功',
		'executionDetails.newMessage': '执行正在队列中等待。',
		'executionsList.status': '状态',
		'executionsList.id': '执行编号',
		'executionsList.runTime': '运行时长',
		'executionsList.startedAt': '开始时间',
		'executionsList.startingSoon': '即将开始',
		'executionsList.filters': '筛选',
		'executionsList.anyStatus': '任意状态',
		'executionsList.selectStatus': '选择状态',
		'executionsList.workflowExecutions': '执行记录',
		'executionsList.empty': '暂无执行记录',
		'executionsList.activeExecutions.none': '暂无活动执行',
		'executionsList.loadMore': '加载更多',
		'executionsList.showMessage.stopExecution.title': '执行已停止',
		'executionsList.showMessage.handleDeleteSelected.title': '执行已删除',
		'executionsList.showMessage.retrySuccess.title': '重试成功',
		'executionsList.showMessage.retryError.title': '重试失败',
		'executionsList.showMessage.retryWaiting.title': '重试等待中',
		'executionsList.showMessage.retryRunning.title': '重试进行中',
		'executionsList.showMessage.retryCanceled.title': '重试已取消',
		'executionsList.showMessage.retryCrashed.title': '重试崩溃',
		'executionsList.showError.refreshData.title': '加载数据出错',
		'executionsList.showError.stopExecution.title': '停止执行出错',
		'executionsList.showError.handleDeleteSelected.title': '删除执行出错',
		'executionsList.confirmMessage.headline': '删除执行记录？',
		'executionsList.confirmMessage.message': '确定要删除已选的 {count} 条执行记录吗？',
		'executionsList.modes.manual': '手动',
		'executionsList.modes.trigger': '触发器',
		'executionsList.modes.webhook': '网络钩子',
		'executionsList.modes.integrated': '集成',
		'executionsList.modes.retry': '重试',
		'executionsList.modes.error': '错误',
		'persistence.language.saved': '语言偏好已保存',
		'persistence.language.restored': '语言偏好已恢复',
		'persistence.execution.pruned': '执行数据已清理',
		'persistence.storage.unavailable': '本地存储不可用 — 正在使用会话内存',
	},

	ru: {
		'execution.status.new': 'В очереди',
		'execution.status.running': 'Выполняется',
		'execution.status.success': 'Успешно',
		'execution.status.error': 'Ошибка',
		'execution.status.waiting': 'Ожидание',
		'execution.status.canceled': 'Отменено',
		'execution.status.crashed': 'Сбой',
		'execution.status.unknown': 'Не удалось завершить',
		'runData.executionStatus.success': 'Успешно выполнено',
		'runData.executionStatus.failed': 'Выполнение завершилось ошибкой',
		'runData.executionStatus.canceled': 'Выполнение отменено',
		'executionDetails.executionWasSuccessful': 'Выполнение прошло успешно',
		'executionDetails.newMessage': 'Выполнение ожидает в очереди.',
		'executionsList.status': 'Статус',
		'executionsList.id': 'ИД выполнения',
		'executionsList.runTime': 'Время выполнения',
		'executionsList.startedAt': 'Начало',
		'executionsList.startingSoon': 'Скоро начнётся',
		'executionsList.filters': 'Фильтры',
		'executionsList.anyStatus': 'Любой статус',
		'executionsList.selectStatus': 'Выберите статус',
		'executionsList.workflowExecutions': 'Выполнения',
		'executionsList.empty': 'Нет выполнений',
		'executionsList.activeExecutions.none': 'Нет активных выполнений',
		'executionsList.loadMore': 'Загрузить ещё',
		'executionsList.showMessage.stopExecution.title': 'Выполнение остановлено',
		'executionsList.showMessage.handleDeleteSelected.title': 'Выполнение удалено',
		'executionsList.showMessage.retrySuccess.title': 'Повтор выполнен успешно',
		'executionsList.showMessage.retryError.title': 'Повтор не удался',
		'executionsList.showMessage.retryWaiting.title': 'Повтор ожидает',
		'executionsList.showMessage.retryRunning.title': 'Повтор выполняется',
		'executionsList.showMessage.retryCanceled.title': 'Повтор отменён',
		'executionsList.showMessage.retryCrashed.title': 'Повтор завершился сбоем',
		'executionsList.showError.refreshData.title': 'Не удалось загрузить данные',
		'executionsList.showError.stopExecution.title': 'Не удалось остановить выполнение',
		'executionsList.showError.handleDeleteSelected.title': 'Не удалось удалить выполнения',
		'executionsList.confirmMessage.headline': 'Удалить выполнения?',
		'executionsList.confirmMessage.message':
			'Вы действительно хотите удалить выбранные выполнения ({count})?',
		'executionsList.modes.manual': 'вручную',
		'executionsList.modes.trigger': 'триггер',
		'executionsList.modes.webhook': 'вебхук',
		'executionsList.modes.integrated': 'интегрированный',
		'executionsList.modes.retry': 'повтор',
		'executionsList.modes.error': 'ошибка',
		'persistence.language.saved': 'Языковые настройки сохранены',
		'persistence.language.restored': 'Языковые настройки восстановлены',
		'persistence.execution.pruned': 'Данные выполнений очищены',
		'persistence.storage.unavailable':
			'Локальное хранилище недоступно — используется память сеанса',
	},
};

/* ------------------------------------------------------------------------- */
/* Storage adapters (browser localStorage, Node in-memory fallback)           */
/* ------------------------------------------------------------------------- */

export interface KeyValueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** Minimal in-memory key/value store — the Node/test and private-mode fallback. */
export class MemoryStorage implements KeyValueStorage {
	private readonly map = new Map<string, string>();

	public getItem(key: string): string | null {
		return this.map.has(key) ? (this.map.get(key) as string) : null;
	}

	public setItem(key: string, value: string): void {
		this.map.set(key, String(value));
	}

	public removeItem(key: string): void {
		this.map.delete(key);
	}
}

/**
 * Returns the browser `localStorage` when it is usable, otherwise `null`.
 * Access is wrapped because Safari private mode and hardened browsers throw on
 * property access or on `setItem` (quota / disabled storage).
 */
export function resolveBrowserStorage(): KeyValueStorage | null {
	const candidate = (globalThis as { localStorage?: unknown }).localStorage;
	if (!candidate) {
		return null;
	}
	try {
		const probe = '__n8n_persistence_probe__';
		const storage = candidate as KeyValueStorage;
		storage.setItem(probe, '1');
		storage.removeItem(probe);
		return storage;
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------------- */
/* Store                                                                     */
/* ------------------------------------------------------------------------- */

export interface PersistenceLocaleSnapshot {
	locale: PersistenceLocale;
	storageKey: string;
	persisted: string | null;
	storageBackend: 'localStorage' | 'memory';
	supportedLocales: PersistenceLocale[];
	direction: 'ltr' | 'rtl';
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Persists the language preference and renders every persistence-layer string
 * in exactly one language. A missing translation is never silently downgraded
 * to English: the miss is recorded in `leaks()` so the gate can fail the build.
 */
export class PersistenceLocaleStore {
	private readonly storage: KeyValueStorage;
	private readonly backend: 'localStorage' | 'memory';
	private locale: PersistenceLocale;
	private readonly missedKeys: string[] = [];
	private readonly missedLocales: string[] = [];

	public constructor(
		storage?: KeyValueStorage,
		locale?: PersistenceLocale,
		storageKey: string = PERSISTENCE_STORAGE_KEY,
	) {
		const browser = storage ? null : resolveBrowserStorage();
		if (storage) {
			this.storage = storage;
			this.backend = 'memory';
		} else if (browser) {
			this.storage = browser;
			this.backend = 'localStorage';
		} else {
			this.storage = new MemoryStorage();
			this.backend = 'memory';
		}
		this.storageKey = storageKey;
		this.locale = this.hydrate(locale);
	}

	public readonly storageKey: string;

	/** Reads the persisted preference; an unknown value falls back to `id`. */
	public hydrate(fallback?: PersistenceLocale): PersistenceLocale {
		const fallbackLocale = fallback ?? PERSISTENCE_DEFAULT_LOCALE;
		let persisted: string | null = null;
		try {
			persisted = this.storage.getItem(this.storageKey);
		} catch {
			persisted = null;
		}
		const candidate = persisted === null ? fallbackLocale : persisted;
		const next = UniversalLocaleEnforcer.enforce(candidate) as PersistenceLocale;
		this.locale = next;
		if (candidate !== next) {
			// Corrupt or unsupported persisted value: repair storage instead of leaking it.
			if (this.missedLocales.indexOf(String(candidate)) === -1) {
				this.missedLocales.push(String(candidate));
			}
			this.persist(next);
		}
		return next;
	}

	/** Persists + applies the preference. Unknown codes fall back to `id`. */
	public setLocale(locale: string): PersistenceLocale {
		const next = UniversalLocaleEnforcer.enforce(locale) as PersistenceLocale;
		this.locale = next;
		if (locale !== next && this.missedLocales.indexOf(locale) === -1) {
			this.missedLocales.push(locale);
		}
		this.persist(next);
		return next;
	}

	public getLocale(): PersistenceLocale {
		return this.locale;
	}

	public getMetadata(): PersistenceLocaleMetadata {
		return PERSISTENCE_LOCALES[this.locale];
	}

	public getSupportedLocales(): PersistenceLocaleMetadata[] {
		return PERSISTENCE_LOCALE_CODES.map((code) => PERSISTENCE_LOCALES[code]);
	}

	/** Drops the persisted preference and returns to the default locale. */
	public reset(): PersistenceLocale {
		try {
			this.storage.removeItem(this.storageKey);
		} catch {
			/* storage unavailable — in-memory state reset below is enough */
		}
		this.locale = PERSISTENCE_DEFAULT_LOCALE;
		return this.locale;
	}

	public snapshot(): PersistenceLocaleSnapshot {
		let persisted: string | null = null;
		try {
			persisted = this.storage.getItem(this.storageKey);
		} catch {
			persisted = null;
		}
		return {
			locale: this.locale,
			storageKey: this.storageKey,
			persisted,
			storageBackend: this.backend,
			supportedLocales: [...PERSISTENCE_LOCALE_CODES],
			direction: PERSISTENCE_LOCALES[this.locale].direction,
		};
	}

	/** Localized label for one of n8n's eight execution statuses. */
	public status(status: string): string {
		const key = EXECUTION_STATUS_KEYS[status as ExecutionStatus];
		if (!key) {
			this.missedKeys.push(`execution.status.unmapped:${status}`);
			return status;
		}
		return this.text(key);
	}

	/** Localized execution-mode label (manual / trigger / webhook / …). */
	public mode(mode: string): string {
		return this.text(`executionsList.modes.${mode}`);
	}

	/** Renders `key` in the active (or requested) locale with `{var}` interpolation. */
	public text(key: string, vars?: Record<string, string | number>, locale?: PersistenceLocale): string {
		const target = locale ?? this.locale;
		const table = PERSISTENCE_DICTIONARIES[target];
		const raw = table ? table[key] : undefined;
		if (raw === undefined) {
			this.missedKeys.push(`${target}:${key}`);
			return key;
		}
		if (!vars) {
			return raw;
		}
		return raw.replace(PLACEHOLDER, (match, name: string) =>
			Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
		);
	}

	/** Every canonical key rendered in `locale` (used by the leak gate). */
	public renderAll(locale?: PersistenceLocale): Record<string, string> {
		const target = locale ?? this.locale;
		const out: Record<string, string> = {};
		for (const key of PERSISTENCE_TEXT_KEYS) {
			out[key] = this.text(key, undefined, target);
		}
		return out;
	}

	/** Keys whose translation is missing — a cross-language leak in the making. */
	public leaks(): string[] {
		return [...this.missedKeys];
	}

	/** Locales that fell back to the default because they are not supported. */
	public unsupportedLocales(): string[] {
		return [...this.missedLocales];
	}

	public clearLeaks(): void {
		this.missedKeys.length = 0;
		this.missedLocales.length = 0;
	}

	private persist(locale: PersistenceLocale): void {
		try {
			this.storage.setItem(this.storageKey, locale);
		} catch {
			/* quota / disabled storage: the in-memory locale still applies */
		}
	}
}

export function createPersistenceLocaleStore(
	storage?: KeyValueStorage,
	locale?: PersistenceLocale,
): PersistenceLocaleStore {
	return new PersistenceLocaleStore(storage, locale);
}

export default PersistenceLocaleStore;
