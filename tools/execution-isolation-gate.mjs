#!/usr/bin/env node
/**
 * EXECUTION LEGO isolation gate — thin wrapper over tools/phase7-isolation-gate.mjs.
 *
 * Runs the isolated Phase-7 gate for the execution runtime (artefacts, error surface, lifecycle
 * lines, recovery semantics, package tests, ZERO RUST, reference integrity, queue drift audit)
 * and writes docs/isolation/evidence/phase7-gate.json + docs/isolation/PHASE-7-GATE.md.
 *
 * usage: node tools/execution-isolation-gate.mjs [--json] [--skip-tests]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [join(here, 'phase7-isolation-gate.mjs'), ...process.argv.slice(2)], {
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
