#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = join(root, 'packages/trigger-lego');
const results = [];
const gate = (id, name, check) => {
  try { results.push({ id, name, status: 'PASS', detail: check() }); }
  catch (error) { results.push({ id, name, status: 'FAIL', detail: error.message }); }
  console.log(`[${results.at(-1).status}] ${id} ${name} — ${results.at(-1).detail}`);
};
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const run = (command, args, cwd = root) => {
  const out = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-1000));
  return out.stdout;
};

gate('T01', 'package has no runtime dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json')));
  const dependencies = Object.keys(manifest.dependencies ?? {});
  if (dependencies.length) throw new Error(dependencies.join(', '));
  return '0 runtime dependencies';
});
gate('T02', 'source boundary is import-closed', () => {
  const files = walk(join(pkg, 'src')).filter((file) => file.endsWith('.mjs'));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.') && !match[1].startsWith('node:')) throw new Error(`${file}: ${match[1]}`);
    }
  }
  return `${files.length} source files, relative imports only`;
});
gate('T03', 'trigger lifecycle conformance suite', () => {
  const output = run(process.execPath, ['--test', 'test/*.test.mjs'], pkg);
  const pass = /^# pass (\d+)$/m.exec(output)?.[1];
  const fail = /^# fail (\d+)$/m.exec(output)?.[1];
  if (pass !== '9' || fail !== '0') throw new Error(`${pass} pass / ${fail} fail`);
  return '9 pass / 0 fail';
});
gate('T04', 'reference tree remains pinned', () => {
  const output = run(process.execPath, ['tools/workflow-reference-manifest.mjs', '--check']);
  return output.trim().split('\n').at(-1);
});
gate('T05', 'formal trigger contract remains present', () => {
  const contract = readFileSync(join(root, 'contracts/trigger.contract.md'), 'utf8');
  for (const symbol of ['ActiveWorkflows', 'TriggersAndPollers', 'ScheduledTaskManager', 'WorkflowActivationError']) {
    if (!contract.includes(symbol)) throw new Error(`missing ${symbol}`);
  }
  return '4/4 core symbols contracted';
});

const report = {
  generatedAt: new Date().toISOString(),
  task: 'TASK-406-phase3-trigger-lego',
  reference: 'n8n 2.9.4',
  totals: { passed: results.filter((r) => r.status === 'PASS').length, gates: results.length },
  gates: results,
};
writeFileSync(join(root, 'docs/isolation/evidence/trigger-lego-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nTrigger LEGO gate: ${report.totals.passed}/${report.totals.gates} PASS`);
process.exit(report.totals.passed === report.totals.gates ? 0 : 1);
