/**
 * Boot payload delivery.
 *
 * The descriptor is delivered twice, from one source:
 *
 *   1. `<meta name="n8n-lego:frontend-bootstrap" content="<base64 json>">` on the
 *      served `index.html` — additive, the only change P2.5 makes to what the
 *      browser receives. (n8n's own templating already injects meta tags there:
 *      `%CONFIG_TAGS%`, `application-name`.)
 *   2. `GET /rest/frontend/bootstrap` — the same JSON, for tooling, LEGOs and
 *      tests that do not want to parse HTML.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import —
 * base64 is done with the platform primitives that exist in Node and in the
 * browser alike.
 */
import { BOOT_PAYLOAD_KEYS, CONTRACT_VERSION, describeContract } from './contract.mjs';
import { ERROR_CODES, ERROR_KINDS } from './errors.mjs';
import { describeLocales, describeMessageSlots } from './i18n.mjs';

export const FRONTEND_BOOT_META_NAME = 'n8n-lego:frontend-bootstrap';

/** Browser bridge a future extension script exposes; named here, written by the adapter. */
export const FRONTEND_BOOT_GLOBAL = '__N8N_LEGO_FRONTEND__';

/**
 * Builds the boot descriptor from the registry.
 *
 * @param {object} init
 * @param {ReturnType<import('./registry.mjs').createFrontendRegistry>} init.registry
 * @param {{ name: string, version: string, referenceVersion?: string }} init.app
 * @param {{ editorPackage: string, editorVersion: string, framework: string, frameworkIsolated: boolean, basePath: string, restEndpoint: string }} init.ui
 */
export function buildBootPayload({ registry, app, ui }) {
  const descriptor = registry.descriptor();
  const payload = {
    contractVersion: CONTRACT_VERSION,
    app: {
      name: app.name,
      version: app.version,
      referenceVersion: app.referenceVersion ?? null,
    },
    ui: {
      editorPackage: ui.editorPackage,
      editorVersion: ui.editorVersion,
      framework: ui.framework,
      frameworkIsolated: ui.frameworkIsolated === true,
      basePath: ui.basePath,
      restEndpoint: ui.restEndpoint,
    },
    contract: describeContract(),
    locales: describeLocales(),
    messageSlots: describeMessageSlots(),
    errorKinds: [...ERROR_KINDS],
    errorCodes: Object.values(ERROR_CODES),
    surfaces: descriptor.surfaces,
    extensionPoints: descriptor.extensionPoints,
    capabilities: descriptor.capabilities,
  };
  return Object.freeze(payload);
}

/** Deterministic field order for the payload, used by the encoder and by tests. */
export function payloadFields(payload) {
  return Object.keys(payload).sort((a, b) => {
    const indexA = BOOT_PAYLOAD_KEYS.indexOf(a);
    const indexB = BOOT_PAYLOAD_KEYS.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}

function toBase64(text) {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  // Browser fallback (utf8-safe).
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function fromBase64(encoded) {
  if (typeof Buffer !== 'undefined') return Buffer.from(encoded, 'base64').toString('utf8');
  const binary = globalThis.atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encodes a payload for transport in an attribute or a JSON field. */
export function encodeBootPayload(payload = {}) {
  return toBase64(JSON.stringify(payload));
}

/**
 * Decodes a payload.
 * @throws {Error} when the input is not base64-encoded JSON (a corrupted tag must be loud)
 */
export function decodeBootPayload(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('boot payload is empty');
  let text;
  try {
    text = fromBase64(encoded);
  } catch (error) {
    throw new Error(`boot payload is not valid base64: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`boot payload is not valid JSON: ${error.message}`);
  }
}

/** The `<meta>` tag to inject into `index.html` (empty string when there is no payload). */
export function bootMetaTag(payload) {
  if (!payload) return '';
  return `<meta name="${FRONTEND_BOOT_META_NAME}" content="${encodeBootPayload(payload)}">`;
}

/**
 * Extracts and decodes the boot payload from an HTML document.
 * @returns {object|null} null when the tag is absent (fail-soft: the stock UI still renders)
 */
export function extractBootPayload(html) {
  if (typeof html !== 'string') return null;
  const pattern = new RegExp(`<meta[^>]*name=["']${FRONTEND_BOOT_META_NAME}["'][^>]*content=["']([^"']+)["']`, 'i');
  const match = pattern.exec(html);
  if (!match) return null;
  try {
    return decodeBootPayload(match[1]);
  } catch {
    return null;
  }
}

/**
 * Validates the payload a consumer received (a future extension script must not
 * trust a page blindly). Unknown fields are ignored per the versioning rules.
 *
 * @returns {{ ok: boolean, errors: string[], version: string|null }}
 */
export function validateBootPayload(payload) {
  const errors = [];
  if (payload === null || typeof payload !== 'object') return { ok: false, errors: ['payload is not an object'], version: null };
  const version = typeof payload.contractVersion === 'string' ? payload.contractVersion : null;
  if (!version) errors.push('missing contractVersion');
  else if (version.split('.')[0] !== CONTRACT_VERSION.split('.')[0]) {
    errors.push(`contract major version mismatch: payload ${version}, consumer ${CONTRACT_VERSION}`);
  }
  for (const field of ['surfaces', 'extensionPoints', 'capabilities', 'locales']) {
    if (!Array.isArray(payload[field]) && typeof payload[field] !== 'object') errors.push(`missing field "${field}"`);
  }
  if (Array.isArray(payload.surfaces) && payload.surfaces.length === 0) errors.push('surface catalog is empty');
  return { ok: errors.length === 0, errors, version };
}

/**
 * The snippet a future extension script (or a test) runs in the page to publish
 * the payload. Plain JS, no framework API: reading the tag is the whole job.
 */
export function browserBootstrapSnippet() {
  return [
    '(function () {',
    `  var tag = document.querySelector('meta[name="${FRONTEND_BOOT_META_NAME}"]');`,
    '  if (!tag) return null;',
    '  try {',
    "    var binary = atob(tag.getAttribute('content') || '');",
    '    var bytes = Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });',
    "    var payload = JSON.parse(new TextDecoder().decode(bytes));",
    '  } catch (error) { return null; }',
    `  window.${FRONTEND_BOOT_GLOBAL} = payload;`,
    '  return payload;',
    '})();',
  ].join('\n');
}
