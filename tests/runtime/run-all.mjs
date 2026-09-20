#!/usr/bin/env node
/**
 * run-all — orkestrasi suite runtime: cek prasyarat → node --test serial → ringkasan gate.
 * Pakai: node tests/runtime/run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const DIST = `${ROOT}/apps/n8n-ts/dist/server.js`;

const FILES = [
  '01-health.test.mjs',
  '02-workflow-execution.test.mjs',
  '03-malformed.test.mjs',
  '04-empty-workflow.test.mjs',
  '05-unknown-node.test.mjs',
  '06-restart.test.mjs',
  '07-configuration.test.mjs',
  '08-regression.test.mjs',
];

if (!existsSync(DIST)) {
  console.error(`[run-all][FAIL] runtime belum di-build: ${DIST}`);
  console.error('[run-all] jalankan dulu: npm --prefix apps/n8n-ts run build');
  process.exit(1);
}

console.log(`[run-all] ${FILES.length} file test → runtime nyata (${DIST})`);
const res = spawnSync('node', ['--test', ...FILES.map((f) => `tests/runtime/${f}`)], {
  cwd: ROOT,
  stdio: 'inherit',
});

if (res.status === 0) console.log('[run-all] HASIL: SEMUA LULUS');
else console.log(`[run-all] HASIL: GAGAL (exit ${res.status})`);
process.exit(res.status ?? 1);
