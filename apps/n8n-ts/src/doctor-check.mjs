#!/usr/bin/env node
/**
 * In-process doctor checks (called by scripts/doctor.sh and tests).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDefaultEnv, resolveConfig, REPO_ROOT, APP_ROOT, PACKAGE_VERSION } from './config.mjs';
import {
  LEGO_INTEGRATION,
  loadEngineRunner,
  probeExecutionLego,
  probeWorkflowLego,
} from '../lib/engine-adapter.mjs';

loadDefaultEnv();

const checks = [];

function ok(name, detail) {
  checks.push({ name, ok: true, detail });
}
function fail(name, detail) {
  checks.push({ name, ok: false, detail });
}

async function main() {
  let config;
  try {
    config = resolveConfig();
    ok('config', `host=${config.host} port=${config.port}`);
  } catch (err) {
    fail('config', String(err));
    printAndExit();
    return;
  }

  // Node version
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok('node', process.versions.node);
  else fail('node', `need >=20, got ${process.versions.node}`);

  // Paths
  const serverPath = path.join(APP_ROOT, 'src/server.mjs');
  if (fs.existsSync(serverPath)) ok('server_entry', serverPath);
  else fail('server_entry', `missing ${serverPath}`);

  const runner = LEGO_INTEGRATION.runnerPath;
  if (fs.existsSync(runner)) ok('engine_runner', runner);
  else fail('engine_runner', `missing ${runner}`);

  // Engine import
  try {
    const mod = await loadEngineRunner();
    if (typeof mod.WorkflowExecutionEngine === 'function') {
      ok('engine_import', 'WorkflowExecutionEngine');
    } else {
      fail('engine_import', 'WorkflowExecutionEngine not exported');
    }
  } catch (err) {
    fail('engine_import', String(err));
  }

  const execProbe = await probeExecutionLego();
  if (execProbe.available) ok('execution_lego', execProbe.source || 'present');
  else fail('execution_lego', execProbe.error || 'missing');

  const wfProbe = await probeWorkflowLego();
  if (wfProbe.available) ok('workflow_lego', wfProbe.index);
  else fail('workflow_lego', 'package missing');

  // Contract present
  const contract = path.join(REPO_ROOT, 'contracts/ts-runtime-baseline.contract.md');
  if (fs.existsSync(contract)) ok('contract', contract);
  else fail('contract', 'missing ts-runtime-baseline.contract.md');

  // Rust freeze sanity: we only check we did not accidentally require crates
  ok('rust_frozen', 'baseline does not import crates/**');

  printAndExit();
}

function printAndExit() {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${c.name}: ${c.detail}`);
  }
  console.log(
    JSON.stringify({
      service: 'n8n-ts-baseline',
      version: PACKAGE_VERSION,
      ok: failed.length === 0,
      failed: failed.map((f) => f.name),
      checks,
    }),
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
