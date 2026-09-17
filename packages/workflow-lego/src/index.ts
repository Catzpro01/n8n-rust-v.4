/**
 * @lego/workflow — Workflow Model LEGO (Phase 2 structural isolation).
 *
 * OWNERSHIP (see manifest/ownership.json)
 *   owns         : workflow structure, node collection, connections,
 *                  adjacency indexes, graph validation, content checksum/diff
 *   does NOT own : execution, expression runtime, persistence, webhook runtime,
 *                  scheduler — reachable only through the declared ports
 *
 * ENTRY POINTS
 *   ./model-surface  the public surface downstream LEGOs may consume
 *   ./ports          the declared outer boundary (contract + adapters)
 *   ./localization-runtime + ./backend-localization-service
 *                    the native multi-language line (Phase 4C), promoted to the
 *                    package surface in Phase 4D — see contracts/localization.contract.md
 *
 * RUST: NOT STARTED. This package currently binds to the pinned reference
 * runtime; it does not replace it.
 */
export * from './model-surface';
export {
	portMode,
	referencePackage,
	type PortMode,
} from './ports/runtime';
export type {
	ConstantsPort,
	ConfigPort,
	ChecksumDigestPort,
	ErrorLike,
	ErrorsPort,
	ExpressionLike,
	ExpressionRuntimePort,
	HostContext,
	NodeModelPort,
	NodeReferencePort,
	NodeRenamePort,
	ObservableObjectPort,
	UtilsPort,
	VocabularyPort,
	WorkflowLegoPorts,
} from './ports/contracts';
export { NODE_CONNECTION_TYPES, STARTING_NODE_TYPES, DEFAULT_TIMEZONE } from './kernel/snapshots';

/**
 * NATIVE LOCALIZATION LINE (Phase 4A/4B/4C, promoted to the surface in Phase 4D).
 *
 *   settings-localization-adapter  — where the operator's choice lives (Phase 4A)
 *   backend-localization-service   — the canonical catalog and the six dictionaries (Phase 4B)
 *   localization-runtime           — resolution chain, direction, interpolation, engine messages (Phase 4C)
 *   localization-envelope          — run data / node status lines / API errors (Phase 4E, consumer seam)
 *   localization-vocabulary        — product/run/API-hint strings, composed runtime (Phase 4F)
 *   execution-log-record           — the persisted execution record + its localized block (Phase 4F)
 *   api-error-response             — localized success/error/health bodies, reference-exact (Phase 4F)
 *
 * BOUNDARY: the runtime has no imports and consumes the service through a port, so promoting the
 * line adds symbols to the package surface without adding a single dependency edge. The UI module
 * (Phase 4A) is intentionally NOT re-exported: `settings-localization-adapter` presents editor-facing
 * labels, and PROJECT_RULES #2 keeps every UI concern in the untouched upstream bundle.
 * Contract: contracts/localization.contract.md (§11.6).
 */
export {
	ENGINE_STATUS_OVERLAY,
	FALLBACK_LOCALE,
	LOCALE_CATALOG,
	PLACEHOLDER_SOURCE,
	LocalizationRuntime,
	STATUS_MESSAGE_KEYS,
	SUPPORTED_LOCALE_CODES,
	UnsupportedLocaleError,
	createLocalizationRuntime,
	describeLocale,
	dictionaryParity,
	directionOf,
	firstPlaceholderIndex,
	firstResolvingSource,
	fromConstant,
	fromEnvironment,
	fromSettingsState,
	hasUnfilledPlaceholder,
	interpolate,
	isSupportedLocale,
	mergeOverlays,
	normalizeLocale,
	type DictionaryParityReport,
	type DictionaryPort,
	type Direction,
	type ExecutionStatus,
	type InterpolationParams,
	type LocaleDescriptor,
	type LocaleSourcePort,
	type LocalizationOptions,
	type LocalizationSnapshot,
	type SettingsStatePort,
} from './localization-runtime';
export {
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	SUPPORTED_LOCALES,
	type LocaleMetadata,
	type SupportedLocale,
} from './backend-localization-service';
export {
	API_ERROR_CODES,
	ENVELOPE_DICTIONARY_EXTENSION,
	EXECUTION_LIFECYCLE,
	EXECUTION_MESSAGE_KEYS,
	buildRunEnvelope,
	createEnvelopeRuntime,
	envelopeDictionaryParity,
	envelopeLocales,
	extensionKeys,
	localizeApiError,
	localizeNodeStatus,
	type ApiErrorCode,
	type LocalizedApiError,
	type LocalizedNodeStatusLine,
	type NodeRunResult,
	type RunEnvelope,
	type RunEnvelopeInput,
} from './localization-envelope';
export {
	PRODUCT_DICTIONARY_EXTENSION,
	RUN_MODES,
	SUMMARY_MESSAGE_KEYS,
	TRIGGER_MESSAGE_KEYS,
	catalogueOverlaps,
	createProductRuntime,
	nodeStateLabel,
	productKeys,
	runSummary,
	triggerLabel,
	withoutCatalogueOwnedKeys,
	type CatalogueOverlap,
	type RunMode,
	type RunSummaryParts,
} from './localization-vocabulary';
export {
	buildExecutionLogRecord,
	durationBetween,
	formatExecutionLogLine,
	isKnownRunMode,
	nodeLinesOf,
	relocalizeNodeLine,
	type ExecutionLogInput,
	type ExecutionLogRecord,
} from './execution-log-record';
export {
	GENERIC_ERROR_CODE,
	HINT_KEY_BY_ERROR_CODE,
	HTTP_STATUS_BY_ERROR_CODE,
	buildApiErrorResponse,
	buildApiSuccessResponse,
	buildHealthResponse,
	type ApiErrorResponse,
	type ApiErrorResponseInput,
	type ApiHealthResponse,
	type ApiSuccessResponse,
} from './api-error-response';

/** Provenance of the isolation layer itself. */
export const LEGO_PROVENANCE = {
	lego: 'workflow',
	phase: 'phase-2-isolation',
	referenceVersion: '2.9.4',
	referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	behaviorChange: 'none-detected',
	rustImplementation: 'not-started',
} as const;
