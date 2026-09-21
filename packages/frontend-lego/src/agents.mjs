/**
 * The AI foundation's frontend-visible vocabulary — declarations only.
 *
 * This module answers "what may the UI know about AI, and in which words?" and
 * nothing else. It calls no model, ships no client and implements no provider: the
 * AI Foundation LEGO, whatever runtime it uses, has to be *representable* before a
 * single token is generated, and the frontend has to be able to say "no model here"
 * without looking broken.
 *
 * Four separations carry the whole design:
 *
 *   1. **Provider ≠ runtime ≠ tool.** A model gateway (9Router-shaped), a tool/app
 *      gateway (Composio-shaped), an application provider (GitHub-shaped) and an
 *      agent runtime (Hermes, Claude Code, Gemini CLI, Antigravity, OpenClaw,
 *      DeepSeek Harness …) are different *kinds* of thing. A simulation runtime
 *      (MiroFish-shaped) is a fifth: it produces plausible events, not real work, and
 *      conflating them would let a simulation pass for an execution.
 *   2. **A capability is declared, not found.** The six AI capabilities are declared
 *      here with status `declared`; none is installed, and an installed-less frontend
 *      is a *valid* installation (zero-install mode), not a broken one.
 *   3. **Resource-aware, not resource-assuming.** Which runtime may run is derived
 *      from the declared device profile and the runtime's own declared requirements —
 *      never from "everything is installed locally".
 *   4. **MCP is an interoperability layer**, not the Agent Machine: the frontend may
 *      represent a server, a tool, a resource, a prompt, a connection and its
 *      authorization, and it says "connected / unavailable / permission required /
 *      capability unsupported" without ever naming a transport.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { DEVICE_PROFILES, REQUIREMENT_FIELDS, resolveSupport } from './profiles.mjs';

/** Kinds of provider the frontend may be told about. Vendor names are examples, never fields. */
export const PROVIDER_KINDS = Object.freeze(['model-gateway', 'tool-app-gateway', 'application-provider']);

/**
 * Kinds of runtime. `agent-runtime` does real work; `simulation-runtime` produces
 * plausible events for testing and demos. They are never the same object.
 */
export const RUNTIME_KINDS = Object.freeze(['agent-runtime', 'simulation-runtime']);

/** How an agent runtime is reached — locality, never a product name. */
export const RUNTIME_LOCALITY = Object.freeze(['local', 'remote']);

/** The connection words the UI renders for an MCP server or an external runtime. */
export const MCP_CONNECTION_STATES = Object.freeze(['connected', 'unavailable', 'permission-required', 'capability-unsupported']);

/** What an MCP relationship may expose. Named as objects, never as transport details. */
export const MCP_OBJECTS = Object.freeze(['client-capability', 'server-capability', 'tool', 'resource', 'prompt', 'connection', 'authorization', 'availability']);

/**
 * The six AI capabilities the UI must be able to speak about. Each one is a
 * declaration: `status: 'declared'`, no entry path, no implementation.
 */
export const AI_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: 'ai-assistant',
    title: 'AI Assistant (in-product help and answers)',
    surface: 'dialogs',
    summary: 'A conversational surface that answers questions about the instance. Requests inference; it does not provide it.',
    requires: Object.freeze(['inference']),
  }),
  Object.freeze({
    id: 'ai-copilot',
    title: 'AI Copilot (workflow authoring assistance)',
    surface: 'workflow-editor',
    summary: 'Suggests, explains and edits workflow steps through declared operations. Every mutation stays an ordinary workflow operation.',
    requires: Object.freeze(['inference']),
  }),
  Object.freeze({
    id: 'ai-agent-node',
    title: 'AI Agent node (workflow step that delegates to an agent)',
    surface: 'node-picker',
    summary: 'A node type whose execution hands a task to an agent runtime. Declared as a node capability, not as a runtime.',
    requires: Object.freeze(['inference']),
  }),
  Object.freeze({
    id: 'agent-machine',
    title: 'Agent Machine (runtime that executes delegated tasks)',
    surface: 'executions',
    summary: 'Where delegated work runs: local, remote or simulated. The frontend learns about it through events, never by calling it directly.',
    requires: Object.freeze([]),
  }),
  Object.freeze({
    id: 'execution-ai-mode',
    title: 'Execution AI mode (an execution that is partially agentic)',
    surface: 'executions',
    summary: 'Marks an execution as agent-assisted and exposes its status; the execution contract itself does not change.',
    requires: Object.freeze(['agent-machine']),
  }),
  Object.freeze({
    id: 'agent-work-trace',
    title: 'Agent Work Trace (operational timeline of agent work)',
    surface: 'executions',
    summary: 'Timeline, decisions, approvals, artifacts and state transitions of delegated work, with references instead of payloads.',
    requires: Object.freeze([]),
  }),
]);

const AI_BY_ID = new Map(AI_CAPABILITIES.map((capability) => [capability.id, capability]));

/**
 * The fields the frontend may receive about a runtime or a provider. Anything else
 * is refused: a provider declaration is a boundary, and an unnamed field on it is a
 * field nobody owns.
 */
export const RUNTIME_DECLARATION_FIELDS = Object.freeze([
  'id',
  'kind',
  'locality',
  'providerId',
  'capabilities',
  'operations',
  'requirements',
  'authentication',
  'status',
]);

/** Identity fields the UI may show. `model` and `provider` are shown only when explicitly exposed. */
export const RUNTIME_IDENTITY_FIELDS = Object.freeze(['sessionId', 'runtimeId', 'agentId', 'parentAgentId', 'taskId', 'executionId', 'model', 'provider']);

/** A credential is never a field: it cannot be represented, so it cannot leak. */
const CREDENTIAL_KEYS = Object.freeze(['token', 'secret', 'password', 'apiKey', 'cookie', 'authorization', 'credential', 'privateKey', 'bearer']);

export class AgentContractError extends Error {
  constructor(message, { code = 'frontend.ai.invalid-declaration', id = null, errors = [] } = {}) {
    super(message);
    this.name = 'AgentContractError';
    this.code = code;
    this.id = id;
    this.errors = Object.freeze([...errors]);
  }
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Validates a runtime or provider declaration.
 *
 * Fail-closed on every unknown: an unknown kind, an unknown locality, an undeclared
 * field or a credential-shaped key is refused rather than ignored. `status` uses the
 * canonical implementation-status words, so "declared but not installed" is a status
 * and not an absence.
 */
export function validateRuntimeDeclaration(declaration = {}) {
  const errors = [];
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['a runtime declaration must be an object']) });
  }
  if (typeof declaration.id !== 'string' || !ID_PATTERN.test(declaration.id)) {
    errors.push('"id" must be a lower-kebab identifier');
  }
  if (!RUNTIME_KINDS.includes(declaration.kind)) {
    errors.push(`"kind" must be one of ${RUNTIME_KINDS.join(', ')}`);
  }
  if (!RUNTIME_LOCALITY.includes(declaration.locality)) {
    errors.push(`"locality" must be one of ${RUNTIME_LOCALITY.join(', ')}`);
  }
  for (const key of Object.keys(declaration)) {
    if (!RUNTIME_DECLARATION_FIELDS.includes(key)) errors.push(`unknown field "${key}"`);
    if (CREDENTIAL_KEYS.includes(key)) errors.push(`"${key}" is credential material and cannot be declared`);
  }
  if (declaration.requirements !== undefined) {
    for (const key of Object.keys(declaration.requirements)) {
      if (!REQUIREMENT_FIELDS.includes(key)) errors.push(`unknown requirement "${key}"`);
    }
  }
  for (const capability of [declaration.capabilities ?? []]) {
    if (!Array.isArray(capability)) errors.push('"capabilities" must be an array');
  }
  if (declaration.providerId !== undefined && declaration.providerId !== null && !AI_BY_ID.has(declaration.providerId) && typeof declaration.providerId !== 'string') {
    errors.push('"providerId" must be a string');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/** Validates a provider declaration — same fail-closed rules, provider kinds only. */
export function validateProviderDeclaration(declaration = {}) {
  const errors = [];
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['a provider declaration must be an object']) });
  }
  if (typeof declaration.id !== 'string' || !ID_PATTERN.test(declaration.id)) errors.push('"id" must be a lower-kebab identifier');
  if (!PROVIDER_KINDS.includes(declaration.kind)) errors.push(`"kind" must be one of ${PROVIDER_KINDS.join(', ')}`);
  for (const key of Object.keys(declaration)) {
    if (CREDENTIAL_KEYS.includes(key)) errors.push(`"${key}" is credential material and cannot be declared`);
    else if (key !== 'id' && key !== 'kind' && key !== 'capabilities' && key !== 'operations' && key !== 'requiresAuthorization' && key !== 'status') {
      errors.push(`unknown field "${key}"`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * The installation state, as four separate facts.
 *
 * The whole point: **N8N installed, AI Foundation installed, no model, no external
 * runtime, no MCP provider** is a valid installation. The frontend says which layer
 * is missing instead of rendering an error, and a provider can be configured later.
 *
 * @param {{ inference?: boolean, runtimes?: Array<object>, mcp?: Array<object>, providers?: Array<object> }} [declared]
 */
export function describeInstallation({ inference = false, runtimes = [], mcp = [], providers = [] } = {}) {
  const agentRuntimes = runtimes.filter((runtime) => runtime.kind === 'agent-runtime');
  const simulated = runtimes.filter((runtime) => runtime.kind === 'simulation-runtime');
  const connected = mcp.filter((entry) => (entry.state ?? entry.connection ?? 'unavailable') === 'connected');
  const layers = Object.freeze({
    core: 'available',
    aiFoundation: AI_CAPABILITIES.length > 0 ? 'available' : 'absent',
    inference: inference ? 'available' : 'unavailable',
    agentRuntime: agentRuntimes.length > 0 ? 'available' : 'unavailable',
    simulationRuntime: simulated.length > 0 ? 'available' : 'unavailable',
    toolGateway: providers.some((provider) => provider.kind === 'tool-app-gateway') ? 'available' : 'unavailable',
    modelProvider: providers.some((provider) => provider.kind === 'model-gateway') ? 'available' : 'unavailable',
    mcp: connected.length > 0 ? 'connected' : mcp.length > 0 ? 'declared' : 'absent',
  });
  return Object.freeze({
    layers,
    /** Zero-install is a supported mode, not a degraded one. */
    zeroInstall: !inference && agentRuntimes.length === 0 && providers.length === 0 && mcp.length === 0,
    /** Nothing is missing from the *installation*: inference is a capability, not a requirement. */
    valid: true,
    message: inference
      ? null
      : 'The editor and the AI foundation are installed; no model or agent runtime is configured yet. Add a provider when you want inference.',
    /** What a user could configure next — declared order, no vendor named. */
    configurable: Object.freeze(inference ? [] : ['model-gateway', 'agent-runtime', 'tool-app-gateway']),
  });
}

/**
 * Which runtimes may serve a device profile.
 *
 * Resource-aware selection, in one direction only: a device profile is a budget, a
 * runtime declares its requirements, and the answer is derived. A thin client reaches
 * what it cannot run locally — "all runtimes installed locally" is never a
 * requirement of this contract.
 *
 * @param {{ profile?: string, runtimes?: Array<object> }} init
 */
export function suitableRuntimes({ profile = 'standard', runtimes = [] } = {}) {
  const declared = DEVICE_PROFILES.find((entry) => entry.id === profile);
  const thinClient = declared?.budget.executionModel === 'server-only';
  const candidates = runtimes.map((runtime) => {
    const support = resolveSupport(declared?.id ?? profile, { id: runtime.id, requirements: runtime.requirements ?? {} });
    // Locality is part of the budget too: on a thin client a runtime that declares
    // itself local is installed where the work runs, not here — and that is not a
    // failure, it is a placement.
    const localOnThinClient = thinClient === true && runtime.locality === 'local';
    return Object.freeze({
      id: runtime.id,
      kind: runtime.kind,
      locality: runtime.locality,
      state: localOnThinClient ? 'remote' : support.state,
      reason: localOnThinClient
        ? 'declared local, but this profile is a thin client — a local runtime lives where the work runs, and is never required here'
        : support.reason,
      /** A remote runtime is what a thin client uses instead of installing anything. */
      reachable: !localOnThinClient
        && (support.state === 'supported' || (support.state === 'remote' && runtime.locality === 'remote')),
    });
  });
  const usable = candidates.filter((candidate) => candidate.reachable).map((candidate) => candidate.id);
  return Object.freeze({
    profile: declared?.id ?? profile,
    candidates: Object.freeze(candidates),
    usable: Object.freeze(usable),
    /** Preference order a caller may follow: what runs here, then what it can reach. */
    preference: Object.freeze([
      // Real work first, then simulation; inside each kind, what runs here before what
      // the device only reaches. A simulation is never preferred over a real runtime.
      ...candidates.filter((candidate) => candidate.reachable && candidate.kind === 'agent-runtime' && candidate.locality === 'local').map((candidate) => candidate.id),
      ...candidates.filter((candidate) => candidate.reachable && candidate.kind === 'agent-runtime' && candidate.locality === 'remote').map((candidate) => candidate.id),
      ...candidates.filter((candidate) => candidate.reachable && candidate.kind === 'simulation-runtime').map((candidate) => candidate.id),
    ]),
    /** Never guess: when nothing fits, the caller is told, with the reason per candidate. */
    ok: usable.length > 0,
    reason: usable.length > 0 ? null : 'no declared runtime fits this profile; a remote runtime is the declared way to reach what the device cannot run',
  });
}

/**
 * How one MCP relationship is reported. The UI gets four words and no transport:
 * `connected`, `unavailable`, `permission-required`, `capability-unsupported`.
 *
 * @param {{ id: string, state?: string, objects?: string[], authorization?: string|null }} entry
 */
export function mcpRelationship(entry = {}) {
  const state = MCP_CONNECTION_STATES.includes(entry.state) ? entry.state : 'unavailable';
  const objects = [...new Set(entry.objects ?? [])];
  for (const object of objects) {
    if (!MCP_OBJECTS.includes(object)) {
      throw new AgentContractError(`"${object}" is not a declared MCP object (one of ${MCP_OBJECTS.join(', ')})`, { id: entry.id ?? null, errors: [`unknown MCP object "${object}"`] });
    }
  }
  return Object.freeze({
    id: entry.id ?? null,
    state,
    objects: Object.freeze(objects),
    /** Authorization is a state, never material: there is no field for a token. */
    authorization: entry.authorization === 'granted' ? 'granted' : entry.authorization === 'required' ? 'required' : 'not-required',
    /** What the surface renders, derived from the state — never improvised. */
    label: state === 'connected'
      ? 'Connected'
      : state === 'permission-required'
        ? 'Permission required'
        : state === 'capability-unsupported'
          ? 'Capability unsupported'
          : 'Unavailable',
    /** Who owns the relationship — an interop layer is never the Agent Machine. */
    role: 'interoperability-layer',
  });
}

/** The AI vocabulary as data, for docs, `.ai/` cards, the contract and tests. */
export function describeAgents() {
  return Object.freeze({
    capabilities: AI_CAPABILITIES,
    providerKinds: PROVIDER_KINDS,
    runtimeKinds: RUNTIME_KINDS,
    runtimeLocality: RUNTIME_LOCALITY,
    mcp: Object.freeze({ objects: MCP_OBJECTS, states: MCP_CONNECTION_STATES, role: 'interoperability-layer' }),
    declarationFields: RUNTIME_DECLARATION_FIELDS,
    identityFields: RUNTIME_IDENTITY_FIELDS,
    /** The trace contract itself lives in `agent-events.mjs`; this is the pointer a UI needs. */
    trace: Object.freeze({
      module: 'agent-events.mjs',
      inheritsPermissions: false,
      bounded: true,
      referencesOnly: true,
    }),
    rules: Object.freeze([
      'The frontend declares AI capabilities and never implements inference: no model call, no provider client, no vendor field.',
      'A provider, a runtime and a tool are different kinds of object; a simulation runtime is never reported as an agent runtime.',
      'An installation with no model, no runtime and no MCP provider is valid (zero-install), and the UI says which layer is absent.',
      'Runtime selection follows the declared device budget: a thin client reaches a remote runtime instead of installing one.',
      'MCP is an interoperability layer, never the Agent Machine: the UI renders four connection words and no transport.',
      'Model and provider identity appear only when the runtime explicitly exposes them; chain-of-thought is never a field.',
    ]),
  });
}
