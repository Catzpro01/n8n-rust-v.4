// Engine-layer localization (Phase 4B) — SWARM-PHASE4-11
//
// Lapisan ini MENUMPUKAN diri pada service kanonik Phase 4B
// (packages/workflow-lego/src/backend-localization-service.ts, 6 bahasa) dan
// hanya menambahkan key kalimat yang dibutuhkan mesin eksekusi DAG. Service
// kanonik TIDAK diubah agar kedua garis keturunan agen tetap merge-compatible.
//
// Aturan fallback: locale diminta -> bahasa Inggris -> key mentah.

import {
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	SUPPORTED_LOCALES,
	type LocaleMetadata,
	type SupportedLocale,
} from '../../workflow-lego/src/backend-localization-service.ts';

export type { LocaleMetadata, SupportedLocale };
export { NATIVE_DICTIONARIES, NativeLocalizationService, SUPPORTED_LOCALES };

/** Key kalimat milik mesin eksekusi. Placeholder ditulis `{nama}`. */
export const ENGINE_DICTIONARIES: Record<SupportedLocale, Record<string, string>> = {
	id: {
		'engine.node.success': 'Node "{node}" berhasil dieksekusi',
		'engine.node.error': 'Node "{node}" gagal dieksekusi: {error}',
		'engine.node.continued':
			'Kesalahan pada node "{node}" dilewati karena continueOnFail aktif; data masukan diteruskan',
		'engine.run.completed': 'Alur kerja selesai: {nodes} node dijalankan dalam {durationMs} ms',
		'engine.run.stopped': 'Alur kerja berhenti karena kesalahan pada node "{node}"',
		'engine.run.empty': 'Alur kerja tidak memiliki node untuk dijalankan',
	},
	en: {
		'engine.node.success': 'Node "{node}" executed successfully',
		'engine.node.error': 'Node "{node}" failed: {error}',
		'engine.node.continued':
			'Error in node "{node}" skipped because continueOnFail is enabled; input data passed through',
		'engine.run.completed': 'Workflow completed: {nodes} node(s) executed in {durationMs} ms',
		'engine.run.stopped': 'Workflow stopped due to an error in node "{node}"',
		'engine.run.empty': 'Workflow has no nodes to execute',
	},
	jv: {
		'engine.node.success': 'Node "{node}" kasil dilakokake',
		'engine.node.error': 'Node "{node}" gagal dilakokake: {error}',
		'engine.node.continued':
			'Klentu ing node "{node}" diliwati amarga continueOnFail aktif; data mlebu diterusake',
		'engine.run.completed': 'Alur kerja rampung: {nodes} node dilakokake sajroning {durationMs} ms',
		'engine.run.stopped': 'Alur kerja mandheg amarga klentu ing node "{node}"',
		'engine.run.empty': 'Alur kerja ora duwe node kanggo dilakokake',
	},
	ar: {
		'engine.node.success': 'تم تنفيذ العقدة "{node}" بنجاح',
		'engine.node.error': 'فشلت العقدة "{node}": {error}',
		'engine.node.continued':
			'تم تخطي الخطأ في العقدة "{node}" لأن continueOnFail مفعّل؛ تم تمرير بيانات الإدخال',
		'engine.run.completed': 'اكتمل سير العمل: تم تنفيذ {nodes} عقدة خلال {durationMs} ملّي ثانية',
		'engine.run.stopped': 'توقف سير العمل بسبب خطأ في العقدة "{node}"',
		'engine.run.empty': 'لا يحتوي سير العمل على أي عقدة للتنفيذ',
	},
	zh: {
		'engine.node.success': '节点“{node}”执行成功',
		'engine.node.error': '节点“{node}”执行失败：{error}',
		'engine.node.continued':
			'节点“{node}”的错误已跳过（continueOnFail 已启用）；输入数据继续传递',
		'engine.run.completed': '工作流已完成：共执行 {nodes} 个节点，用时 {durationMs} 毫秒',
		'engine.run.stopped': '工作流因节点“{node}”出错而停止',
		'engine.run.empty': '工作流中没有可执行的节点',
	},
	ru: {
		'engine.node.success': 'Узел «{node}» успешно выполнен',
		'engine.node.error': 'Сбой узла «{node}»: {error}',
		'engine.node.continued':
			'Ошибка узла «{node}» пропущена, так как включён continueOnFail; входные данные переданы дальше',
		'engine.run.completed': 'Процесс завершён: выполнено узлов — {nodes}, время — {durationMs} мс',
		'engine.run.stopped': 'Процесс остановлен из-за ошибки в узле «{node}»',
		'engine.run.empty': 'В процессе нет узлов для выполнения',
	},
};

export type TranslationParams = Record<string, string | number | boolean>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Normalisasi input locale apa pun (header HTTP, `id-ID`, `ar_SA`, null) ke
 * salah satu dari 6 locale yang didukung. Tidak dikenal -> locale aktif service.
 */
export function resolveLocale(input?: string | null): SupportedLocale {
	if (!input) return NativeLocalizationService.getLocale();
	const normalized = input.toLowerCase().replace('_', '-');
	const primary = normalized.split('-')[0] as SupportedLocale;
	if (Object.hasOwn(SUPPORTED_LOCALES, primary)) return primary;
	return NativeLocalizationService.getLocale();
}

/** Arah tulis locale (dipakai untuk merapikan laporan RTL). */
export function getTextDirection(locale: SupportedLocale): 'ltr' | 'rtl' {
	return SUPPORTED_LOCALES[locale]?.direction ?? 'ltr';
}

/**
 * Terjemahkan key milik mesin dengan substitusi placeholder.
 * Rantai fallback: ENGINE_DICTIONARIES[locale] -> NATIVE_DICTIONARIES[locale]
 * -> *['en'] -> key mentah.
 */
export function translateEngine(
	key: string,
	params: TranslationParams = {},
	locale: SupportedLocale = NativeLocalizationService.getLocale(),
): string {
	const template =
		ENGINE_DICTIONARIES[locale]?.[key] ??
		NATIVE_DICTIONARIES[locale]?.[key] ??
		ENGINE_DICTIONARIES.en[key] ??
		NATIVE_DICTIONARIES.en[key] ??
		key;

	return template.replace(PLACEHOLDER, (match, name: string) =>
		Object.hasOwn(params, name) ? String(params[name]) : match,
	);
}

/** Daftar locale yang didukung mesin (kode + nama asli + arah tulis). */
export function getEngineLocales(): LocaleMetadata[] {
	return NativeLocalizationService.getSupportedLocales();
}
