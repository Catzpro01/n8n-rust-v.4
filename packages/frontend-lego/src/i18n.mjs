/**
 * Translation readiness — structure only.
 *
 * P2.5 ships **no** dictionary and **no** translated string: it ships the shape a
 * future Translation LEGO fills, so that today's hard-coded strings have an
 * obvious home tomorrow instead of becoming architectural debt.
 *
 * What is fixed here:
 *   - the six locales (aligned with `contracts/localization.contract.md`), with
 *     `direction` metadata so RTL (Arabic) is a locale property, not a
 *     component special case;
 *   - the thirteen message slots every catalog must cover;
 *   - the key grammar `<slot>.<name>` and its validation;
 *   - the catalog + translator API with the backend's deterministic fallback
 *     chain (locale → `en` → raw key), placeholders `{name}` left intact when a
 *     value is missing.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/**
 * Supported locales. `status` is honest: `declared` means the contract can
 * represent it and the fallback chain works — it does **not** mean a dictionary
 * exists (the Translation LEGO adds those, keyed by these message slots).
 */
export const SUPPORTED_LOCALES = Object.freeze([
  Object.freeze({ code: 'id', englishName: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr', status: 'declared' }),
  Object.freeze({ code: 'en', englishName: 'English', nativeName: 'English', direction: 'ltr', status: 'declared', fallback: true }),
  Object.freeze({ code: 'ar', englishName: 'Arabic', nativeName: 'العربية', direction: 'rtl', status: 'declared' }),
  Object.freeze({ code: 'zh', englishName: 'Chinese', nativeName: '中文', direction: 'ltr', status: 'declared' }),
  Object.freeze({ code: 'ru', englishName: 'Russian', nativeName: 'Русский', direction: 'ltr', status: 'declared' }),
  Object.freeze({ code: 'jv', englishName: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr', status: 'declared' }),
]);

export const FALLBACK_LOCALE = 'en';

const LOCALE_BY_CODE = new Map(SUPPORTED_LOCALES.map((locale) => [locale.code, locale]));

/** True when the locale code is part of the contract. */
export function isSupportedLocale(code) {
  return LOCALE_BY_CODE.has(String(code ?? '').toLowerCase());
}

/**
 * Normalizes a BCP-47 tag (`id-ID`, `ar_SA`, `zh-CN`) to a supported locale,
 * exactly like the backend's `resolveLocale`: unknown input falls back to the
 * fallback locale rather than throwing.
 *
 * @param {string|null|undefined} tag
 * @param {{ defaultLocale?: string }} [options]
 * @returns {string}
 */
export function resolveLocale(tag, options = {}) {
  const fallback = options.defaultLocale && isSupportedLocale(options.defaultLocale) ? options.defaultLocale.toLowerCase() : FALLBACK_LOCALE;
  if (typeof tag !== 'string' || tag.length === 0) return fallback;
  const primary = tag.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return isSupportedLocale(primary) ? primary : fallback;
}

/** Text direction for a locale — metadata, never inferred from the component. */
export function directionOf(locale) {
  const resolved = resolveLocale(locale);
  return LOCALE_BY_CODE.get(resolved)?.direction ?? 'ltr';
}

export function localeMetadata(locale) {
  return LOCALE_BY_CODE.get(resolveLocale(locale)) ?? LOCALE_BY_CODE.get(FALLBACK_LOCALE);
}

/**
 * The thirteen message slots. Every user-visible string a future catalog carries
 * belongs to exactly one of them — this is the list the Translation LEGO must
 * cover, and the list a reviewer checks when a hard-coded string appears.
 */
export const MESSAGE_SLOTS = Object.freeze([
  Object.freeze({ id: 'navigation', title: 'Navigation', description: 'Main sidebar, settings sidebar, header, breadcrumbs', surfaces: ['navigation'] }),
  Object.freeze({ id: 'settings', title: 'Settings', description: 'Settings pages and section titles', surfaces: ['settings', 'navigation'] }),
  Object.freeze({ id: 'dashboard', title: 'Dashboard', description: 'Home/overview labels, counters, summaries', surfaces: ['dashboard'] }),
  Object.freeze({ id: 'node-menu', title: 'Node menu', description: 'Node creator entries, categories, actions', surfaces: ['node-picker', 'workflow-editor'] }),
  Object.freeze({ id: 'node-descriptions', title: 'Node descriptions', description: 'Node subtitles, parameter labels and hints', surfaces: ['node-picker', 'workflow-editor'] }),
  Object.freeze({ id: 'forms', title: 'Forms', description: 'Field labels, placeholders, help text, buttons', surfaces: ['auth', 'settings', 'workflow-editor', 'credentials'] }),
  Object.freeze({ id: 'dialogs', title: 'Dialogs', description: 'Modal titles, confirmations, destructive-action warnings', surfaces: ['dialogs'] }),
  Object.freeze({ id: 'notifications', title: 'Notifications', description: 'Toasts, banners, push-driven notices', surfaces: ['notifications', 'dashboard'] }),
  Object.freeze({ id: 'validation-errors', title: 'Validation errors', description: 'Client and server validation failures', surfaces: ['forms', 'error-surfaces', 'workflow-editor'] }),
  Object.freeze({ id: 'backend-errors', title: 'Backend errors', description: 'Every FrontendError message key (see errors.mjs)', surfaces: ['error-surfaces'] }),
  Object.freeze({ id: 'execution-errors', title: 'Execution errors', description: 'Node/execution failure messages from the engine', surfaces: ['executions', 'workflow-editor'] }),
  Object.freeze({ id: 'empty-states', title: 'Empty states', description: '“nothing here yet” copy for lists and pages', surfaces: ['dashboard', 'executions', 'credentials', 'node-picker'] }),
  Object.freeze({ id: 'system-messages', title: 'System messages', description: 'Setup/session notices, capability notices, upgrade hints', surfaces: ['auth', 'navigation', 'notifications'] }),
]);

const SLOT_IDS = new Set(MESSAGE_SLOTS.map((slot) => slot.id));

export function isMessageSlot(id) {
  return SLOT_IDS.has(id);
}

export function messageSlot(id) {
  return MESSAGE_SLOTS.find((slot) => slot.id === id) ?? null;
}

/** Grammar of a message key: `<slot>.<lowercase-name>` (dot-separated segments). */
export const MESSAGE_KEY_GRAMMAR = /^(?<slot>[a-z][a-z-]*)\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/**
 * Builds a message key. Throws on a bad slot or name — a typo must fail at the
 * call site, not become a missing translation later.
 */
export function buildMessageKey(slot, name) {
  if (!isMessageSlot(slot)) {
    throw new Error(`unknown message slot "${slot}" (declared slots: ${[...SLOT_IDS].join(', ')})`);
  }
  const normalized = String(name ?? '').trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(normalized)) {
    throw new Error(`invalid message name "${name}" for slot "${slot}"`);
  }
  return `${slot}.${normalized}`;
}

/**
 * Parses a message key.
 * @returns {{ slot: string, name: string } | null} null when invalid
 */
export function parseMessageKey(key) {
  if (typeof key !== 'string') return null;
  const match = MESSAGE_KEY_GRAMMAR.exec(key);
  if (!match) return null;
  const slot = match.groups.slot;
  if (!isMessageSlot(slot)) return null;
  return { slot, name: key.slice(slot.length + 1) };
}

export function isValidMessageKey(key) {
  return parseMessageKey(key) !== null;
}

/**
 * A catalog is a namespace-scoped set of keys for one locale. It is validated on
 * construction so a broken catalog cannot reach the translator.
 *
 * @param {{ locale: string, namespace: string, entries: Record<string,string>, meta?: object }} init
 */
export function createMessageCatalog({ locale, namespace, entries, meta } = {}) {
  if (!isSupportedLocale(locale)) {
    throw new Error(`unknown locale "${locale}" (declared locales: ${SUPPORTED_LOCALES.map((l) => l.code).join(', ')})`);
  }
  if (typeof namespace !== 'string' || !/^[a-z][a-z0-9-]*$/.test(namespace)) {
    throw new Error(`invalid catalog namespace "${namespace}"`);
  }
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error('catalog entries must be an object of { messageKey: text }');
  }
  const invalid = [];
  const empty = [];
  for (const [key, value] of Object.entries(entries)) {
    if (!isValidMessageKey(key)) invalid.push(key);
    else if (typeof value !== 'string' || value.trim().length === 0) empty.push(key);
  }
  if (invalid.length > 0) {
    throw new Error(`catalog ${namespace}/${locale} has keys outside the "<slot>.<name>" grammar: ${invalid.join(', ')}`);
  }
  if (empty.length > 0) {
    throw new Error(`catalog ${namespace}/${locale} has empty translations: ${empty.join(', ')}`);
  }
  return Object.freeze({
    locale: resolveLocale(locale),
    namespace,
    entries: Object.freeze({ ...entries }),
    meta: Object.freeze({ direction: directionOf(locale), ...(meta ?? {}) }),
    slots: Object.freeze([...new Set(Object.keys(entries).map((key) => key.split('.')[0]))]),
  });
}

/**
 * Deterministic fallback chain, identical to the backend's
 * (`contracts/localization.contract.md` §3): requested locale → fallback locale
 * → raw key. Unknown keys never throw; missing placeholders stay as written.
 *
 * @param {{ locale?: string, catalogs?: Array<object>, fallbackLocale?: string }} init
 */
export function createTranslator({ locale = FALLBACK_LOCALE, catalogs = [], fallbackLocale = FALLBACK_LOCALE } = {}) {
  const activeLocale = resolveLocale(locale, { defaultLocale: fallbackLocale });
  const index = new Map(); // locale -> Map(key -> text)
  for (const catalog of catalogs) {
    const normalized = catalog?.entries ? catalog : createMessageCatalog(catalog);
    const bucket = index.get(normalized.locale) ?? new Map();
    for (const [key, value] of Object.entries(normalized.entries)) bucket.set(key, value);
    index.set(normalized.locale, bucket);
  }

  function lookup(key, candidateLocale) {
    return index.get(candidateLocale)?.get(key);
  }

  /**
   * @param {string} key message key (`<slot>.<name>`); invalid keys are returned
   *   verbatim rather than throwing, so a typo degrades instead of crashing a surface
   * @param {Record<string, string|number>} [params] placeholder values
   */
  function t(key, params = {}) {
    const template = lookup(key, activeLocale) ?? lookup(key, resolveLocale(fallbackLocale)) ?? key;
    return substitute(template, params);
  }

  function has(key) {
    return lookup(key, activeLocale) !== undefined || lookup(key, resolveLocale(fallbackLocale)) !== undefined;
  }

  return {
    locale: activeLocale,
    direction: directionOf(activeLocale),
    fallbackLocale: resolveLocale(fallbackLocale),
    t,
    has,
    /** Additive, immutable: returns a new translator with the extra catalog. */
    withCatalog(catalog) {
      return createTranslator({ locale: activeLocale, catalogs: [...catalogs, catalog], fallbackLocale });
    },
    /** Keys this translator can resolve in the active or fallback locale. */
    keys() {
      return [...new Set([...(index.get(activeLocale)?.keys() ?? []), ...(index.get(resolveLocale(fallbackLocale))?.keys() ?? [])])].sort();
    },
  };
}

/** `{name}` substitution; unknown placeholders are left intact (never "undefined"). */
export function substitute(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null ? String(params[name]) : match,
  );
}

/**
 * Structural guarantee the contract asks for: every message slot is reachable
 * from at least one declared surface. A slot nobody owns is a slot whose strings
 * will be hard-coded somewhere instead.
 *
 * @param {Array<{ id: string, messageSlots?: string[] }>} surfaces
 */
export function unmappedMessageSlots(surfaces = []) {
  const covered = new Set(surfaces.flatMap((surface) => surface.messageSlots ?? []).filter((id) => isMessageSlot(id)));
  return MESSAGE_SLOTS.filter((slot) => !covered.has(slot.id)).map((slot) => slot.id);
}

/** Locale model as exposed to the boot payload. */
export function describeLocales() {
  return Object.freeze({
    supported: SUPPORTED_LOCALES,
    fallback: FALLBACK_LOCALE,
    rtl: SUPPORTED_LOCALES.filter((locale) => locale.direction === 'rtl').map((locale) => locale.code),
    dictionaries: 'none — the Translation LEGO supplies catalogs through the ui:message:catalog extension point',
  });
}


/** Message-slot model as exposed to the boot payload. */
/**
 * Translation coverage: which surface the catalog can reach, and which it cannot.
 * A surface nobody can translate is a surface where strings will be hard-coded.
 *
 * @param {Array<{ id: string, messageSlots?: string[] }>} surfaces
 */
export function translationCoverage(surfaces = []) {
  const slotIds = MESSAGE_SLOTS.map((slot) => slot.id);
  const declared = new Set(slotIds);
  const ownerOf = new Map();
  for (const slot of MESSAGE_SLOTS) {
    for (const surface of slot.surfaces ?? []) {
      if (!ownerOf.has(surface)) ownerOf.set(surface, []);
      ownerOf.get(surface).push(slot.id);
    }
  }
  const report = surfaces.map((surface) => {
    const slots = [...new Set([...(surface.messageSlots ?? []), ...(ownerOf.get(surface.id) ?? [])])].sort();
    return Object.freeze({ id: surface.id, slots: Object.freeze(slots), covered: slots.length > 0 && slots.every((slot) => declared.has(slot)) });
  });
  const used = new Set(report.flatMap((entry) => entry.slots));
  return Object.freeze({
    slots: Object.freeze(slotIds),
    surfaces: Object.freeze(report),
    uncoveredSurfaces: Object.freeze(report.filter((entry) => !entry.covered).map((entry) => entry.id)),
    orphanSlots: Object.freeze(slotIds.filter((slot) => !used.has(slot))),
  });
}

export function describeMessageSlots() {
  return Object.freeze(MESSAGE_SLOTS.map((slot) => Object.freeze({ id: slot.id, title: slot.title, surfaces: slot.surfaces })));
}
