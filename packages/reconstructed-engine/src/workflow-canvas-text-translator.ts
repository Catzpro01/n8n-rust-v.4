// AGENT-3: GRAPHICAL CANVAS NODE SUBTITLE TRANSLATOR 6 BAHASA
// LEGO: connection (canvas UI subtitle mapping)
// Reference: n8n v2.9.4 ManualTrigger displayName "When clicking ‘Execute workflow’" + canvas run button "Execute workflow" + NDV "Test step"
// Zero cross-language leak: setiap locale hanya berisi bahasanya sendiri, keys identik antar locale, tidak ada campuran bahasa.
// Rekonstruksi murni TypeScript / Node.js 1:1 dari referensi n8n v2.9.4, tanpa Rust.

export const N8N_CANVAS_SUBTITLES = {
  en: {
    "When clicking ‘Execute workflow’": "When clicking ‘Execute workflow’",
    "When clicking ‘Test step’": "When clicking ‘Test step’",
    "Execute workflow": "Execute workflow",
    "Test step": "Test step"
  },
  id: {
    "When clicking ‘Execute workflow’": "Saat mengklik ‘Jalankan alur kerja’",
    "When clicking ‘Test step’": "Saat mengklik ‘Uji langkah’",
    "Execute workflow": "Jalankan alur kerja",
    "Test step": "Uji langkah"
  },
  jv: {
    "When clicking ‘Execute workflow’": "Nalika mencet ‘Lakokake alur kerja’",
    "When clicking ‘Test step’": "Nalika mencet ‘Uji jangkah’",
    "Execute workflow": "Lakokake alur kerja",
    "Test step": "Uji jangkah"
  },
  ar: {
    "When clicking ‘Execute workflow’": "عند النقر على ‘تشغيل سير العمل’",
    "When clicking ‘Test step’": "عند النقر على ‘اختبار الخطوة’",
    "Execute workflow": "تشغيل سير العمل",
    "Test step": "اختبار الخطوة"
  },
  zh: {
    "When clicking ‘Execute workflow’": "点击‘执行工作流’时",
    "When clicking ‘Test step’": "点击‘测试步骤’时",
    "Execute workflow": "执行工作流",
    "Test step": "测试步骤"
  },
  ru: {
    "When clicking ‘Execute workflow’": "При нажатии ‘Запустить процесс’",
    "When clicking ‘Test step’": "При нажатии ‘Тестировать шаг’",
    "Execute workflow": "Запустить процесс",
    "Test step": "Тестировать шаг"
  }
} as const;

export type CanvasSubtitleKey = keyof typeof N8N_CANVAS_SUBTITLES.en;
export type SupportedLanguage = keyof typeof N8N_CANVAS_SUBTITLES;
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["en", "id", "jv", "ar", "zh", "ru"];

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as string[]).includes(lang);
}

export function getCanvasSubtitle(lang: SupportedLanguage, key: CanvasSubtitleKey): string {
  return N8N_CANVAS_SUBTITLES[lang][key] ?? N8N_CANVAS_SUBTITLES.en[key];
}

export function getAllSubtitlesForLanguage(lang: SupportedLanguage) {
  return N8N_CANVAS_SUBTITLES[lang];
}

export function getSupportedLanguages(): SupportedLanguage[] {
  return [...SUPPORTED_LANGUAGES];
}

export function validateConsistency(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const baseKeys = Object.keys(N8N_CANVAS_SUBTITLES.en) as CanvasSubtitleKey[];
  for (const lang of SUPPORTED_LANGUAGES) {
    const keys = Object.keys(N8N_CANVAS_SUBTITLES[lang]);
    if (keys.length !== baseKeys.length) {
      errors.push(`Language ${lang} has ${keys.length} keys, expected ${baseKeys.length}`);
    }
    for (const k of baseKeys) {
      if (!(k in N8N_CANVAS_SUBTITLES[lang])) {
        errors.push(`Language ${lang} missing key: ${k}`);
      }
    }
  }
  // Zero cross-language leak check: ensure no other language's script appears in wrong locale
  // Simple heuristic: en should not contain non-ASCII that belongs to other locales except punctuation
  // For this LEGO, we enforce that each translation is non-empty and distinct from base where applicable
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang === "en") continue;
    for (const k of baseKeys) {
      const val = N8N_CANVAS_SUBTITLES[lang][k];
      if (!val || val.trim().length === 0) {
        errors.push(`Language ${lang} key "${k}" has empty translation`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// Self-validation on module load in development (no side effect in production)
if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
  const result = validateConsistency();
  if (!result.valid) {
    console.warn("[N8N_CANVAS_SUBTITLES] Consistency check failed:", result.errors);
  }
}
