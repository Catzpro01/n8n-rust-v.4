#!/usr/bin/env node
/**
 * `n8n-lego` CLI — the command people run after `npm install -g n8n-lego`.
 *
 *   n8n-lego start        start the app (default)
 *   n8n-lego doctor       check the install: node, UI bundle, node catalog, port
 *   n8n-lego version      print versions
 *   n8n-lego --help
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');

const command = process.argv[2] ?? 'start';

async function main() {
  switch (command) {
    case 'start':
      await import('../src/server.mjs').then((module) => module.startServer());
      return;
    case 'doctor':
      await doctor();
      return;
    case 'version':
    case '--version':
    case '-v':
      printVersion();
      return;
    case 'help':
    case '--help':
    case '-h':
      usage();
      return;
    default:
      process.stderr.write(`unknown command: ${command}\n\n`);
      usage();
      process.exit(64);
  }
}

function printVersion() {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
  process.stdout.write(
    [
      `n8n lego            ${pkg.version}`,
      `reference           n8n 2.9.4`,
      `editor UI           ${editorUiVersion() ?? 'not installed'}`,
      `node                ${process.versions.node}`,
    ].join('\n') + '\n',
  );
}

function editorUiVersion() {
  const file = join(APP_ROOT, 'node_modules', 'n8n-editor-ui', 'package.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')).version;
}

async function doctor() {
  const checks = [];
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'node >= 22.18',
    ok: major > 22 || (major === 22 && minor >= 18),
    detail: process.versions.node,
  });

  const uiDist = join(APP_ROOT, 'node_modules', 'n8n-editor-ui', 'dist', 'index.html');
  checks.push({
    name: 'editor UI bundle',
    ok: existsSync(uiDist),
    detail: existsSync(uiDist) ? `n8n-editor-ui ${editorUiVersion()}` : 'run: npm install (in apps/n8n-lego)',
  });

  const catalogFile = join(REPO_ROOT, 'data', 'n8n-lego', 'catalog', 'nodes.json');
  let catalogCount = 0;
  if (existsSync(catalogFile)) {
    try {
      catalogCount = JSON.parse(readFileSync(catalogFile, 'utf8')).length;
    } catch {
      catalogCount = 0;
    }
  }
  checks.push({
    name: 'node catalog',
    ok: catalogCount > 0,
    detail: catalogCount > 0 ? `${catalogCount} node types` : 'run: npm run catalog',
  });

  const port = Number(process.env.N8N_LEGO_PORT ?? process.env.N8N_PORT ?? 5678);
  const free = await portFree(port);
  checks.push({ name: `port ${port} free`, ok: free, detail: free ? 'available' : 'in use — the app will fail to bind' });

  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(22)} ${check.detail}\n`);
  }
  process.stdout.write(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) failed\n`);
  if (failed > 0) process.exit(1);
}

function portFree(port) {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.once('error', () => resolvePort(false));
    probe.once('listening', () => probe.close(() => resolvePort(true)));
    probe.listen(port, '127.0.0.1');
  });
}

function usage() {
  process.stdout.write(
    [
      'n8n lego — workflow automation app (n8n-compatible editor, LEGO engine)',
      '',
      'usage: n8n-lego <command>',
      '',
      '  start      start the server (default)',
      '  doctor     check node, UI bundle, node catalog and port',
      '  version    print versions',
      '  help       show this help',
      '',
      'environment (n8n-compatible; N8N_LEGO_* takes precedence):',
      '  N8N_LEGO_PORT / N8N_PORT             listen port (default 5678)',
      '  N8N_LEGO_HOST / N8N_HOST             listen address (default 0.0.0.0)',
      '  N8N_LEGO_USER_FOLDER / N8N_USER_FOLDER  data directory',
      '  N8N_LEGO_OWNER_EMAIL / _PASSWORD     create the owner account on first boot',
      '  N8N_LEGO_PATH / N8N_PATH             serve under a sub-path',
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
