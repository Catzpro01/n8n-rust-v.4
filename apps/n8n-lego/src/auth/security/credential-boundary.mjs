/**
 * P5.4 — the credential security boundary.
 *
 * The one rule this file exists to enforce: a runtime secret leaves storage
 * ONLY through a SecretRef redeemed at the boundary (see `secret-ref.mjs`).
 * Everything the editor, the REST API, logs, errors, audit and telemetry ever
 * see is metadata, non-secret configuration, or a redaction sentinel.
 *
 * The redaction shape is NOT invented here. It is n8n's own contract, recorded
 * from n8n 2.9.4 in `tests/reference/agent-4/golden/credentials.golden.json`:
 *
 *   GET  /rest/credentials/:id                 -> no `data` field at all
 *   GET  /rest/credentials/:id?includeData=true-> `data` present, secret values
 *                                                replaced by
 *                                                `__n8n_BLANK_VALUE_<uuid>`
 *   PATCH /rest/credentials/:id echoing back
 *         the sentinel                        -> the sentinel is dropped and the
 *                                                stored secret is preserved
 *
 * Which fields count as secret is also not guessed: it comes from the canonical
 * credential-type catalog (387 types), where n8n marks a property with
 * `typeOptions.password: true`. For `httpHeaderAuth` that is `value` and not
 * `name` — which is exactly what the golden file records.
 *
 * When a type is UNKNOWN we do not guess which field is safe: every value is
 * treated as secret. Failing closed is the only defensible default.
 */

/**
 * n8n's blank-value sentinel prefix. The editor renders this as an empty
 * password field and echoes it back unchanged on save, which is how n8n knows
 * "the user did not retype this".
 */
export const CREDENTIAL_BLANK_PREFIX = '__n8n_BLANK_VALUE_';

/** Fields of a credential record that are safe to publish as metadata. */
export const CREDENTIAL_METADATA_FIELDS = Object.freeze([
  'id',
  'name',
  'type',
  'createdAt',
  'updatedAt',
  'tenantId',
  'credentialVersion',
]);

/** Default view flags n8n's `ICredentialsResponse` exposes. */
const DEFAULT_FLAGS = Object.freeze({
  isManaged: false,
  isGlobal: false,
  isResolvable: false,
  resolvableAllowFallback: false,
  resolverId: null,
  shared: [],
  scopes: [],
  resource: 'credential',
});

/**
 * True when `value` is one of n8n's blank-value sentinels.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlankSentinel(value) {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(CREDENTIAL_BLANK_PREFIX)) return false;
  // A bare prefix with no id is not a sentinel the editor would have produced.
  return value.length > CREDENTIAL_BLANK_PREFIX.length;
}

/**
 * Builds a type -> Set(secret field names) index from the canonical credential
 * catalog. Memoised per catalog array because the catalog is immutable once
 * loaded and this is consulted on every credential read.
 *
 * @param {Array<object>} credentialTypes entries from `credentials.json`
 * @returns {{ secretFields(typeName: string): Set<string>|null, has(typeName: string): boolean }}
 */
export function createCredentialTypeIndex(credentialTypes) {
  /** @type {Map<string, Set<string>>} */
  const byType = new Map();

  for (const entry of Array.isArray(credentialTypes) ? credentialTypes : []) {
    if (!entry || typeof entry.name !== 'string') continue;
    const secret = new Set();
    for (const property of Array.isArray(entry.properties) ? entry.properties : []) {
      if (!property || typeof property.name !== 'string') continue;
      if (property.typeOptions && property.typeOptions.password === true) secret.add(property.name);
    }
    byType.set(entry.name, secret);
  }

  return Object.freeze({
    has: (typeName) => byType.has(typeName),
    /**
     * @param {string} typeName
     * @returns {Set<string>|null} null when the type is unknown, meaning
     *   "every value must be treated as secret".
     */
    secretFields: (typeName) => byType.get(typeName) ?? null,
    size: () => byType.size,
  });
}

/**
 * Splits a stored credential record into its three parts. This separation is
 * the backbone of P5.4: a consumer that is handed `metadata` and `configuration`
 * still cannot reach the runtime secret.
 *
 * @param {object} record a stored credential
 * @param {Set<string>|null} secretFields null => treat every value as secret
 * @returns {{ metadata: object, configuration: object, runtimeSecret: object }}
 */
export function splitCredential(record, secretFields) {
  const data = record && typeof record.data === 'object' && record.data !== null ? record.data : {};
  const configuration = {};
  const runtimeSecret = {};

  for (const [key, value] of Object.entries(data)) {
    // An unknown type has no safe subset, so everything is secret.
    const isSecret = secretFields === null ? true : secretFields.has(key);
    if (isSecret) runtimeSecret[key] = value;
    else configuration[key] = value;
  }

  const metadata = {
    id: record?.id,
    name: record?.name,
    type: record?.type,
    createdAt: record?.createdAt,
    updatedAt: record?.updatedAt,
    tenantId: record?.tenantId ?? null,
    credentialVersion: record?.credentialVersion ?? 1,
  };

  return Object.freeze({
    metadata: Object.freeze(metadata),
    configuration: Object.freeze(configuration),
    runtimeSecret: Object.freeze(runtimeSecret),
  });
}

/**
 * Replaces every runtime-secret value with a blank sentinel, leaving
 * non-secret configuration values untouched — which is what the editor needs
 * in order to render a populated form (it shows the header `name`, not the
 * header `value`).
 *
 * @param {object} record
 * @param {Set<string>|null} secretFields
 * @param {{ uuid?: () => string }} [options]
 * @returns {object} the credential `data` as the editor may see it
 */
export function redactCredentialData(record, secretFields, { uuid = defaultUuid } = {}) {
  const { configuration, runtimeSecret } = splitCredential(record, secretFields);
  const redacted = { ...configuration };
  for (const key of Object.keys(runtimeSecret)) {
    redacted[key] = `${CREDENTIAL_BLANK_PREFIX}${uuid()}`;
  }
  return redacted;
}

/**
 * Merges an editor submission into the stored credential, treating a sentinel
 * as "unchanged". This is the property the golden file pins as
 * `updateWithBlankedValueKeepsSecret`: a client that echoes back the blank
 * sentinel must not overwrite the stored secret with the literal string
 * `__n8n_BLANK_VALUE_…`.
 *
 * @param {object|null|undefined} existingData
 * @param {object|null|undefined} incomingData
 * @returns {object}
 */
export function mergeCredentialData(existingData, incomingData) {
  const existing =
    existingData && typeof existingData === 'object' && !Array.isArray(existingData) ? existingData : {};
  const incoming =
    incomingData && typeof incomingData === 'object' && !Array.isArray(incomingData) ? incomingData : {};

  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (isBlankSentinel(value)) {
      // The editor never showed this value, so it cannot have changed it.
      // Keep whatever is stored; drop the key entirely when there is nothing.
      if (key in existing) continue;
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * The credential as the REST surface may publish it. `data` is either absent
 * or fully redacted — it is never the stored runtime secret.
 *
 * @param {object} record
 * @param {{ includeData?: boolean, secretFields?: Set<string>|null, uuid?: () => string }} [options]
 * @returns {object}
 */
export function credentialEditorView(record, { includeData = false, secretFields = null, uuid = defaultUuid } = {}) {
  const view = {
    id: record?.id,
    name: record?.name,
    type: record?.type,
    createdAt: record?.createdAt,
    updatedAt: record?.updatedAt,
    ...DEFAULT_FLAGS,
  };
  if (record?.tenantId !== undefined) view.tenantId = record.tenantId;
  if (record?.credentialVersion !== undefined) view.credentialVersion = record.credentialVersion;
  if (includeData) view.data = redactCredentialData(record, secretFields, { uuid });
  return view;
}

/**
 * Fail-closed guard for anything about to be logged, audited, put in an error,
 * emitted as telemetry or written into an execution payload. Throws rather than
 * sanitising, because a caller that is about to leak a secret should stop, not
 * be quietly rewritten.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @returns {void}
 */
export function assertNoSecretMaterial(value, label = 'value') {
  if (typeof value === 'string') {
    if (value.length === 0) return;
    // A sentinel is safe to log; the material it stands in for is not.
    if (isBlankSentinel(value)) return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertNoSecretMaterial(nested, `${label}.${key}`);
    }
    return;
  }
  // Scalars cannot be distinguished from secrets by shape, so the guard only
  // objects to the things that are unambiguously credential material.
}

/**
 * True when the object contains a `data` bag holding anything that is not a
 * blank sentinel — i.e. something that must never have reached this surface.
 *
 * @param {object} view
 * @param {Set<string>|null} secretFields
 * @returns {boolean}
 */
export function containsRuntimeSecret(view, secretFields) {
  const data = view?.data;
  if (!data || typeof data !== 'object') return false;
  const { runtimeSecret } = splitCredential({ data }, secretFields);
  for (const value of Object.values(runtimeSecret)) {
    if (value === undefined || value === null || value === '') continue;
    if (isBlankSentinel(value)) continue;
    return true;
  }
  return false;
}

/** Deterministic-enough id for a sentinel; format matches n8n's uuid suffix. */
function defaultUuid() {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random()
    .toString(16)
    .slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 14)}`;
}
