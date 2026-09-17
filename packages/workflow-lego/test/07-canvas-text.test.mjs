/**
 * Phase 5-07 — canvas subtitle translator: hub-native adoption of SWARM-ROUND4-03.
 *
 * R4-03 (agent-3) shipped raw id/jv/ar/zh/ru dictionaries keyed by the STRAIGHT-quote form
 * `When clicking 'Execute workflow'` — no matcher, no tests. The reference-exact default name
 * is the CURLY form (`ManualTrigger.node.ts:20`), so a straight-quote lookup misses it. This
 * suite pins the adopted behavior: quote-normalizing match → hub-owned `canvas.node.subtitle.*`
 * keys → locale fallback/passthrough.
 *
 * Unlike suite 06 (which pins mechanism, never translation text), this suite DOES pin the
 * R4-03 value table verbatim: that table is the adoption contract, guarding against silent
 * drift from the agent-3 artifact.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocalizationHub } from '../../../tools/localization-module-loader.mjs';
import {
  matchCanvasSubtitleKey,
  translateCanvasSubtitle,
  normalizeCanvasSubtitle,
  CANVAS_SUBTITLE_MANUAL_KEY,
  CANVAS_SUBTITLE_TEST_STEP_KEY,
} from '../src/canvas-text-translator.ts';

const hub = await loadLocalizationHub({ fresh: true });
const { NativeLocalizationService } = hub.service;
const t = (key, locale) => NativeLocalizationService.translate(key, locale);

beforeEach(() => {
  NativeLocalizationService.resetRegistry();
  NativeLocalizationService.setLocale('id');
});

// Reference-exact default name (ManualTrigger.node.ts:20, curly U+2018/U+2019)
const CURLY_MANUAL = 'When clicking ‘Execute workflow’';
const STRAIGHT_MANUAL = "When clicking 'Execute workflow'";

// R4-03 value table, verbatim (en base: straight-quote canonical form)
const MANUAL = {
  en: "When clicking 'Execute workflow'",
  id: "Saat mengklik 'Jalankan alur kerja'",
  jv: "Nalika mencet 'Lakokake alur kerja'",
  ar: "عند النقر على 'تشغيل سير العمل'",
  zh: "点击'执行工作流'时",
  ru: "При нажатии 'Запустить процесс'",
};
const TEST_STEP = {
  en: "When clicking 'Test step'",
  id: "Saat mengklik 'Uji langkah'",
  jv: "Nalika mencet 'Uji jangkah'",
  ar: "عند النقر على 'اختبار الخطوة'",
  zh: "点击'测试步骤'时",
  ru: "При нажатии 'Тестировать шаг'",
};

test('matcher: every quote variant of the manual subtitle resolves (curly = reference-exact)', () => {
  assert.equal(matchCanvasSubtitleKey(CURLY_MANUAL), CANVAS_SUBTITLE_MANUAL_KEY);
  assert.equal(matchCanvasSubtitleKey(STRAIGHT_MANUAL), CANVAS_SUBTITLE_MANUAL_KEY);
  assert.equal(matchCanvasSubtitleKey('When clicking "Execute workflow"'), CANVAS_SUBTITLE_MANUAL_KEY);
  assert.equal(matchCanvasSubtitleKey('When clicking `Execute workflow`'), CANVAS_SUBTITLE_MANUAL_KEY);
  assert.equal(matchCanvasSubtitleKey('When clicking Execute workflow'), CANVAS_SUBTITLE_MANUAL_KEY);
  assert.equal(matchCanvasSubtitleKey('  When clicking   ‘Execute workflow’  '), CANVAS_SUBTITLE_MANUAL_KEY);
  assert.equal(normalizeCanvasSubtitle(CURLY_MANUAL), 'When clicking Execute workflow');
});

test('matcher: test-step subtitle resolves in straight and curly form', () => {
  assert.equal(matchCanvasSubtitleKey("When clicking 'Test step'"), CANVAS_SUBTITLE_TEST_STEP_KEY);
  assert.equal(matchCanvasSubtitleKey('When clicking ‘Test step’'), CANVAS_SUBTITLE_TEST_STEP_KEY);
});

test('matcher: user content and non-subtitles never match (passthrough)', () => {
  // Workflow NAMES are user content, not chrome — even in the same sentence shape
  assert.equal(matchCanvasSubtitleKey("When clicking 'Test workflow'"), null);
  assert.equal(matchCanvasSubtitleKey('When clicking Test workflow'), null);
  // Short chrome resolves via the hub directly (execute.workflow), not via subtitles
  assert.equal(matchCanvasSubtitleKey('Execute workflow'), null);
  // Case is byte-pinned upstream; folding would risk translating user content
  assert.equal(matchCanvasSubtitleKey("when clicking 'Execute workflow'"), null);
  assert.equal(matchCanvasSubtitleKey(''), null);
  assert.equal(matchCanvasSubtitleKey('Totally unrelated node name'), null);
});

test('end-to-end: R4-03 manual table verbatim in all six locales', () => {
  for (const [locale, expected] of Object.entries(MANUAL)) {
    assert.equal(translateCanvasSubtitle(CURLY_MANUAL, locale, t), expected, `manual/${locale}`);
    assert.equal(translateCanvasSubtitle(STRAIGHT_MANUAL, locale, t), expected, `manual-straight/${locale}`);
  }
});

test('end-to-end: R4-03 test-step table verbatim in all six locales', () => {
  for (const [locale, expected] of Object.entries(TEST_STEP)) {
    assert.equal(translateCanvasSubtitle("When clicking 'Test step'", locale, t), expected, locale);
  }
});

test('locale fallback and unknown-text passthrough', () => {
  // Unknown locale terminates at the English base text (hub fallbackLocale: 'en')
  assert.equal(translateCanvasSubtitle(CURLY_MANUAL, 'xx', t), MANUAL.en);
  assert.equal(translateCanvasSubtitle(CURLY_MANUAL, '', t), MANUAL.en);
  // Legacy/alias tags normalize onto the hub locale
  assert.equal(translateCanvasSubtitle(CURLY_MANUAL, 'in', t), MANUAL.id);
  assert.equal(translateCanvasSubtitle(CURLY_MANUAL, 'jw', t), MANUAL.jv);
  // Unknown text passes through UNCHANGED in every locale
  assert.equal(translateCanvasSubtitle("When clicking 'Test workflow'", 'id', t), "When clicking 'Test workflow'");
  assert.equal(translateCanvasSubtitle('Execute workflow', 'ru', t), 'Execute workflow');
  assert.equal(translateCanvasSubtitle('', 'id', t), '');
});
