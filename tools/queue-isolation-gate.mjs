#!/usr/bin/env node
/**
 * QUEUE LEGO isolation gate — thin wrapper over tools/phase6-isolation-gate.mjs.
 *
 * Runs the isolated subset owned by this LEGO (artefacts + manifest, frozen queue constants,
 * package tests, ZERO RUST and reference integrity), writes
 * docs/isolation/evidence/phase6-queue-gate.json and docs/isolation/PHASE-6-QUEUE-GATE.md.
 *
 * usage: node tools/queue-isolation-gate.mjs [--json] [--skip-tests]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
	process.execPath,
	[join(here, 'phase6-isolation-gate.mjs'), '--lego', 'queue', ...process.argv.slice(2)],
	{ stdio: 'inherit' },
);
process.exit(result.status ?? 1);
