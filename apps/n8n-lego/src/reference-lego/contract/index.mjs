/**
 * Reference LEGO — PUBLIC CONTRACT (`reference.lego`, v1.0.0, owner: manager).
 *
 * TEMPLATE, NOT A FEATURE. Nothing here is mounted on a route. Copy the shape,
 * not the behaviour. See ../README.md.
 *
 * What a public contract file is allowed to contain:
 *   - capability identity and contract version,
 *   - request/response models (plain data shapes),
 *   - the port factory consumers call,
 *   - error identity raised as codes from the LEGO error contract.
 *
 * What it must never contain:
 *   - persistence details, internal algorithms, internal data structures
 *     (those live in ../internal/, which no other domain may import),
 *   - HTTP: no `req`/`res`, no status codes. Transport is the compatibility
 *     layer's job, so this contract stays reusable by a CLI, a worker or a test.
 *
 * Allowed imports here: the shared kernel and the LEGO foundation only.
 */
import { assertErrorCode } from '../../lego/errors.mjs';
import { createReferenceStore } from '../internal/store.mjs';

/** Capability identity — must match the id registered in src/lego/manifest/domains.json. */
export const REFERENCE_CAPABILITY = 'reference.echo';

/** Contract version — must match the row in src/lego/contracts/contract-lock.json. */
export const REFERENCE_CONTRACT_VERSION = '1.0.0';

/**
 * Error identity this contract can raise. Codes come from the shared error
 * contract; a domain never invents a code at the call site.
 * `reference.*` has no registered codes (the template raises none in anger), so
 * it borrows `storage.not_found` to show the assertion in use.
 */
export const REFERENCE_ERRORS = Object.freeze({
  notFound: assertErrorCode('storage.not_found'),
});

/**
 * Request model. Plain data: no class, no framework object, nothing that ties a
 * consumer to this implementation.
 * @typedef {{ key: string, value: unknown }} ReferencePutRequest
 * @typedef {{ key: string, value: unknown, revision: number }} ReferenceRecord
 */

/**
 * Domain-level error. Carries a contract error code, not an HTTP status — the
 * compatibility layer is what turns a code into a response.
 */
export class ReferenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReferenceError';
    this.code = assertErrorCode(code);
  }
}

/**
 * The port. Consumers receive behaviour, never the internal structure, so the
 * implementation behind it is replaceable without touching a single consumer.
 *
 * @param {{ logger?: { debug: Function } }} [deps] injected — a LEGO never
 *        reaches out for its own collaborators, the composition root supplies them.
 * @returns {{
 *   capability: string,
 *   version: string,
 *   put(request: ReferencePutRequest): ReferenceRecord,
 *   get(key: string): ReferenceRecord,
 *   has(key: string): boolean,
 * }}
 */
export function createReferenceLego({ logger } = {}) {
  const store = createReferenceStore();

  return Object.freeze({
    capability: REFERENCE_CAPABILITY,
    version: REFERENCE_CONTRACT_VERSION,

    put({ key, value }) {
      if (typeof key !== 'string' || key === '') {
        throw new ReferenceError('storage.not_found', 'key must be a non-empty string');
      }
      const record = store.write(key, value);
      logger?.debug?.('[reference-lego] wrote record', { key, revision: record.revision });
      return record;
    },

    get(key) {
      const record = store.read(key);
      if (!record) throw new ReferenceError(REFERENCE_ERRORS.notFound, `no reference record for '${key}'`);
      return record;
    },

    has(key) {
      return store.read(key) !== undefined;
    },
  });
}
