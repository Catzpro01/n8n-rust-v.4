/**
 * Architecture gate — selftest.
 *
 * A gate nobody has seen fail is a gate nobody can trust. This module plants
 * real forbidden dependencies in a throwaway copy of the app tree and asserts
 * the gate flags each one with the expected rule. It is exercised by
 * `node tools/lego/architecture-gate.mjs --selftest` and by the foundation
 * contract tests (`apps/n8n-lego/test/lego-foundation.test.mjs`).
 *
 * The fixtures are written to a temp directory — the real source tree is never
 * touched, so the selftest cannot leave the repository dirty.
 *
 * Two kinds of fixture:
 *   CASES            plant a source file and require an import-graph rule to fire
 *   REGISTRY_CASES   mutate an in-memory copy of the registry and require a
 *                    version/hierarchy rule (R9, R6) to fire — P2.7
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadRegistry } from '../../apps/n8n-lego/src/lego/registry.mjs';
import { runGate } from './architecture-gate.core.mjs';

/**
 * Each case is a file planted at `file`, containing `source`, that MUST produce
 * `expectedRule`. These are the concrete patterns P2.6 promised to detect.
 */
export const CASES = Object.freeze([
  {
    name: 'storage internal reaches into workflow internal',
    file: 'src/store.mjs',
    source: "import { calculateWorkflowChecksum } from './checksum.mjs';\nexport const x = calculateWorkflowChecksum;\n",
    expectedRule: 'R2 forbidden-direction',
  },
  {
    name: 'execution internal reaches into workflow internal',
    file: 'src/engine.mjs',
    source: "import { calculateWorkflowChecksum } from './checksum.mjs';\nexport const x = calculateWorkflowChecksum;\n",
    expectedRule: 'R2 forbidden-direction',
  },
  {
    name: 'node registry reaches into credential/storage persistence',
    file: 'src/catalog.mjs',
    source: "import { createStore } from './store.mjs';\nexport const x = createStore;\n",
    expectedRule: 'R2 forbidden-direction',
  },
  {
    name: 'a domain imports another domain it never declared',
    file: 'src/settings/routes.mjs',
    source: "import { loadCatalog } from '../catalog.mjs';\nexport const x = loadCatalog;\n",
    expectedRule: 'R3 undeclared-dependency',
  },
  {
    name: 'a consumer reaches past a public surface into internals',
    file: 'src/compat/route.mjs',
    source: "import { createReferenceStore } from '../reference-lego/internal/store.mjs';\nexport const x = createReferenceStore;\n",
    expectedRule: 'R4 internal-import',
  },
  // --- P2.7: nested LEGO fixtures ---
  {
    name: 'nested: a sub-LEGO reaches into a sibling sub-LEGO internal',
    file: 'src/reference-lego/sub/repository/contract/index.mjs',
    source: "import { applyRules } from '../../validation/internal/rules.mjs';\nexport const x = applyRules;\n",
    expectedRule: 'R4 internal-import',
  },
  {
    name: 'nested: an outside consumer imports a sub-LEGO internal, not its contract',
    file: 'src/compat/route.mjs',
    source:
      "import { createTableChecker } from '../reference-lego/sub/validation/sub/schema/internal/table-checker.mjs';\nexport const x = createTableChecker;\n",
    expectedRule: 'R4 internal-import',
  },
  {
    name: 'nested: a sub-LEGO depends on a sibling it never declared',
    file: 'src/reference-lego/sub/validation/contract/index.mjs',
    source:
      "import { createRepositoryLego } from '../../repository/contract/index.mjs';\nexport const x = createRepositoryLego;\n",
    expectedRule: 'R2 forbidden-direction',
  },
  {
    name: 'nested: a grandchild reaches out to a forbidden domain',
    file: 'src/reference-lego/sub/validation/sub/schema/contract/index.mjs',
    source: "import { createStore } from '../../../../../../store.mjs';\nexport const x = createStore;\n",
    expectedRule: 'R2 forbidden-direction',
  },
  {
    name: 'a new file appears in the frozen legacy zone',
    file: 'src/rest/new-feature.mjs',
    source: 'export const feature = () => null;\n',
    expectedRule: 'R5 legacy-zone-growth',
  },
  {
    name: 'a source file belongs to no domain',
    file: 'src/orphan.mjs',
    source: 'export const orphan = true;\n',
    expectedRule: 'R1 unowned-file',
  },
]);

function plant(appRoot, file, source) {
  const target = join(appRoot, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source, 'utf8');
}

/**
 * Runs every planted case in isolation.
 * @returns {Array<{ name: string, expectedRule: string, detected: boolean, saw: string[] }>}
 */
export function runSelftest() {
  const registry = loadRegistry({ reload: true });
  const results = [];

  for (const testCase of CASES) {
    const appRoot = mkdtempSync(join(tmpdir(), 'lego-gate-selftest-'));
    try {
      plant(appRoot, testCase.file, testCase.source);
      const violations = runGate({ registry, appRoot });
      const forFile = violations.filter((violation) => violation.file === testCase.file);
      results.push({
        name: testCase.name,
        expectedRule: testCase.expectedRule,
        detected: forFile.some((violation) => violation.rule === testCase.expectedRule),
        saw: forFile.map((violation) => violation.rule),
      });
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  }

  return results;
}

/**
 * Control case: a *correct* file in the same harness must produce no violation
 * of its own, proving the gate is not simply flagging everything.
 */
export function runNegativeControl() {
  const registry = loadRegistry({ reload: true });
  const appRoot = mkdtempSync(join(tmpdir(), 'lego-gate-control-'));
  try {
    plant(
      appRoot,
      'src/settings/routes.mjs',
      "import { sendData } from '../compat/response.mjs';\nexport const x = sendData;\n",
    );
    plant(appRoot, 'src/compat/response.mjs', 'export const sendData = () => null;\n');
    const violations = runGate({ registry, appRoot }).filter(
      (violation) => violation.file === 'src/settings/routes.mjs',
    );
    return { clean: violations.length === 0, violations };
  } finally {
    rmSync(appRoot, { recursive: true, force: true });
  }
}

/* ------------------------------------------------- P2.7 registry-level cases */

/**
 * These mutate a deep copy of the real registry in memory — never the file —
 * and require the version/hierarchy rules to catch the result.
 */
export const REGISTRY_CASES = Object.freeze([
  {
    name: 'version: a consumer requirement the provider no longer satisfies',
    expectedRule: 'R9 version-incompatible',
    mutate(registry) {
      // The parent is built against ^1.0.0 of validation; push validation to
      // 2.0.0 and the declared requirement must break loudly.
      const validation = registry.byId.get('reference-lego.validation');
      validation.contract.version = '2.0.0';
      const lock = registry.contractLock.contracts.find((c) => c.id === 'reference.validation');
      lock.version = '2.0.0';
      lock.changelog = ['2.0.0 test fixture'];
    },
  },
  {
    name: 'version: the registry and the contract lock disagree',
    expectedRule: 'R9 version-incompatible',
    mutate(registry) {
      registry.byId.get('reference-lego.repository').contract.version = '1.4.0';
    },
  },
  {
    name: 'version: a breaking bump with no changelog entry',
    expectedRule: 'R9 version-incompatible',
    mutate(registry) {
      const lock = registry.contractLock.contracts.find((c) => c.id === 'reference.validation');
      lock.previousVersion = '1.1.0';
      lock.version = '2.0.0';
      delete lock.changelog;
      registry.byId.get('reference-lego.validation').contract.version = '2.0.0';
      // keep the parent requirement satisfiable so this case isolates the changelog rule
      registry.byId.get('reference-lego').requires['reference-lego.validation'] = '*';
    },
  },
  {
    name: 'version: a contract version that goes backwards',
    expectedRule: 'R9 version-incompatible',
    mutate(registry) {
      const lock = registry.contractLock.contracts.find((c) => c.id === 'reference.validation');
      lock.previousVersion = '1.1.0';
      lock.version = '1.0.0';
      registry.byId.get('reference-lego.validation').contract.version = '1.0.0';
    },
  },
  {
    name: 'nesting: a sub-LEGO owns a path outside its parent',
    expectedRule: 'R6 registry-invalid',
    mutate(registry) {
      registry.byId.get('reference-lego.repository').paths = ['src/compat'];
    },
  },
  {
    name: 'nesting: a parent cycle',
    expectedRule: 'R6 registry-invalid',
    mutate(registry) {
      registry.byId.get('reference-lego').parent = 'reference-lego.validation';
    },
  },
  {
    name: 'nesting: two agents claim the same sub-LEGO',
    expectedRule: 'R6 registry-invalid',
    mutate(registry) {
      registry.agents['agent-2'].domains.push('reference-lego.validation');
    },
  },
]);

/** Deep copy of the registry with the `byId` index rebuilt over the copy. */
function cloneRegistry(registry) {
  const manifest = structuredClone(registry.manifest);
  const contractLock = structuredClone(registry.contractLock);
  return {
    manifest,
    contractLock,
    errorContract: registry.errorContract,
    domains: manifest.domains,
    agents: manifest.agents,
    allowances: manifest.allowances ?? [],
    legacy: manifest.legacy ?? { files: [] },
    byId: new Map(manifest.domains.map((domain) => [domain.id, domain])),
  };
}

/**
 * Runs the registry-level fixtures. Each runs against a pristine clone, with
 * no source files planted, so only registry rules can fire.
 */
export function runRegistrySelftest() {
  const base = loadRegistry({ reload: true });
  const results = [];
  for (const testCase of REGISTRY_CASES) {
    const registry = cloneRegistry(base);
    testCase.mutate(registry);
    const appRoot = mkdtempSync(join(tmpdir(), 'lego-gate-registry-'));
    try {
      const violations = runGate({ registry, appRoot });
      results.push({
        name: testCase.name,
        expectedRule: testCase.expectedRule,
        detected: violations.some((violation) => violation.rule === testCase.expectedRule),
        saw: [...new Set(violations.map((violation) => violation.rule))],
      });
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  }
  return results;
}
