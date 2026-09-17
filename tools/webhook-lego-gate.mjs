#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = join(root, 'packages/webhook-lego');
const gates = [];
const gate = (id, name, fn) => { try { gates.push({ id, name, status: 'PASS', detail: fn() }); } catch (e) { gates.push({ id, name, status: 'FAIL', detail: e.message }); } console.log(`[${gates.at(-1).status}] ${id} ${name} — ${gates.at(-1).detail}`); };
const walk = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
const run = (args, cwd = root) => { const out = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000 }); if (out.status) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-800)); return out.stdout; };
gate('W01', 'zero runtime dependencies', () => Object.keys(JSON.parse(readFileSync(join(pkg, 'package.json'))).dependencies ?? {}).length === 0 ? '0 dependencies' : (() => { throw new Error('dependencies found'); })());
gate('W02', 'source boundary is import-closed', () => { const files = walk(join(pkg, 'src')).filter((f) => f.endsWith('.mjs')); for (const file of files) for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) if (!m[1].startsWith('.') && !m[1].startsWith('node:')) throw new Error(m[1]); return `${files.length} source files`; });
gate('W03', 'webhook routing conformance suite', () => { const out = run(['--test', 'test/*.test.mjs'], pkg); const pass = /^# pass (\d+)$/m.exec(out)?.[1]; const fail = /^# fail (\d+)$/m.exec(out)?.[1]; if (pass !== '67' || fail !== '0') throw new Error(`${pass}/${fail}`); return '67 pass / 0 fail'; });
gate('W04', 'reference tree remains pinned', () => run(['tools/workflow-reference-manifest.mjs', '--check']).trim().split('\n').at(-1));
gate('W05', 'formal webhook contract present', () => { const c = readFileSync(join(root, 'contracts/webhook.contract.md'), 'utf8'); for (const s of ['WebhookService', 'WebhookRequestHandler', 'findWebhook', 'deleteWorkflowWebhooks', 'WebhookHttpServer', 'WaitingWebhookManager', 'WaitingFormManager', 'parseMultipartFormData', 'createStreamResponse', 'extractWebhookLastNodeResponse', 'WebhookResponseHeaders']) if (!c.includes(s)) throw new Error(`missing ${s}`); return '11/11 core surfaces contracted'; });
const report = { generatedAt: new Date().toISOString(), task: 'TASK-407-phase3-webhook-lego', reference: 'n8n 2.9.4', totals: { passed: gates.filter((g) => g.status === 'PASS').length, gates: gates.length }, gates };
writeFileSync(join(root, 'docs/isolation/evidence/webhook-lego-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWebhook LEGO gate: ${report.totals.passed}/${report.totals.gates} PASS`);
process.exit(report.totals.passed === report.totals.gates ? 0 : 1);
