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
