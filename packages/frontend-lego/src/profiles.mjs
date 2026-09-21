/**
 * Device profiles — where a capability can run, and how well.
 *
 * A profile is a declared budget (memory, storage, CPU, network, battery, latency,
 * cost, input, execution model), not a platform check. Nothing in the core UI may
 * branch on "is this Android?"; code asks `resolveSupport(profileId, capability)` and
 * gets one of four answers. Resource-aware never means resource-assuming: a capability
 * declares what it needs, and a profile that cannot host it locally may still reach it
 * remotely — "everything runs locally" is not a requirement the frontend may impose.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** The four answers a capability can get for a profile. */
export const SUPPORT_STATES = Object.freeze(['supported', 'degraded', 'remote', 'unsupported']);

/**
 * Declared device profiles. `executionModel: 'server-only'` means the UI is a thin
 * client: capabilities that must run locally are reached remotely instead.
 */
export const DEVICE_PROFILES = Object.freeze([
  Object.freeze({
    id: 'desktop',
    title: 'Desktop browser',
    budget: Object.freeze({ memoryMb: 8192, storageMb: 2048, cpuCores: 8, input: 'pointer', alwaysOnline: true, meteredNetwork: false, onBattery: false, latencyBudgetMs: 120, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'laptop',
    title: 'Laptop browser',
    budget: Object.freeze({ memoryMb: 4096, storageMb: 1024, cpuCores: 4, input: 'pointer', alwaysOnline: true, meteredNetwork: false, onBattery: true, latencyBudgetMs: 150, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'low-memory',
    title: 'Low-memory browser / old device',
    budget: Object.freeze({ memoryMb: 1024, storageMb: 256, cpuCores: 2, input: 'pointer', alwaysOnline: false, meteredNetwork: true, onBattery: true, latencyBudgetMs: 250, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'android',
    title: 'Android browser',
    budget: Object.freeze({ memoryMb: 2048, storageMb: 256, cpuCores: 4, input: 'touch', alwaysOnline: false, meteredNetwork: true, onBattery: true, latencyBudgetMs: 300, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'termux-companion',
    title: 'Termux companion UI',
    budget: Object.freeze({ memoryMb: 512, storageMb: 128, cpuCores: 2, input: 'touch', alwaysOnline: false, meteredNetwork: true, onBattery: true, latencyBudgetMs: 500, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'remote-only',
    title: 'Remote-only thin client',
    budget: Object.freeze({ memoryMb: 256, storageMb: 32, cpuCores: 1, input: 'pointer', alwaysOnline: true, meteredNetwork: false, onBattery: false, latencyBudgetMs: 900, executionModel: 'server-only' }),
  }),
]);

const PROFILE_BY_ID = new Map(DEVICE_PROFILES.map((profile) => [profile.id, profile]));

/** What a capability may declare it costs to run. Declared, never discovered from a bill. */
export const COST_CLASSES = Object.freeze(['free', 'metered', 'paid']);

/** The budget a profile declares. Documented as data so a reader can see the whole contract. */
export const BUDGET_FIELDS = Object.freeze(['memoryMb', 'storageMb', 'cpuCores', 'input', 'alwaysOnline', 'meteredNetwork', 'onBattery', 'latencyBudgetMs', 'executionModel']);

/** Requirements a capability, a runtime or a sub-LEGO may declare. All optional. */
export const REQUIREMENT_FIELDS = Object.freeze([
  'memoryMb',
  'storageMb',
  'cpuCores',
  'requiresLocalExecution',
  'requiresNetwork',
  'heavy',
  'batteryHeavy',
  'costClass',
  'maxLatencyMs',
  'input',
]);

export class ProfileError extends Error {
  constructor(message, { profileId } = {}) {
    super(message);
    this.name = 'ProfileError';
    this.code = 'frontend.profile.unknown';
    this.profileId = profileId ?? null;
  }
}

export function getProfile(profileId) {
  const profile = PROFILE_BY_ID.get(profileId);
  if (!profile) throw new ProfileError(`unknown device profile "${profileId}" (one of ${DEVICE_PROFILES.map((value) => value.id).join(', ')})`, { profileId });
  return profile;
}

/**
 * Resolves how a capability fares on a profile.
 *
 * Order matters: a capability that cannot run locally at all is answered
 * `remote` (not `unsupported`) when the profile reaches a server; a genuine
 * budget violation is `unsupported`; a soft violation is `degraded`.
 *
 * @param {string} profileId
 * @param {{ id?: string, requirements?: object, criticality?: string }} capability
 * @returns {{ state: string, profile: string, capability: string|null, reason: string }}
 */
export function resolveSupport(profileId, capability = {}) {
  const profile = getProfile(profileId);
  const budget = profile.budget;
  const requirements = capability.requirements ?? {};
  const id = capability.id ?? null;

  const answer = (state, reason) => Object.freeze({ state, profile: profileId, capability: id, reason });

  if (requirements.requiresNetwork === true && budget.alwaysOnline === false) {
    return answer('degraded', 'needs network on a profile that is not always online — the capability must handle offline gaps');
  }
  if (budget.executionModel === 'server-only') {
    if (requirements.requiresLocalExecution === true) return answer('remote', 'cannot run locally; the profile reaches it through the server instead');
    if ((requirements.memoryMb ?? 0) > budget.memoryMb) return answer('remote', 'exceeds the local budget; reached remotely rather than dropped');
  }
  if ((requirements.memoryMb ?? 0) > budget.memoryMb) {
    return answer('unsupported', `needs ~${requirements.memoryMb} MB, profile budget is ${budget.memoryMb} MB`);
  }
  if (requirements.heavy === true && budget.memoryMb <= 1024) {
    return answer('degraded', `declared heavy on a ${budget.memoryMb} MB profile — expected to be lazy or reduced`);
  }
  if (requirements.storageMb && requirements.storageMb > budget.storageMb) {
    return answer('degraded', `wants ${requirements.storageMb} MB of storage, profile has ${budget.storageMb} MB`);
  }
  if (requirements.cpuCores && requirements.cpuCores > budget.cpuCores) {
    return answer('degraded', `declares ${requirements.cpuCores} cores of local work, profile budget is ${budget.cpuCores} — expected to be lazy, chunked or remote`);
  }
  if (requirements.batteryHeavy === true && budget.onBattery === true) {
    return answer('degraded', 'declared battery-heavy on a battery-powered profile — decide before draining it, or run it remotely');
  }
  if (requirements.costClass && requirements.costClass !== 'free' && budget.meteredNetwork === true) {
    return answer('degraded', `declared ${requirements.costClass} on a metered connection — the UI must ask before spending`);
  }
  if (requirements.maxLatencyMs && requirements.maxLatencyMs < budget.latencyBudgetMs) {
    return answer('degraded', `expects up to ${requirements.maxLatencyMs} ms of latency, this profile expects up to ${budget.latencyBudgetMs} ms`);
  }
  if (requirements.input === 'pointer' && budget.input === 'touch') {
    return answer('degraded', 'built for pointer input; a touch profile needs the reduced interaction');
  }
  return answer('supported', 'within the declared budget');
}

/** Profile support matrix for a set of capabilities — data for docs and `.ai/` cards. */
export function supportMatrix(capabilities = []) {
  return Object.freeze(DEVICE_PROFILES.map((profile) => Object.freeze({
    profile: profile.id,
    title: profile.title,
    capabilities: Object.freeze(capabilities.map((capability) => Object.freeze({
      id: capability.id,
      state: resolveSupport(profile.id, capability).state,
    }))),
  })));
}

/** Device profiles as data (docs, `.ai/` cards, tests). */
export function describeProfiles() {
  return Object.freeze({
    states: SUPPORT_STATES,
    requirementFields: REQUIREMENT_FIELDS,
    budgetFields: BUDGET_FIELDS,
    costClasses: COST_CLASSES,
    profiles: DEVICE_PROFILES,
    rules: Object.freeze([
      'Core UI branches on support state, never on platform identity.',
      'Resource-aware never means resource-assuming: a profile that cannot host a capability locally may still reach it remotely.',
      'A declared cost is asked about before it is spent; a declared battery cost is decided before it is drained.',
    ]),
  });
}
