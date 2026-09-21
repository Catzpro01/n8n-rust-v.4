/**
 * Device profiles — where a capability can run, and how well.
 *
 * A profile is a declared budget (memory, input, network, execution model), not a
 * platform check. Nothing in the core UI may branch on "is this Android?"; code
 * asks `resolveSupport(profileId, capability)` and gets one of four answers.
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
    budget: Object.freeze({ memoryMb: 8192, storageMb: 2048, input: 'pointer', alwaysOnline: true, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'laptop',
    title: 'Laptop browser',
    budget: Object.freeze({ memoryMb: 4096, storageMb: 1024, input: 'pointer', alwaysOnline: true, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'low-memory',
    title: 'Low-memory browser / old device',
    budget: Object.freeze({ memoryMb: 1024, storageMb: 256, input: 'pointer', alwaysOnline: false, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'android',
    title: 'Android browser',
    budget: Object.freeze({ memoryMb: 2048, storageMb: 256, input: 'touch', alwaysOnline: false, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'termux-companion',
    title: 'Termux companion UI',
    budget: Object.freeze({ memoryMb: 512, storageMb: 128, input: 'touch', alwaysOnline: false, executionModel: 'local' }),
  }),
  Object.freeze({
    id: 'remote-only',
    title: 'Remote-only thin client',
    budget: Object.freeze({ memoryMb: 256, storageMb: 32, input: 'pointer', alwaysOnline: true, executionModel: 'server-only' }),
  }),
]);

const PROFILE_BY_ID = new Map(DEVICE_PROFILES.map((profile) => [profile.id, profile]));

/** Requirements a capability (or sub-LEGO) may declare. All optional. */
export const REQUIREMENT_FIELDS = Object.freeze(['memoryMb', 'storageMb', 'requiresLocalExecution', 'requiresNetwork', 'heavy', 'input']);

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
    profiles: DEVICE_PROFILES,
    rule: 'Core UI branches on support state, never on platform identity.',
  });
}
