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
  PLURAL_CATEGORIES,
  SUPPORTED_LOCALES,
  createPluralSelector,
  pluralKey,
  translationCoverage,
  buildMessageKey,
  createMessageCatalog,
  createTranslator,
  describeLocalizationContract,
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
  ACTIVATION_MODES,
  CAPABILITY_SCHEMA,
  CAPABILITY_STATUSES,
  RegistryError,
  createFrontendRegistry,
  validateCapability,
} from './src/registry.mjs';

export {
  CAPABILITY_STATES,
  CRITICALITY,
  LifecycleError,
  RUNNABLE_STATES,
  STATE_TRANSITIONS,
  TRUST_LEVELS,
  TRUST_RULES,
  canTransition,
  createLifecycle,
  degradationFor,
  describeLifecycle,
  describeTrust,
  isRunnable,
  mayPerform,
  trustInherited,
  trustRank,
} from './src/lifecycle.mjs';

export {
  ENVELOPE_FIELDS,
  EnvelopeError,
  TRANSPORTS,
  createOperationContext,
  describeEnvelope,
  nextCorrelationId,
  observationRecord,
} from './src/envelope.mjs';

export {
  DEVICE_PROFILES,
  ProfileError,
  REQUIREMENT_FIELDS,
  SUPPORT_STATES,
  describeProfiles,
  getProfile,
  resolveSupport,
  supportMatrix,
} from './src/profiles.mjs';

export {
  ImpactError,
  OWN_CONTRACTS,
  SELECTIVE_CAVEAT,
  TEST_TIERS,
  TIER_SUITES,
  commandFor,
  createImpactGraph,
  describeTestMap,
  requiresInstance,
} from './src/impact.mjs';

export {
  DEFAULT_INTERACTION,
  INTERACTION_CLASSES,
  INTERACTIONS,
  INTERACTION_TRANSPORTS,
  InteractionError,
  canCarry as canCarryInteraction,
  defineInteraction,
  describeInteractions,
  interactionOf,
  isInteractionClass,
  normaliseInteraction,
  resolveInteraction,
  transportsFor,
} from './src/interactions.mjs';

export {
  COMPATIBILITY,
  RANGE_EXAMPLES as VERSION_RANGE_EXAMPLES,
  VersionError,
  bump,
  compareVersions,
  compatibilityOf,
  describeVersions,
  isRange,
  isVersion,
  majorOf,
  minorOf,
  parseVersion,
  sameMajor,
  satisfiesRange,
} from './src/versions.mjs';

export {
  NO_CAPABILITY,
  backendCapabilitiesOf,
  capabilityOf,
  surfacesOfCapability,
} from './src/surface-capability.mjs';

export {
  CAPABILITY_ORIGINS,
  DEGRADATION_SITUATIONS,
  describeNegotiation,
} from './src/negotiation.mjs';

export {
  AVAILABILITY_STATES,
  CapabilityNotGrantedError,
  NegotiationError,
  createCapabilityNegotiator,
} from './src/negotiation.mjs';

export {
  BACKEND_STATES,
  backendAvailabilityFrom,
  describeBackendView,
} from './src/backend-view.mjs';

export {
  NoTransportError,
  SERIALIZATION,
  TRANSPORT_COSTS,
  TRANSPORT_KINDS,
  TransportError,
  createOperationGateway,
  declaredFutureTransports,
  defineLocalTransport,
  defineTransport,
  describeTransports,
} from './src/transport.mjs';

export {
  EVENT_FIELDS,
  EVENT_NAMES,
  FRONTEND_EVENTS,
  ObservabilityError,
  createBufferSink,
  createObservability,
  describeObservability,
} from './src/observability.mjs';

export {
  ARCHITECTURE_RULES,
  CONFORMANCE_STATES,
  checkConformance,
  describeConformance,
} from './src/conformance.mjs';

export {
  CONTEXT_LEVELS,
  PACK_ROOT,
  REFERENCE_FILES,
  TASK_INDEX,
  contextFor,
  describePack,
  packFiles,
} from './src/knowledge.mjs';

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

export {
  MANIFEST_DIR,
  MANIFEST_FILES,
  PACKAGE_ROOT,
  declaredCapabilityIds,
  extensionPointIds,
  loadManifests,
  skillSurface,
  subLegoIds,
  surfaceIds,
} from './src/manifests.mjs';
export {
  MAX_DEPTH,
  RANGE_EXAMPLES,
  SUB_LEGO_SCHEMA,
  SubLegoReplacementError,
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

export {
  AGENT_EVENT_TYPES,
  DELEGATION_FIELDS,
  EVENT_DELIVERY,
  EVENT_GROUPS,
  EVENT_STATUSES,
  SUMMARY_LIMIT,
  TERMINAL_STATUSES,
  TRACE_FIELDS,
  TRACE_LIMIT,
  AgentEventError,
  buildDelegationTree,
  createEventNormalizer,
  createWorkTrace,
  deliveryClassesFor,
  describeAgentEvents,
  isAgentEventType,
  validateTraceEvent,
} from './src/agent-events.mjs';

export {
  AI_CAPABILITIES,
  MCP_CONNECTION_STATES,
  MCP_OBJECTS,
  PROVIDER_KINDS,
  RUNTIME_DECLARATION_FIELDS,
  RUNTIME_IDENTITY_FIELDS,
  RUNTIME_KINDS,
  RUNTIME_LOCALITY,
  AgentContractError,
  describeAgents,
  describeInstallation,
  mcpRelationship,
  suitableRuntimes,
  validateProviderDeclaration,
  validateRuntimeDeclaration,
} from './src/agents.mjs';

export {
  CAPABILITY_ID_PATTERN,
  LOCAL_VOCABULARIES,
  QUOTED_FROM,
  VOCABULARIES,
  VocabularyError,
  assertTerm,
  compareVocabulary,
  describeVocabulary,
  detectCollisions,
  isDeclaredTerm,
  normaliseCapabilityId,
  vocabularyConflicts,
  vocabularyDrift,
  vocabularyOf,
} from './src/vocabulary.mjs';

/**
 * The Skill surface (P2.12): discovery and state presentation over the skill vocabulary the
 * backend declares. A skill is procedural knowledge — it is not a capability, not an agent,
 * and it never implies a permission, a tool or a model. Every word quoted here lives in the
 * vocabulary lock; the surface declares no vocabulary of its own.
 */
export {
  SKILL_AFFORDANCES,
  SKILL_CONTRACT_ID,
  SKILL_DECLARATION_FIELDS,
  SKILL_DECLARATION_SOURCE,
  SKILL_DEGRADATION_STATES,
  SKILL_DISCLOSURE_LEVELS,
  SKILL_FORBIDDEN_FIELDS,
  SKILL_FORBIDDEN_IMPLICATIONS,
  SKILL_IDENTITY_FIELDS,
  SKILL_INSTANCE_FIELDS,
  SKILL_LIFECYCLE,
  SKILL_OPERATIONS,
  SKILL_PERMISSIONS,
  SKILL_QUOTED_VOCABULARIES,
  SKILL_STATUSES,
  SkillDeclarationError,
  createSkillCatalog,
  describeSkills,
  searchSkills,
  skillDetail,
  skillLifecycle,
  skillState,
  skillUnsupported,
  validateSkillDeclaration,
  validateSkillInstance,
} from './src/skills.mjs';

export {
  CHANGE_KINDS,
  VERSION_MOVES,
  classifyChange,
} from './src/versions.mjs';

export {
  CAPABILITY_IDENTITY_FIELDS,
  IDENTITY_PROVENANCE_FIELDS,
  SEAM_FORBIDDEN,
  SEAM_INPUTS,
  SEAM_SOURCES,
  SeamError,
  capabilityIdentity,
  consumeInput,
  describeSeam,
  requireInput,
} from './src/seam.mjs';
