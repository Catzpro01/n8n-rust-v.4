/**
 * `@lego/frontend` — Frontend LEGO public surface (P2.5).
 *
 * Framework-neutral contract layer between the n8n editor UI and the
 * compatibility/API boundary. Consumed by:
 *
 *   apps/n8n-lego/src/frontend.mjs   the runtime (boot payload + registry)
 *   packages/frontend-lego/test/**   the contract/architecture tests
 *   future frontend feature LEGOs    through the declared extension points
 *
 * The normative document is `contracts/frontend.contract.md`; the architecture and
 * the migration notes for future frontend features are in
 * `docs/n8n-lego/FRONTEND_LEGO.md`.
 */
export {
  BOOT_PAYLOAD_KEYS,
  CAPABILITY_DISCOVERY,
  CONTRACT_ID,
  CONTRACT_VERSION,
  EMPTY_BODY_ENDPOINTS,
  ENVELOPES,
  ENVELOPE_KEYS,
  EVENTS,
  LIST_ENDPOINTS,
  LIST_SHAPES,
  ROUTE_CONVENTIONS,
  SESSION,
  STATUS_SEMANTICS,
  VERSIONING,
  answersEmptyBody,
  describeContract,
  resolveListShape,
} from './src/contract.mjs';

export {
  ERROR_CODES,
  ERROR_KINDS,
  FrontendError,
  assertErrorKeysUseDeclaredSlots,
  errorMessageKeys,
  isFrontendError,
  kindForStatus,
  normalizeError,
  toDisplayModel,
} from './src/errors.mjs';

export {
  FALLBACK_LOCALE,
  MESSAGE_KEY_GRAMMAR,
  MESSAGE_SLOTS,
  SUPPORTED_LOCALES,
  buildMessageKey,
  createMessageCatalog,
  createTranslator,
  describeLocales,
  describeMessageSlots,
  directionOf,
  isMessageSlot,
  isSupportedLocale,
  isValidMessageKey,
  localeMetadata,
  messageSlot,
  parseMessageKey,
  resolveLocale,
  substitute,
  unmappedMessageSlots,
} from './src/i18n.mjs';

export {
  CAPABILITY_SCHEMA,
  CAPABILITY_STATUSES,
  RegistryError,
  createFrontendRegistry,
  validateCapability,
} from './src/registry.mjs';

export {
  FRONTEND_BOOT_GLOBAL,
  FRONTEND_BOOT_META_NAME,
  bootMetaTag,
  browserBootstrapSnippet,
  buildBootPayload,
  decodeBootPayload,
  encodeBootPayload,
  extractBootPayload,
  payloadFields,
  validateBootPayload,
} from './src/boot.mjs';

export { createRestClient, createStateStore, STATE_STATUSES } from './src/client.mjs';

export { MANIFEST_DIR, MANIFEST_FILES, PACKAGE_ROOT, extensionPointIds, loadManifests, subLegoIds, surfaceIds } from './src/manifests.mjs';
export {
  RANGE_EXAMPLES,
  SUB_LEGO_SCHEMA,
  SUB_LEGO_STATUSES,
  SubLegoError,
  SubLegoUpgradeError,
  UPGRADE_POLICIES,
  createSubLegoRegistry,
  depthOf,
  parentIdOf,
  satisfies,
  validateSubLego,
} from './src/sublegos.mjs';

export { ADAPTER, CONVENTIONS, createVueAdapter } from './src/adapters/vue.mjs';
export { ADAPTERS, CURRENT_ADAPTER, CURRENT_ADAPTER_ID, createAdapter } from './src/adapters/index.mjs';

export { createFrontendLego } from './src/lego.mjs';
