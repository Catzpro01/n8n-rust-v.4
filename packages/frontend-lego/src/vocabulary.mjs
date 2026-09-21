/**
 * The shared vocabulary lock — one word, one meaning, on both sides of the seam.
 *
 * The frontend and the backend LEGO foundation are separate packages with separate
 * owners, and they speak about the same things: why a capability cannot serve, what
 * lifecycle it is in, what kind of version move happened, which interaction class an
 * operation is. Two dialects for those questions is exactly the failure this phase
 * exists to prevent, so this module **pins** the vocabulary the backend foundation
 * already publishes, with provenance, and refuses anything that is not in it.
 *
 * Three rules, machine-checkable:
 *
 *   1. A **shared** concept is quoted, never re-invented. `VOCABULARIES` records the
 *      contract that owns it, its version and the file the values were read from, so
 *      a reviewer can check the quote instead of trusting it.
 *   2. A **frontend-local** concept is declared as such (`mapsTo`) and, when it says
 *      something about a shared concept, it must map *totally* into it. A local word
 *      that duplicates a shared one is a conflict, not a synonym.
 *   3. An extra word is **declared with its reason** (`extra`). A vocabulary that
 *      quietly grows an undeclared term fails `vocabularyConflicts()`.
 *
 * Nothing here executes, reads disk or knows a transport. It is data plus three pure
 * functions, so an agent (or a test) can answer "is this still the same vocabulary?"
 * without reading either implementation.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** The backend foundation this lock quotes, so a drift report can say where to look. */
export const QUOTED_FROM = Object.freeze({
  repository: 'Catzpro01/n8n-rust-v.4',
  branch: 'arena/01a0c521-n8n-rust-v-4',
  commit: '6f7b66da',
  phase: 'P2.10',
  readOn: '2026-09-22',
});


/**
 * `apps/n8n-lego/src/lego/manifest/foundation.json` is read by the backend modules
 * (`foundation.mjs`, `envelope.mjs`), by two tools and by the registry itself
 * (`domains.json` -> `foundation.vocabulary`), and it is inside the public paths of the
 * manager-owned `lego-foundation` domain — but **no contract-lock row publishes it**, so
 * its vocabulary has no pinned contract version. That is not something the frontend may
 * quietly resolve: every set quoted from it carries this record, and `XA-9` in
 * `docs/n8n-lego/decisions/cross-agent-decisions.json` asks the manager to publish it.
 */
const FOUNDATION_MANIFEST_PUBLICATION = Object.freeze({
  owner: 'manager',
  domain: 'lego-foundation',
  decision: 'XA-9',
  what: 'manifest/foundation.json is declared public by the lego-foundation domain and named by domains.json -> foundation.vocabulary, but no contract-lock row publishes it, so these values have no pinned contract version',
});

/**
 * The canonical vocabularies. `values` is the complete set; `provenance` names the
 * contract (id/version/owner) and the exact declaration the values were read from
 * (`kind` + `file` + `path`/`symbol`), so a reviewer can check the quote instead of
 * trusting it. Read from the backend foundation at P2.10 (`lego.domain-registry@1.1.0`,
 * `ai.foundation@1.0.0` and the `lego.*` contracts those rows name).
 */
export const VOCABULARIES = Object.freeze([
  Object.freeze({
    id: 'degradation',
    question: 'May this capability serve a caller here, and if not, what must the consumer do instead?',
    about: 'availability',
    values: Object.freeze([
      'available',
      'degraded',
      'capability-unavailable',
      'optional-absent',
      'version-incompatible',
      'dependency-disabled',
      'migration-required',
      'feature-unsupported',
    ]),
    /** What each value instructs a consumer to do — quoted, so the frontend cannot soften it. */
    actions: Object.freeze({
      available: 'proceed',
      degraded: 'proceed with reduced guarantees; the provider declares what is reduced',
      'capability-unavailable': 'fail with lego.capability_unavailable',
      'optional-absent': 'skip the optional path; this is not an error',
      'version-incompatible': 'fail with lego.version_incompatible — never silently adapt',
      'dependency-disabled': 'fail with lego.dependency_disabled',
      'migration-required': 'fail with lego.migration_required and name the migration',
      'feature-unsupported': 'answer 501 through the compatibility layer',
    }),
    usable: Object.freeze({ available: true, degraded: true }),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.interaction', version: '1.0.0', owner: 'agent-2' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/interaction.mjs',
      symbol: 'DEGRADATION_STATES',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'lifecycle',
    question: 'What lifecycle state is this LEGO or capability in, and may it be called?',
    about: 'state',
    values: Object.freeze([
      'declared',
      'available',
      'installed',
      'loaded',
      'active',
      'idle',
      'degraded',
      'disabled',
      'failed',
      'unloaded',
      'deprecated',
    ]),
    callable: Object.freeze(['active', 'idle', 'degraded', 'deprecated']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.negotiation', version: '1.0.0', owner: 'agent-2' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/negotiation.mjs',
      symbol: 'LIFECYCLE_STATES',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'changeKind',
    question: 'What kind of move is A → B for a contract or unit version?',
    about: 'change',
    values: Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.contract-compat', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/compat.mjs',
      symbol: 'CHANGE_KINDS',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'interaction',
    question: 'What does an operation mean, independent of any transport?',
    about: 'interaction',
    values: Object.freeze(['call', 'event', 'stream', 'batch']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.interaction', version: '1.0.0', owner: 'agent-2' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/interaction.mjs',
      symbol: 'INTERACTION_CLASSES',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'capabilityStatus',
    question: 'How far has this capability been implemented?',
    about: 'implementation',
    // `contract-only` (P2.10) is deliberately distinct from `planned`: the contract is
    // fixed and gate-checked, only the implementation is missing.
    values: Object.freeze(['implemented', 'partial', 'planned', 'contract-only', 'legacy', 'unsupported', 'deferred', 'template']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/registry.mjs',
      symbol: 'DOMAIN_STATUS',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'capabilityCriticality',
    question: 'What happens to the instance when this capability is absent?',
    about: 'level',
    values: Object.freeze(['critical', 'standard', 'optional']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains[].capabilities[].criticality',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'capabilityMigrationState',
    question: 'Where is this capability in its strangler/migration journey?',
    about: 'migration',
    values: Object.freeze(['stable', 'not-started', 'strangler-pending']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains[].capabilities[].migrationState',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'capabilityReplacement',
    question: 'What kind of replacement may this capability undergo?',
    about: 'replacement',
    values: Object.freeze(['contract-preserving']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains[].capabilities[].replacement',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'trustLevel',
    question: 'How far may this code be trusted, and what may it reach?',
    about: 'trust',
    values: Object.freeze(['core', 'verified', 'community', 'untrusted']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'trust.levels',
      read: 'keys',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'transportKind',
    question: 'How do bytes move between two parties?',
    about: 'transport',
    values: Object.freeze(['in-process', 'worker', 'remote', 'mcp']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'transportRouting.kinds',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'transportTarget',
    question: 'Where may the same logical contract be bound, without changing it?',
    about: 'transport',
    values: Object.freeze(['in-process-js', 'in-process-rust', 'wasm', 'worker', 'remote-api']),
    provenance: Object.freeze({
      // No lock row yet: quoted from the foundation manifest, publication pending.
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'transport.targets',
      read: 'values',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),

  /* ------------------------------------------------------------ the AI foundation */

  Object.freeze({
    id: 'aiKind',
    question: 'What kind of thing is this — a provider or a runtime?',
    about: 'kind',
    values: Object.freeze(['model-provider', 'tool-provider', 'application-provider', 'agent-runtime', 'simulation-runtime']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'providerKinds',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'runtimeLocality',
    question: 'Where does this runtime execute, relative to the caller?',
    about: 'transport',
    values: Object.freeze(['in-process', 'local-process', 'local-network', 'remote']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentRuntime.runtimeMetadata.locality',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentSessionState',
    question: 'What state is an agent session in?',
    about: 'state',
    values: Object.freeze(['created', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentSession.states',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentEventType',
    question: 'What happened in an agent run?',
    about: 'event',
    values: Object.freeze([
      'agent.created', 'agent.started', 'agent.waiting', 'agent.paused', 'agent.resumed',
      'agent.delegated', 'agent.completed', 'agent.failed', 'agent.cancelled',
      'context.loaded', 'context.compacted',
      'tool.requested', 'tool.started', 'tool.completed', 'tool.failed',
      'decision.created', 'decision.approved', 'decision.rejected',
      'approval.requested', 'approval.granted', 'approval.denied',
      'artifact.created', 'artifact.updated',
      'runtime.connected', 'runtime.disconnected', 'runtime.unavailable',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'events.types',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentEventEnvelopeField',
    question: 'Which fields does an agent event carry?',
    about: 'field',
    values: Object.freeze([
      'eventId', 'timestamp', 'type', 'sessionId', 'scope',
      'agentId', 'parentId', 'taskId', 'status', 'durationMs', 'summary', 'references',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'events.envelope.required+optional',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentSessionField',
    question: 'What identifies an agent session?',
    about: 'field',
    values: Object.freeze(['sessionId', 'agentId', 'parentSessionId', 'taskId', 'workflowId', 'executionId', 'runtimeId', 'status', 'createdAt', 'updatedAt']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentSession.fields',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'delegationField',
    question: 'What does a delegation edge carry?',
    about: 'field',
    values: Object.freeze(['delegationId', 'parentSessionId', 'childSessionId', 'task', 'grantedCapabilities', 'budget', 'deadline', 'status']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'delegation.fields',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'delegationBudgetField',
    question: 'What may a delegated child spend?',
    about: 'field',
    values: Object.freeze(['maxTokens', 'maxToolCalls', 'maxDurationMs', 'maxChildren']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'delegation.budget.fields',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'contextScope',
    question: 'How wide is the context an agent loaded?',
    about: 'scope',
    values: Object.freeze(['GLOBAL', 'WORKFLOW', 'NODE', 'EXECUTION', 'EVENT', 'AGENT', 'TASK']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'context.scopes',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'decisionRisk',
    question: 'How risky is the decision an agent made?',
    about: 'level',
    values: Object.freeze(['low', 'medium', 'high', 'critical']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'decision.risk',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'decisionApprovalState',
    question: 'Does this decision need approval, and did it get one?',
    about: 'approval',
    values: Object.freeze(['not-required', 'pending', 'granted', 'denied']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'decision.approvalState',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'approvalDecision',
    question: 'How did a human answer an approval request?',
    about: 'approval',
    values: Object.freeze(['granted', 'denied', 'expired']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'approval.decision',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'toolSideEffect',
    question: 'What does calling this tool do to the world?',
    about: 'side-effect',
    values: Object.freeze(['read-only', 'writes', 'destructive', 'external']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/ai-foundation.mjs',
      symbol: 'TOOL_SIDE_EFFECTS',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'artifactKind',
    question: 'What kind of artifact did something produce?',
    about: 'artifact',
    values: Object.freeze(['patch', 'diff', 'log', 'report', 'screenshot', 'file', 'model-output', 'simulation-result']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'artifact.kinds',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'artifactRetention',
    question: 'How long may this artifact be kept?',
    about: 'retention',
    values: Object.freeze(['ephemeral', 'session', 'retained', 'pinned']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'artifact.retention',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'resourceDimension',
    question: 'Which resources may a capability or runtime declare?',
    about: 'field',
    values: Object.freeze(['cpu', 'memory', 'disk', 'network', 'latency', 'locality', 'startupCost', 'estimatedCost', 'availability']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'resourceProfiles.dimensions',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'resourceProfile',
    question: 'Which resource class does this workload belong to?',
    about: 'level',
    values: Object.freeze(['low-resource', 'standard', 'high-resource', 'remote']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'resourceProfiles.profiles',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'aiResourceField',
    question: 'Which fields may a declared resource requirement carry?',
    about: 'field',
    values: Object.freeze(['cpu', 'memory', 'disk', 'network', 'concurrency', 'startup']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'resources.fields',
      read: 'values',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'deviceProfileField',
    question: 'Which facts describe a device class?',
    about: 'field',
    values: Object.freeze(['cpuCores', 'memoryMb', 'diskMb', 'os', 'arch', 'gpu', 'network']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'deviceProfile.fields',
      read: 'values',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'deviceClass',
    question: 'Which machine classes exist?',
    about: 'device',
    values: Object.freeze(['android-termux', 'low-end-vps', 'laptop', 'server']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'deviceProfile.classes',
      read: 'keys',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'mcpConcept',
    question: 'Which MCP concepts exist, at the edge only?',
    about: 'mcp',
    values: Object.freeze(['server', 'client', 'tool', 'resource', 'prompt', 'connection', 'authorization', 'capability']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'mcp.concepts',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'zeroInstallLayerState',
    question: 'What state is one installation layer in?',
    about: 'state',
    values: Object.freeze(['ready', 'not-configured']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'zeroInstall.state',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'zeroInstallLayer',
    question: 'Which layers does a zero-install report name?',
    about: 'layer',
    values: Object.freeze(['aiFoundation', 'modelProvider', 'toolProvider', 'agentRuntime']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'zeroInstall.state',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'aiFoundationCapability',
    question: 'Which capability contracts does the AI Foundation publish?',
    about: 'capability-kind',
    values: Object.freeze([
      'ai.model-gateway', 'ai.tool-gateway', 'ai.agent-runtime', 'ai.application-provider',
      'ai.agent-session', 'ai.agent-delegation', 'ai.agent-events', 'ai.decision',
      'ai.approval', 'ai.artifact', 'ai.context',
      // Added by backend P2.12. `ai.skill` is the only one of these whose status
      // is `implemented` — the skill registry. The rest remain contract-only.
      'ai.skill',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities',
      read: 'id',
    }),
  }),
  Object.freeze({
    id: 'aiPermission',
    question: 'Which permission names do the published AI operations require?',
    about: 'permission',
    // The 22 names the eleven `ai.*` capabilities publish on their operations. The
    // vocabulary file names only the three provider contracts' permissions (eight of
    // these) plus the application-provider trio below; the operation list is what a
    // caller is actually refused by, so that is what the frontend quotes.
    values: Object.freeze([
      'ai:model:read', 'ai:model:invoke',
      'ai:tool:read', 'ai:tool:invoke',
      'ai:agent:create', 'ai:agent:invoke', 'ai:agent:control', 'ai:agent:read', 'ai:agent:delegate',
      'ai:app:read', 'ai:app:invoke',
      'ai:event:read', 'ai:event:write',
      'ai:decision:read', 'ai:decision:write',
      'ai:approval:request', 'ai:approval:resolve', 'ai:approval:read',
      'ai:artifact:read', 'ai:artifact:write',
      'ai:context:read', 'ai:context:write',
      // Backend P2.12, the skill registry. Both are read-shaped: there is
      // deliberately no `ai:skill:execute`, because execution is not a skill
      // operation and no permission may imply that it is.
      'ai:skill:read', 'ai:skill:select',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities[].operations[].permission',
      read: 'unique',
      note: 'the `ai.foundation` vocabulary publishes eight of these for the three provider contracts; the remaining operation permissions exist only here — see XA-10',
    }),
  }),
  Object.freeze({
    id: 'applicationPermission',
    question: 'Which permissions does an application provider publish for its application capabilities?',
    values: Object.freeze(['app:github:read', 'app:github:write', 'app:github:receive']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'applicationProvider.exampleCapabilities.capabilities[].permission',
      read: 'unique',
      note: '`exampleCapabilities` is illustrative (no GitHub client exists) but it is the only place the application-provider permission names are declared — XA-10 records that the registry publishes `ai:app:*` for the same capability instead',
    }),
  }),
  Object.freeze({
    id: 'surfaceAliasKind',
    question: 'What kind of thing does a surface alias point at?',
    about: 'alias-kind',
    values: Object.freeze(['domain']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'surfaceAliases.aliases[].kind',
      read: 'unique',
    }),
  }),
]);

/**
 * Concepts the frontend owns. `mapsTo` names the canonical vocabulary they speak
 * about, `extra` declares any value that canonical set does not have (with the reason
 * it exists), and `mirror` declares the total mapping so a reviewer can see that a
 * local word is not a competing meaning.
 *
 * The frontend keeps three kinds of local word, on purpose:
 *
 *   1. **Words that ride a pinned browser contract.** Renaming `unitStatus` or
 *      `unitCriticality` would change the 18,126-byte boot payload for a naming reason
 *      (`test/16`), so they are *mapped* instead;
 *   2. **Words that name a UI fact the foundation does not model** (an input modality,
 *      a battery, a gateway's mechanism name) — each carries the reason it exists;
 *   3. **Words the frontend must not rename yet** because the backend publishes a
 *      different spelling for the same concept. Those are recorded for arbitration in
 *      `docs/n8n-lego/decisions/cross-agent-decisions.json` (XA-8, XA-9) and mapped
 *      here, never silently renamed.
 */
export const LOCAL_VOCABULARIES = Object.freeze([
  Object.freeze({
    id: 'surfaceStatus',
    question: 'How ready is this UI surface?',
    values: Object.freeze(['present', 'partial', 'unsupported']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/surfaces.json', symbol: 'surfaces[].status' }),
    why: 'A surface is a UI area, not a capability: the backend has no counterpart to be right or wrong about.',
  }),
  Object.freeze({
    id: 'unitStatus',
    question: 'How far has this nested unit been implemented?',
    values: Object.freeze(['declared', 'available', 'partial', 'unsupported']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({
        value: 'declared',
        reason: 'the unit declares its contract and its tests before its code — canonical `contract-only`; the spelling travels in the boot payload pinned to the P2.5 baseline, so it is mapped rather than renamed',
      }),
      Object.freeze({
        value: 'available',
        reason: 'an implementation exists for the unit — canonical `implemented`; mapped for the same pinned-payload reason',
      }),
    ]),
    mirror: Object.freeze({ declared: 'contract-only', available: 'implemented', partial: 'partial', unsupported: 'unsupported' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/sub-legos.json', symbol: 'subLegos[].status' }),
  }),
  Object.freeze({
    id: 'instanceImplementation',
    question: 'How much of this capability does THIS instance implement?',
    values: Object.freeze(['implemented', 'partial', 'unsupported', 'unknown']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({
        value: 'unknown',
        reason: 'the app handed over no usable status; the frontend reports that instead of guessing "implemented"',
      }),
    ]),
    mirror: Object.freeze({ implemented: 'implemented', partial: 'partial', unsupported: 'unsupported', unknown: null }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/backend-view.mjs', symbol: 'BACKEND_STATES' }),
  }),
  Object.freeze({
    id: 'frontendCapabilityDeclaration',
    question: 'What has this frontend declared about a capability of its own?',
    values: Object.freeze(['declared', 'available', 'partial', 'unsupported']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({ value: 'declared', reason: 'a catalog entry with a fixed contract and tests but no implementation: canonical `contract-only`' }),
      Object.freeze({ value: 'available', reason: 'the capability is offered here: canonical `implemented`' }),
    ]),
    mirror: Object.freeze({ declared: 'contract-only', available: 'implemented', partial: 'partial', unsupported: 'unsupported' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/registry.mjs', symbol: 'CAPABILITY_STATUSES' }),
  }),
  Object.freeze({
    id: 'capabilityLifecycle',
    question: 'Which lifecycle states does the frontend capability registry use?',
    values: Object.freeze(['available', 'installed', 'loaded', 'active', 'idle', 'unloaded', 'disabled']),
    mapsTo: 'lifecycle',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      available: 'declared',
      installed: 'installed',
      loaded: 'loaded',
      active: 'active',
      idle: 'idle',
      unloaded: 'unloaded',
      disabled: 'disabled',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'CAPABILITY_STATES' }),
    why: 'Seven of the eleven canonical lifecycle states; `available` here means "in the catalog, nothing resolved", which the canonical vocabulary calls `declared`. Four canonical states (failed, degraded, deprecated and the one the frontend never reaches) are unused rather than renamed.',
  }),
  Object.freeze({
    id: 'unitCriticality',
    question: 'How critical is this UI unit or capability to the instance?',
    values: Object.freeze(['core', 'optional', 'enhancement']),
    mapsTo: 'capabilityCriticality',
    extra: Object.freeze([]),
    mirror: Object.freeze({ core: 'critical', optional: 'standard', enhancement: 'optional' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'CRITICALITY' }),
    why: 'The same question the backend answers with critical/standard/optional. The mapping is declared (core = failure breaks the instance, optional = absence has a declared fallback, enhancement = absence needs no notice) and the rename is recorded for arbitration rather than performed silently.',
  }),
  Object.freeze({
    id: 'unitTrust',
    question: 'How far may this frontend unit be trusted?',
    values: Object.freeze(['core', 'feature', 'extension', 'untrusted']),
    mapsTo: 'trustLevel',
    extra: Object.freeze([]),
    mirror: Object.freeze({ core: 'core', feature: 'core', extension: 'community', untrusted: 'untrusted' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'TRUST_LEVELS' }),
    why: '`core` and `feature` are both first-party code, so both map to canonical `core`; `extension` is third-party and unreviewed, which the canonical set calls `community`. Canonical `verified` is unused: no frontend unit has been through a signed review.',
  }),
  Object.freeze({
    id: 'deviceProfile',
    question: 'Which device budget is this UI rendering into?',
    values: Object.freeze(['desktop', 'laptop', 'low-memory', 'android', 'termux-companion', 'remote-only']),
    mapsTo: 'resourceProfile',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      desktop: 'high-resource',
      laptop: 'standard',
      'low-memory': 'low-resource',
      android: 'low-resource',
      'termux-companion': 'low-resource',
      'remote-only': 'remote',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/profiles.mjs', symbol: 'DEVICE_PROFILES' }),
    why: 'A device profile is a browser budget; the canonical resource profiles are machine classes. The mapping is declared so a runtime that declares `low-resource` can be matched to the profiles that can host it.',
  }),
  Object.freeze({
    id: 'budgetField',
    question: 'Which budget facts may a profile or a requirement declare here?',
    values: Object.freeze(['memoryMb', 'storageMb', 'cpuCores', 'input', 'alwaysOnline', 'meteredNetwork', 'onBattery', 'latencyBudgetMs', 'executionModel']),
    mapsTo: 'resourceDimension',
    extra: Object.freeze([
      Object.freeze({ value: 'input', reason: 'a browser budget has an input modality (pointer or touch); a machine dimension list has no counterpart' }),
      Object.freeze({ value: 'onBattery', reason: 'battery presence is a device fact the foundation does not model, and the reason a battery-heavy runtime is placed remotely' }),
    ]),
    mirror: Object.freeze({
      memoryMb: 'memory',
      storageMb: 'disk',
      cpuCores: 'cpu',
      input: null,
      alwaysOnline: 'network',
      meteredNetwork: 'network',
      onBattery: null,
      latencyBudgetMs: 'latency',
      executionModel: 'locality',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/profiles.mjs', symbol: 'BUDGET_FIELDS' }),
  }),
  Object.freeze({
    id: 'gatewayTransport',
    question: 'Which carrier does the frontend gateway have available?',
    values: Object.freeze(['local', 'rest', 'event', 'stream', 'ipc', 'remote']),
    mapsTo: 'transportKind',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      local: 'in-process',
      rest: 'remote',
      event: 'in-process',
      stream: 'in-process',
      ipc: 'worker',
      remote: 'remote',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/transport.mjs', symbol: 'TRANSPORT_KINDS' }),
    why: 'The gateway names the mechanism it implements (`local:direct`, an event dispatcher, a REST client); the canonical vocabulary names the kind. `event` and `stream` are in-process carriers of those interaction classes, not separate kinds.',
  }),
  Object.freeze({
    id: 'traceField',
    question: 'Which fields may a work-trace row carry?',
    values: Object.freeze([
      'sequence', 'eventId', 'timestamp', 'type', 'scope', 'sessionId', 'agentId', 'parentId',
      'taskId', 'executionId', 'runtimeId', 'capability', 'operation', 'status', 'durationMs',
      'summary', 'payloadRef', 'artifactRef', 'decisionRef', 'approvalState',
    ]),
    mapsTo: 'agentEventEnvelopeField',
    extra: Object.freeze([
      Object.freeze({ value: 'sequence', reason: 'a trace is ordered deterministically by (timestamp, sequence); the wire envelope carries no order' }),
      Object.freeze({ value: 'executionId', reason: 'a UI needs to anchor a row to the execution it observed' }),
      Object.freeze({ value: 'runtimeId', reason: 'a UI must be able to say which runtime produced a row' }),
      Object.freeze({ value: 'capability', reason: 'a boundary row names the capability it belongs to' }),
      Object.freeze({ value: 'operation', reason: 'a boundary row names the operation it belongs to' }),
      Object.freeze({ value: 'approvalState', reason: 'a trace records the gate; the canonical words come from decisionApprovalState' }),
    ]),
    mirror: Object.freeze({
      sequence: null,
      eventId: 'eventId',
      timestamp: 'timestamp',
      type: 'type',
      scope: 'scope',
      sessionId: 'sessionId',
      agentId: 'agentId',
      parentId: 'parentId',
      taskId: 'taskId',
      executionId: null,
      runtimeId: null,
      capability: null,
      operation: null,
      status: 'status',
      durationMs: 'durationMs',
      summary: 'summary',
      payloadRef: 'references',
      artifactRef: 'references',
      decisionRef: 'references',
      approvalState: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agent-events.mjs', symbol: 'TRACE_FIELDS' }),
    why: 'A trace row is the UI projection of an event: the envelope fields keep their canonical names, the three reference fields resolve the envelope\'s `references` map into named slots, and the extras are named UI needs rather than second meanings.',
  }),
  Object.freeze({
    id: 'delegationNodeField',
    question: 'Which fields does a delegation-tree node carry?',
    values: Object.freeze(['agentId', 'parentId', 'sessionId', 'taskId', 'runtimeId', 'status', 'depth', 'children', 'grantedCapabilities', 'effectivePermissions']),
    mapsTo: 'delegationField',
    extra: Object.freeze([
      Object.freeze({ value: 'agentId', reason: 'the UI identifies a node by the agent that ran it' }),
      Object.freeze({ value: 'runtimeId', reason: 'the UI must be able to say which runtime ran the child' }),
      Object.freeze({ value: 'depth', reason: 'nesting depth is derived from parentage for display' }),
      Object.freeze({ value: 'children', reason: 'the tree shape, derived; the edge itself carries parentSessionId/childSessionId' }),
      Object.freeze({ value: 'effectivePermissions', reason: 'what the child actually holds — equal to its own grants, never the parent\'s' }),
    ]),
    mirror: Object.freeze({
      agentId: null,
      parentId: 'parentSessionId',
      sessionId: 'childSessionId',
      taskId: 'task',
      runtimeId: null,
      status: 'status',
      depth: null,
      children: null,
      grantedCapabilities: 'grantedCapabilities',
      effectivePermissions: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agent-events.mjs', symbol: 'DELEGATION_FIELDS' }),
  }),
  Object.freeze({
    id: 'mcpConnectionState',
    question: 'What does the UI show for one MCP relationship?',
    values: Object.freeze(['connected', 'unavailable', 'permission-required', 'capability-unsupported']),
    mapsTo: 'degradation',
    extra: Object.freeze([
      Object.freeze({ value: 'permission-required', reason: 'the caller may be allowed to do this: a grantable state the degradation vocabulary does not name (it mirrors operationOutcome.permission-missing)' }),
    ]),
    mirror: Object.freeze({
      connected: 'available',
      unavailable: 'capability-unavailable',
      'permission-required': null,
      'capability-unsupported': 'feature-unsupported',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'MCP_CONNECTION_STATES' }),
  }),
  Object.freeze({
    id: 'installationLayer',
    question: 'Which layers does the frontend report separately?',
    values: Object.freeze(['core', 'aiFoundation', 'inference', 'modelProvider', 'toolGateway', 'agentRuntime', 'simulationRuntime', 'mcp']),
    mapsTo: 'zeroInstallLayer',
    extra: Object.freeze([
      Object.freeze({ value: 'core', reason: 'the editor itself — the foundation does not model it as an AI layer, the UI must not hide it' }),
      Object.freeze({ value: 'inference', reason: 'whether a model can be reached at all; the foundation expresses this through modelProvider, the UI reports the consequence' }),
      Object.freeze({ value: 'simulationRuntime', reason: 'a simulation runtime is declared separately from a real one so a simulation can never read as real work' }),
      Object.freeze({ value: 'mcp', reason: 'the interop layer has its own state; folding it into toolGateway would hide an unconfigured adapter' }),
    ]),
    mirror: Object.freeze({
      core: null,
      aiFoundation: 'aiFoundation',
      inference: null,
      modelProvider: 'modelProvider',
      toolGateway: 'toolProvider',
      agentRuntime: 'agentRuntime',
      simulationRuntime: null,
      mcp: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'INSTALLATION_LAYERS' }),
  }),
  Object.freeze({
    id: 'aiKindRole',
    question: 'Does this canonical kind provide or execute?',
    values: Object.freeze(['provider', 'runtime']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'AI_KIND_ROLES' }),
    why: 'A label over the five canonical kinds, not a sixth word: model-provider, tool-provider and application-provider are providers; agent-runtime and simulation-runtime execute.',
  }),
  Object.freeze({
    id: 'versionFit',
    question: 'Does what a provider offers satisfy what a consumer requires?',
    values: Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade', 'invalid']),
    mapsTo: 'changeKind',
    extra: Object.freeze([
      Object.freeze({ value: 'invalid', reason: 'the two values are not versions, so no question about a change can be answered — the frontend reports that instead of a false compatibility' }),
    ]),
    mirror: Object.freeze({ unchanged: 'unchanged', compatible: 'compatible', 'migration-required': 'migration-required', breaking: 'breaking', downgrade: 'downgrade', invalid: null }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/versions.mjs', symbol: 'COMPATIBILITY' }),
  }),
  Object.freeze({
    id: 'providerKind',
    question: 'Which provider kinds may a provider declaration use here?',
    // Not a view and not a rename: these are the manager's `ai.foundation` provider-kind
    // words, three of the five canonical kinds. Nothing in the boot payload depends on
    // the spelling, so the frontend speaks the canonical words directly.
    values: Object.freeze(['model-provider', 'tool-provider', 'application-provider']),
    mapsTo: 'aiKind',
    extra: Object.freeze([]),
    mirror: Object.freeze({ 'model-provider': 'model-provider', 'tool-provider': 'tool-provider', 'application-provider': 'application-provider' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'PROVIDER_KINDS' }),
    why: 'The canonical set also names the two runtime kinds; a provider declaration must not use them, which is exactly why a declaration carries a kind and a runtime carries a kind from runtimeKind.',
  }),
  Object.freeze({
    id: 'runtimeKind',
    question: 'Which runtime kinds may a runtime declaration use here?',
    values: Object.freeze(['agent-runtime', 'simulation-runtime']),
    mapsTo: 'aiKind',
    extra: Object.freeze([]),
    mirror: Object.freeze({ 'agent-runtime': 'agent-runtime', 'simulation-runtime': 'simulation-runtime' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'RUNTIME_KINDS' }),
    why: 'A simulation runtime is never the same object as a real one, so the two canonical runtime kinds are declared here together and never merged.',
  }),
  Object.freeze({
    id: 'runtimeLocalityView',
    question: 'Where does the UI say an agent runtime runs?',
    values: Object.freeze(['local', 'remote']),
    mapsTo: 'runtimeLocality',
    extra: Object.freeze([
      Object.freeze({
        value: 'local',
        reason: 'the UI asks one question — does this run here or elsewhere — so it collapses the three canonical local localities (in-process, local-process, local-network) into one word; the canonical word travels with the runtime declaration and is shown verbatim when the user asks where it runs',
      }),
    ]),
    mirror: Object.freeze({ local: null, remote: 'remote' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'RUNTIME_LOCALITY' }),
  }),
  Object.freeze({
    id: 'mcpObjectView',
    question: 'Which MCP objects may the UI represent?',
    values: Object.freeze(['client-capability', 'server-capability', 'tool', 'resource', 'prompt', 'connection', 'authorization', 'availability']),
    mapsTo: 'mcpConcept',
    extra: Object.freeze([
      Object.freeze({
        value: 'availability',
        reason: 'not an MCP object: the state the UI renders for a relationship, whose words come from mcpConnectionState',
      }),
    ]),
    mirror: Object.freeze({
      'client-capability': 'client',
      'server-capability': 'server',
      tool: 'tool',
      resource: 'resource',
      prompt: 'prompt',
      connection: 'connection',
      authorization: 'authorization',
      availability: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'MCP_OBJECTS' }),
    why: 'The canonical set names the protocol objects; the UI names what it shows — a capability in the client role and a capability in the server role, never the whole registry.',
  }),
  Object.freeze({
    id: 'frontendCapabilityPermission',
    question: 'Which permission does a frontend capability declare for itself?',
    // Exactly the six words the seven frontend capabilities declare today. Four of them
    // name the same grant as a published `ai:*` permission; the other two name a
    // workflow/execution grant whose domain publishes no permission names at all yet, so
    // they map to nothing and carry the reason — plus XA-8, which asks the manager which
    // namespace should win.
    values: Object.freeze([
      'inference:invoke',
      'workflow:write',
      'agent:delegate',
      'agent:run',
      'agent:observe',
      'execution:escalate',
    ]),
    mapsTo: 'aiPermission',
    extra: Object.freeze([
      Object.freeze({
        value: 'workflow:write',
        reason: 'a workflow-domain grant; no backend contract publishes workflow permission names yet, so there is nothing to map it to (XA-8)',
      }),
      Object.freeze({
        value: 'execution:escalate',
        reason: 'the execution-side effect of handing a run to an agent; the execution domain publishes no permission names yet (XA-8)',
      }),
    ]),
    mirror: Object.freeze({
      'inference:invoke': 'ai:model:invoke',
      'workflow:write': null,
      'agent:delegate': 'ai:agent:delegate',
      'agent:run': 'ai:agent:invoke',
      'agent:observe': 'ai:agent:read',
      'execution:escalate': null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/capabilities.json', symbol: 'capabilities[].permissions' }),
  }),
  Object.freeze({
    id: 'operationOutcome',
    question: 'Can this operation be executed, and if not, why not?',
    values: Object.freeze([
      'available',
      'degraded',
      'capability-unavailable',
      'optional-absent',
      'version-incompatible',
      'dependency-disabled',
      'migration-required',
      'feature-unsupported',
      'operation-denied',
      'operation-unpublished',
      'permission-missing',
      'permission-unknown',
    ]),
    mapsTo: 'degradation',
    extra: Object.freeze([
      Object.freeze({ value: 'operation-denied', reason: 'the caller is not granted the capability on its surface, so it is refused at the operation level without learning anything about the capability — placement never grants an operation' }),
      Object.freeze({ value: 'operation-unpublished', reason: 'the provider publishes no operation list, so the frontend cannot verify that the operation exists: fail closed rather than assume' }),
      Object.freeze({ value: 'permission-missing', reason: 'the capability declares a required permission the caller does not hold' }),
      Object.freeze({ value: 'permission-unknown', reason: 'the caller requires a permission the capability never declared' }),
    ]),
    /** The first eight are the canonical degradation states verbatim; the last four answer a question canonical degradation does not ask. */
    mirror: Object.freeze({
      available: 'available',
      degraded: 'degraded',
      'capability-unavailable': 'capability-unavailable',
      'optional-absent': 'optional-absent',
      'version-incompatible': 'version-incompatible',
      'dependency-disabled': 'dependency-disabled',
      'migration-required': 'migration-required',
      'feature-unsupported': 'feature-unsupported',
      'operation-denied': null,
      'operation-unpublished': null,
      'permission-missing': null,
      'permission-unknown': null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/negotiation.mjs', symbol: 'OPERATION_STATES' }),
  }),
]);

const BY_ID = new Map([...VOCABULARIES, ...LOCAL_VOCABULARIES].map((set) => [set.id, set]));

export class VocabularyError extends Error {
  constructor(message, { vocabulary = null, value = null } = {}) {
    super(message);
    this.name = 'VocabularyError';
    this.code = 'frontend.vocabulary.unknown-term';
    this.vocabulary = vocabulary;
    this.value = value;
  }
}

/** A vocabulary set by id, or null. */
export function vocabularyOf(id) {
  return BY_ID.get(id) ?? null;
}

/** Is `value` one of the declared terms of `id`? Fail-closed for an unknown set id. */
export function isDeclaredTerm(id, value) {
  const set = BY_ID.get(id);
  if (!set) throw new VocabularyError(`"${id}" is not a declared vocabulary`, { vocabulary: id, value });
  return set.values.includes(value);
}

/** `assertVocabulary`, as a throw: an undeclared term is never a synonym for a declared one. */
export function assertTerm(id, value) {
  if (!isDeclaredTerm(id, value)) {
    const set = BY_ID.get(id);
    throw new VocabularyError(`"${value}" is not a declared ${id} (one of ${set.values.join(', ')})`, { vocabulary: id, value });
  }
  return value;
}

/**
 * Compares an observed vocabulary (values read from a live module, a manifest or a
 * provider declaration) against the lock.
 *
 * @returns {{ id: string, ok: boolean, missing: string[], extra: string[], detail: string }}
 */
export function compareVocabulary(id, observed) {
  const set = BY_ID.get(id);
  if (!set) {
    return Object.freeze({ id, ok: false, missing: [], extra: [], detail: `"${id}" is not a declared vocabulary` });
  }
  const seen = new Set(observed ?? []);
  const missing = set.values.filter((value) => !seen.has(value));
  const extra = [...seen].filter((value) => !set.values.includes(value)).sort();
  return Object.freeze({
    id,
    ok: missing.length === 0 && extra.length === 0,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    detail: missing.length === 0 && extra.length === 0
      ? `${set.values.length} terms match`
      : `missing: [${missing.join(', ')}]; undeclared: [${extra.join(', ')}]`,
  });
}

/**
 * A drift report over several vocabularies at once, e.g. everything read from the
 * backend foundation in one pass. Unknown ids are reported, never skipped: a
 * comparison that silently checks nothing is worse than no comparison.
 */
export function vocabularyDrift(observed = {}) {
  const reports = Object.keys(observed)
    .sort()
    .map((id) => compareVocabulary(id, observed[id]));
  return Object.freeze({
    ok: reports.every((report) => report.ok),
    reports: Object.freeze(reports),
    summary: reports.map((report) => `${report.id}: ${report.ok ? 'ok' : report.detail}`).join('; '),
  });
}

/**
 * Self-audit of the lock itself — the check that keeps a vocabulary from quietly
 * growing a second meaning.
 *
 * * classes of conflict: a local set that names a canonical vocabulary must map every
 *   value into it, and every value it adds must be declared with a reason;
 * * a value may not appear in two canonical vocabularies with different meanings
 *   unless the overlap is intentional and declared (`sharedTerms`).
 */
/**
 * The overlaps that ARE declared, with the reason each one is not drift: two subjects
 * that quote the same word from the backend and mean it differently must be named
 * here, or `vocabularyConflicts()` reports them.
 *
 * A vocabulary may also declare its **subject** (`about`): two sets about the same
 * subject that share a spelling are the same word about the same thing — `sessionId`
 * is one field whether it appears in an event envelope or a session record, and `high`
 * is one amount whether it describes risk or a resource class. Sharing across
 * *different* subjects is what needs the declaration below.
 */
export const DECLARED_OVERLAPS = Object.freeze([
  Object.freeze({
    vocabularies: Object.freeze(['degradation', 'lifecycle']),
    values: Object.freeze({
      available: 'a lifecycle state here, an availability there — both quoted from lego.negotiation/lego.interaction, neither re-defined',
      degraded: 'the same word for the same fact from two angles: a unit is degraded because a capability it needs is degraded',
      'migration-required': 'a version move here, an availability there; the availability is the version move seen by a caller',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['deviceClass', 'mcpConcept']),
    values: Object.freeze({
      server: 'a machine class on one side, the server role of an MCP relationship on the other — deliberately declared, because the two must never be mixed',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['changeKind', 'degradation']),
    values: Object.freeze({
      'migration-required': 'a change kind here (the version move A -> B), an availability there (what that move means to a caller); one fact, two angles, both quoted',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['resourceProfile', 'runtimeLocality']),
    values: Object.freeze({
      remote: 'a resource class satisfied off this machine, and the locality of the runtime that satisfies it — the class is a consequence of the locality',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['resourceProfile', 'transportKind']),
    values: Object.freeze({
      remote: 'a resource class that is satisfied elsewhere, and a transport kind that moves bytes over a link; the remote resource class implies the remote transport, not the reverse',
    }),
  }),
]);

/**
 * Self-audit of the lock itself — the check that keeps a vocabulary from quietly
 * growing a second meaning.
 *
 * * a local set that names a canonical vocabulary must map every value into it, and
 *   every value that maps to *nothing* must be declared with a reason;
 * * a value may not appear in two canonical vocabularies unless the two share a
 *   declared subject (`about`) or the overlap is declared with its reason.
 */
export function vocabularyConflicts({ sharedTerms = DECLARED_OVERLAPS } = {}) {
  const conflicts = [];

  for (const set of LOCAL_VOCABULARIES) {
    if (set.mapsTo === null) {
      if (set.extra !== undefined && set.extra.length > 0) {
        conflicts.push(`${set.id} declares extra values but maps to no canonical vocabulary`);
      }
      continue;
    }
    const canonical = BY_ID.get(set.mapsTo);
    if (!canonical) {
      conflicts.push(`${set.id} maps to unknown vocabulary "${set.mapsTo}"`);
      continue;
    }
    const mirrored = new Set(Object.keys(set.mirror ?? {}));
    for (const value of set.values) {
      if (!mirrored.has(value)) conflicts.push(`${set.id} value "${value}" has no declared mapping into ${set.mapsTo}`);
      const target = set.mirror?.[value] ?? null;
      if (target !== null && !canonical.values.includes(target)) {
        conflicts.push(`${set.id} maps "${value}" to "${target}", which ${set.mapsTo} does not declare`);
      }
    }
    for (const [value, target] of Object.entries(set.mirror ?? {})) {
      const needsReason = target === null;
      const declared = (set.extra ?? []).find((entry) => entry.value === value);
      if (needsReason && !declared) {
        conflicts.push(`${set.id} value "${value}" maps to no ${set.mapsTo} term and carries no declared reason`);
      }
    }
    for (const declared of set.extra ?? []) {
      if (!set.values.includes(declared.value)) {
        conflicts.push(`${set.id} declares a reason for "${declared.value}", which is not one of its values`);
      }
    }
  }

  const declared = (a, b, value) => sharedTerms.some((entry) => {
    const [left, right] = entry.vocabularies;
    return (left === a && right === b) || (left === b && right === a) ? value in entry.values : false;
  });

  for (const set of VOCABULARIES) {
    for (const other of VOCABULARIES) {
      if (set.id >= other.id) continue;
      const sameSubject = set.about !== undefined && set.about === other.about;
      if (sameSubject) continue;
      const overlap = set.values.filter((value) => other.values.includes(value));
      for (const value of overlap) {
        if (!declared(set.id, other.id, value)) {
          conflicts.push(`"${value}" is declared by both ${set.id} and ${other.id} without a declared overlap`);
        }
      }
    }
  }

  return Object.freeze({
    ok: conflicts.length === 0,
    conflicts: Object.freeze(conflicts),
    checked: VOCABULARIES.length + LOCAL_VOCABULARIES.length,
    declaredOverlaps: sharedTerms.length,
  });
}

/**
 * Capability identity, normalised once and explicitly.
 *
 * A capability id is `<domain>.<name>` in lower kebab case — the same grammar the
 * operation names use. Normalisation is *not* a reformatting service: it lowercases
 * and trims only, and anything else is refused, so two spellings can never both be
 * "the" capability. Whether two ids collide is a separate question (`detectCollisions`).
 */
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function normaliseCapabilityId(value) {
  if (typeof value !== 'string') {
    throw new VocabularyError(`a capability id must be a string, got ${typeof value}`, { vocabulary: 'capabilityId', value });
  }
  const trimmed = value.trim().toLowerCase();
  if (!CAPABILITY_ID_PATTERN.test(trimmed)) {
    throw new VocabularyError(`"${value}" is not a capability id (expected <domain>.<name> in lower kebab case)`, { vocabulary: 'capabilityId', value });
  }
  return trimmed;
}

/**
 * Where a name is used twice, with the origins kept apart.
 *
 * A frontend capability and a backend-advertised capability that share an id are not
 * synonyms: the frontend reports the collision and both origins, and never merges the
 * two. This is the machine-readable half of "no second semantic identity".
 *
 * @param {Array<{ id: string, origin: string }>} entries
 */
export function detectCollisions(entries = []) {
  const byId = new Map();
  for (const entry of entries) {
    const id = normaliseCapabilityId(entry.id);
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(entry.origin);
  }
  const collisions = [...byId.entries()]
    .filter(([, origins]) => origins.size > 1)
    .map(([id, origins]) => Object.freeze({ id, origins: Object.freeze([...origins].sort()) }));
  return Object.freeze({
    collisions: Object.freeze(collisions),
    ok: collisions.length === 0,
    detail: collisions.length === 0
      ? `${byId.size} capability ids, each with exactly one origin`
      : collisions.map((entry) => `${entry.id}: ${entry.origins.join(' + ')}`).join('; '),
  });
}

/** The lock as data, for docs, `.ai/` cards, the contract document and tests. */
export function describeVocabulary() {
  return Object.freeze({
    quotedFrom: QUOTED_FROM,
    canonical: Object.freeze(VOCABULARIES.map((set) => Object.freeze({
      id: set.id,
      question: set.question,
      size: set.values.length,
      values: set.values,
      contract: set.provenance.contract,
      publicationPending: set.publicationPending ?? null,
      declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
    }))),
    local: Object.freeze(LOCAL_VOCABULARIES.map((set) => Object.freeze({
      id: set.id,
      question: set.question,
      values: set.values,
      mapsTo: set.mapsTo,
      extra: Object.freeze((set.extra ?? []).map((entry) => entry.value)),
      declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
    }))),
    rules: Object.freeze([
      'A shared word is quoted from the contract that owns it, with its version — never re-invented here.',
      'A frontend-local word declares what it maps to; a word with no mapping carries its reason.',
      'An undeclared term is refused (fail closed), never treated as a synonym.',
      'Capability ids are normalised once (trim, lowercase, <domain>.<name>); two spellings never both name one capability.',
      'Two origins sharing an id are a reported collision, not a merge.',
      'Two vocabularies may share a spelling only when they share a declared subject, or when the overlap is declared with its reason.',
      'A file no contract row publishes is declared pending with the owner and the decision that asks for one — never assigned to the closest-sounding contract.',
    ]),
  });
}
