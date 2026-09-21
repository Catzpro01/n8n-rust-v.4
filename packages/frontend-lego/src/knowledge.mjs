/**
 * The `.ai/` knowledge pack, as data.
 *
 * The pack itself is a set of small files; this module is the index that says
 * which of them belong to which level, so a task can load *only* what it needs.
 * It reads nothing from disk and runs nothing at boot: retrieving context is a
 * tooling concern, and the browser never pays for it.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** Where the pack lives, relative to the repository root. */
export const PACK_ROOT = '.ai';

/** The five context levels. Load L0 always; add levels as the task requires. */
export const CONTEXT_LEVELS = Object.freeze([
  Object.freeze({
    id: 'L0',
    title: 'Constitution',
    files: Object.freeze(['.ai/constitution.md']),
    answers: 'What is forbidden, who owns what, which boundaries are hard.',
    maxBytes: 6144,
  }),
  Object.freeze({
    id: 'L1',
    title: 'Frontend domain card',
    files: Object.freeze(['.ai/frontend/card.md']),
    answers: 'How the frontend LEGO is built, where things live, how boot works.',
    maxBytes: 8192,
  }),
  Object.freeze({
    id: 'L2',
    title: 'Contract card',
    files: Object.freeze(['.ai/index/contracts.json']),
    answers: 'What a contract promises, who consumes it, what it may not encode.',
    maxBytes: 8192,
  }),
  Object.freeze({
    id: 'L3',
    title: 'Task recipe',
    files: Object.freeze(['.ai/cards/recipes.md']),
    answers: 'The exact steps and commands for a known task shape.',
    maxBytes: 8192,
  }),
  Object.freeze({
    id: 'L4',
    title: 'Source',
    files: Object.freeze([]),
    answers: 'Implementation detail the pack deliberately does not restate.',
    maxBytes: null,
  }),
]);

/** Reference material that is useful but not part of the level ladder. */
export const REFERENCE_FILES = Object.freeze({
  glossary: '.ai/frontend/glossary.md',
  decisions: '.ai/cards/decisions.md',
  dependencies: '.ai/maps/dependencies.md',
  units: '.ai/index/units.json',
  capabilities: '.ai/index/capabilities.json',
  contracts: '.ai/index/contracts.json',
  readme: '.ai/README.md',
});

/**
 * Task shapes → the files to load, in order. `unknown` is the honest default: when
 * a task does not match a known shape, load the constitution and the domain card and
 * stop, rather than guessing at more.
 */
export const TASK_INDEX = Object.freeze({
  'add-unit': Object.freeze({ level: 'L3', recipe: 'R1 — Add a sub-LEGO unit', files: Object.freeze(['.ai/cards/recipes.md', '.ai/index/units.json', '.ai/maps/dependencies.md']) }),
  'change-hook': Object.freeze({ level: 'L3', recipe: 'R2 — Change or add an extension hook', files: Object.freeze(['.ai/cards/recipes.md', '.ai/index/contracts.json']) }),
  'change-contract': Object.freeze({ level: 'L3', recipe: 'R3 — Change a frontend contract', files: Object.freeze(['.ai/cards/recipes.md', '.ai/index/contracts.json', '.ai/maps/dependencies.md']) }),
  'upgrade-unit': Object.freeze({ level: 'L3', recipe: 'R4 — Upgrade a unit version', files: Object.freeze(['.ai/cards/recipes.md', '.ai/index/units.json']) }),
  'run-tests': Object.freeze({ level: 'L3', recipe: 'R5 — Run the selective test set', files: Object.freeze(['.ai/cards/recipes.md', '.ai/maps/dependencies.md']) }),
  'hand-off': Object.freeze({ level: 'L3', recipe: 'R6 — Hand work to another agent or the Manager', files: Object.freeze(['.ai/cards/recipes.md', '.ai/index/contracts.json']) }),
  'add-capability': Object.freeze({ level: 'L2', files: Object.freeze(['.ai/index/capabilities.json', '.ai/index/contracts.json']) }),
  'translation-readiness': Object.freeze({ level: 'L2', files: Object.freeze(['.ai/index/capabilities.json', '.ai/frontend/glossary.md', '.ai/index/contracts.json']) }),
  unknown: Object.freeze({ level: 'L1', files: Object.freeze(['.ai/frontend/card.md']) }),
});

/** Every file the pack declares, deduplicated and sorted. */
export function packFiles() {
  const files = new Set([
    REFERENCE_FILES.readme,
    ...CONTEXT_LEVELS.flatMap((level) => level.files),
    ...Object.values(TASK_INDEX).flatMap((task) => task.files),
    ...Object.values(REFERENCE_FILES),
  ]);
  return Object.freeze([...files].sort());
}

/**
 * The context to load for a task, cheapest useful set first.
 *
 * @param {{ kind?: string, unit?: string|null, contract?: string|null }} task
 */
export function contextFor(task = {}) {
  const kind = typeof task.kind === 'string' ? task.kind : 'unknown';
  const matched = TASK_INDEX[kind] ?? TASK_INDEX.unknown;
  const known = kind in TASK_INDEX;
  const files = [...new Set([...CONTEXT_LEVELS[0].files, ...matched.files])];
  if (task.contract) files.push(task.contract);
  return Object.freeze({
    kind,
    known,
    level: matched.level,
    ...(matched.recipe ? { recipe: matched.recipe } : {}),
    files: Object.freeze(files),
    /** Never load the pack wholesale — the level ladder exists to prevent it. */
    advice: known
      ? `Start at L0 (${CONTEXT_LEVELS[0].files[0]}), then the files listed here. Open source only for implementation detail.`
      : 'No recipe matches this task shape: load L0 and L1, then ask which unit and contract it belongs to.',
  });
}

/** The pack as data, for docs, tests and tooling. */
export function describePack() {
  return Object.freeze({
    root: PACK_ROOT,
    levels: CONTEXT_LEVELS,
    reference: REFERENCE_FILES,
    tasks: Object.keys(TASK_INDEX),
  });
}
