/**
 * Phase 5-07 — Canvas node subtitle translator (hub-native adoption of SWARM-ROUND4-03).
 *
 * Provenance:
 * - Reference: `ManualTrigger.node.ts:20` — `defaults: { name: 'When clicking ‘Execute workflow’' }`
 *   (CURLY quotes U+2018/U+2019). Other attested shapes: straight quotes
 *   (`ai-workflow-builder` fixture `When clicking 'Test workflow'`) and no quotes
 *   (`code-builder` default `When clicking Test workflow`).
 * - SWARM-ROUND4-03 (agent-3, `workflow-canvas-text-translator`) shipped raw dictionaries for
 *   id/jv/ar/zh/ru keyed by the STRAIGHT-quote form — which misses the reference-exact curly
 *   default name. Adopted hub-natively: the hub owns `canvas.node.subtitle.*` (all six locales)
 *   and this module only MATCHES subtitle text to a hub key, normalizing quote style and
 *   whitespace. Case is intentionally NOT folded: canvas chrome strings are byte-pinned
 *   upstream, and folding would risk translating user content (e.g. workflow names).
 * - Non-matches (unknown text, workflow names such as `When clicking 'Test workflow'`) pass
 *   through UNCHANGED — names are user content, not chrome.
 *
 * Boundary: this module imports nothing (like the hub). The caller supplies the hub's
 * `translate` function, so the translator stays dependency-free and directly importable.
 * Erasable TypeScript only (no enums/namespaces) so tests can import this file directly.
 */

export type CanvasTranslateFn = (key: string, locale: string) => string;

export const CANVAS_SUBTITLE_MANUAL_KEY = 'canvas.node.subtitle.manual';
export const CANVAS_SUBTITLE_TEST_STEP_KEY = 'canvas.node.subtitle.testStep';

/** Single- and double-quote characters (ASCII + Unicode) treated as presentational. */
const QUOTE_CHARS = /['"`´‘’‚‛“”„‟′″]/g;

/**
 * Canonical subtitle form: strip all quote characters, collapse whitespace.
 * `When clicking ‘Execute workflow’` → `When clicking Execute workflow`.
 */
export function normalizeCanvasSubtitle(text: string): string {
  return text.replace(QUOTE_CHARS, '').replace(/\s+/g, ' ').trim();
}

const CANONICAL_MANUAL = 'When clicking Execute workflow';
const CANONICAL_TEST_STEP = 'When clicking Test step';

/** Match subtitle text to its hub key, or `null` when the text is not known chrome. */
export function matchCanvasSubtitleKey(text: string): string | null {
  const canonical = normalizeCanvasSubtitle(text);
  if (canonical === CANONICAL_MANUAL) return CANVAS_SUBTITLE_MANUAL_KEY;
  if (canonical === CANONICAL_TEST_STEP) return CANVAS_SUBTITLE_TEST_STEP_KEY;
  return null;
}

/**
 * Translate canvas subtitle text through the hub. Unknown text passes through unchanged;
 * locale fallback is the hub's (`translate` handles aliases and the `en` terminator).
 */
export function translateCanvasSubtitle(
  text: string,
  locale: string,
  translate: CanvasTranslateFn,
): string {
  const key = matchCanvasSubtitleKey(text);
  if (key === null) return text;
  return translate(key, locale);
}
