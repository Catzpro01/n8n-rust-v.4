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

/** Provenance of the isolation layer itself. */
export {
	BackendLocalizationService,
	DEFAULT_LOCALE,
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	PROTECTED_MACHINE_KEYS,
	SUPPORTED_LOCALE_CODES,
	isProtectedMachineKey,
	SUPPORTED_LOCALES,
	type LocaleInput,
	type LocaleMetadata,
	type LocaleRequestLike,
	type SupportedLocale,
	type TranslationParameters,
} from './backend-localization-service';
export {
	HUMAN_FACING_KEYS,
	UniversalLocaleEnforcer,
	createUniversalLocaleEnforcer,
	enforceLocale,
	interceptLocalizedResponse,
	type ChatSessionPayload,
	type ExecutionLogEntry,
	type LocaleEnforcerOptions,
} from './universal-locale-enforcer';
export { SettingsLocalizationAdapter, type LanguageCode, type LocalizationSettingsState } from './settings-localization-adapter';

export const LEGO_PROVENANCE = {
	lego: 'workflow',
	phase: 'phase-2-isolation',
	referenceVersion: '2.9.4',
	referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	behaviorChange: 'none-detected',
	rustImplementation: 'not-started',
} as const;
