import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as oldConfig from '../src/config.mjs';
import * as config from '../src/platform-kernel/contract/config.mjs';
import * as oldLogger from '../src/logger.mjs';
import * as logger from '../src/platform-kernel/contract/logger.mjs';
import { loadRegistry } from '../src/lego/registry.mjs';
import { extractImports, runGate } from '../../../tools/lego/architecture-gate.core.mjs';
import { checkPhysicalLayout } from '../../../tools/lego/physical-layout.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = loadRegistry({ reload: true });

function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'physical-kernel-'));
  try {
    cpSync(join(APP_ROOT, 'src/platform-kernel'), join(root, 'src/platform-kernel'), { recursive: true });
    for (const file of ['src/config.mjs', 'src/logger.mjs']) cpSync(join(APP_ROOT, file), join(root, file));
    return callback(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function plant(root, file, source) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), source);
}

test('old and canonical config paths expose exactly the same symbols and identities', () => {
  assert.deepEqual(Object.keys(oldConfig), Object.keys(config));
  for (const name of Object.keys(config)) assert.equal(oldConfig[name], config[name], name);
});
test('old and canonical logger paths expose exactly the same factory', () => {
  assert.deepEqual(Object.keys(oldLogger), Object.keys(logger));
  assert.equal(oldLogger.createLogger, logger.createLogger);
});
test('moving implementation preserves package and repository roots', () => {
  assert.equal(config.APP_ROOT, APP_ROOT);
  assert.equal(config.REPO_ROOT, resolve(APP_ROOT, '../..'));
});
test('an installed package resolves its own node_modules, not the implementation folder', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'installed-kernel-'));
  try {
    const pkg = join(temp, 'node_modules/n8n-lego');
    cpSync(join(APP_ROOT, 'src/platform-kernel'), join(pkg, 'src/platform-kernel'), { recursive: true });
    const installed = await import(pathToFileURL(join(pkg, 'src/platform-kernel/contract/config.mjs')).href);
    const loaded = installed.loadConfig({ N8N_LEGO_USER_FOLDER: join(temp, 'data') });
    assert.equal(installed.APP_ROOT, pkg);
    assert.equal(loaded.editorDist, join(pkg, 'node_modules/n8n-editor-ui/dist'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('configuration retains namespaced precedence, validation, and stable instance identity', () => {
  fixture((root) => {
    const env = { N8N_LEGO_USER_FOLDER: join(root, 'data'), N8N_PORT: '6000', N8N_LEGO_PORT: '6001', N8N_LEGO_STORAGE: 'memory' };
    const first = config.loadConfig(env);
    const second = oldConfig.loadConfig(env);
    assert.equal(first.port, 6001);
    assert.equal(first.storage, 'memory');
    assert.equal(first.secret, second.secret);
    assert.equal(first.instanceId, second.instanceId);
    assert.throws(() => config.loadConfig({ ...env, N8N_LEGO_PORT: '-1' }), config.ConfigError);
  });
});
test('the real migrated kernel passes the physical-layout rule', () => {
  assert.deepEqual(checkPhysicalLayout(registry, APP_ROOT), []);
});
test('the kernel remains a leaf with zero cross-domain dependencies', () => {
  const kernel = registry.byId.get('platform-kernel');
  assert.deepEqual(kernel.dependsOn, []);
  assert.deepEqual(kernel.paths, ['src/platform-kernel', 'src/config.mjs', 'src/logger.mjs']);
});

for (const [name, file, source] of [
  ['named import', 'src/settings/routes.mjs', "import { loadConfig } from '../platform-kernel/internal/config.mjs';"],
  ['multiline named import', 'src/settings/routes.mjs', "import {\n  loadConfig,\n} from '../platform-kernel/internal/config.mjs';"],
  ['re-export', 'src/settings/routes.mjs', "export { loadConfig } from '../platform-kernel/internal/config.mjs';"],
  ['literal dynamic import', 'src/settings/routes.mjs', "const mod = import('../platform-kernel/internal/config.mjs');"],
  ['composition root', 'src/server.mjs', "import { loadConfig } from './platform-kernel/internal/config.mjs';"],
  ['legacy aggregate', 'src/rest/routes.mjs', "import { loadConfig } from '../platform-kernel/internal/config.mjs';"],
]) {
  test(`external access to private kernel is rejected: ${name}`, () => fixture((root) => {
    plant(root, file, source);
    const errors = runGate({ registry, appRoot: root }).filter((v) => v.file === file);
    assert.ok(errors.some((v) => v.rule === 'R4 internal-import'), JSON.stringify(errors));
  }));
}
test('an allowed consumer can import the canonical public contract', () => fixture((root) => {
  const file = 'src/settings/routes.mjs';
  plant(root, file, "import { loadConfig } from '../platform-kernel/contract/config.mjs';");
  assert.deepEqual(runGate({ registry, appRoot: root }).filter((v) => v.file === file), []);
}));
test('multiline contract imports and re-exports are scanned', () => {
  const imports = extractImports("import {\n a,\n b,\n} from './one.mjs';\nexport {\n c,\n} from './two.mjs';");
  assert.deepEqual(imports.map((i) => i.specifier), ['./one.mjs', './two.mjs']);
});
for (const [name, source] of [
  ['duplicate implementation', 'export function loadConfig() { return {}; }'],
  ['side effect', "console.log('unexpected');\nexport { loadConfig } from './platform-kernel/contract/config.mjs';"],
  ['private re-export', "export { loadConfig } from './platform-kernel/internal/config.mjs';"],
  ['wildcard surface', "export * from './platform-kernel/contract/config.mjs';"],
]) {
  test(`compatibility shim cannot contain ${name}`, () => fixture((root) => {
    plant(root, 'src/config.mjs', source);
    assert.ok(checkPhysicalLayout(registry, root).some((v) => v.file === 'src/config.mjs'));
  }));
}
test('implementation cannot creep back into the physical root outside internal/', () => fixture((root) => {
  plant(root, 'src/platform-kernel/leaked.mjs', 'export const leak = true;');
  assert.ok(checkPhysicalLayout(registry, root).some((v) => v.file === 'src/platform-kernel/leaked.mjs'));
}));
test('physical ownership cannot expand to an unrelated file', () => fixture((root) => {
  const changed = structuredClone(registry);
  changed.domains.find((d) => d.id === 'platform-kernel').paths.push('src/unrelated.mjs');
  assert.ok(checkPhysicalLayout(changed, root).some((v) => v.message.includes('escapes physical root')));
}));
test('private files cannot be declared as public to bypass the boundary', () => fixture((root) => {
  const changed = structuredClone(registry);
  changed.domains.find((d) => d.id === 'platform-kernel').public.push('src/platform-kernel/internal/config.mjs');
  assert.ok(checkPhysicalLayout(changed, root).some((v) => v.message.includes('outside contract root')));
}));
test('missing implementation directory fails closed', () => fixture((root) => {
  rmSync(join(root, 'src/platform-kernel/internal'), { recursive: true });
  assert.ok(checkPhysicalLayout(registry, root).some((v) => v.message.includes('missing/non-directory')));
}));
test('runtime consumers use canonical contracts rather than compatibility shims', () => {
  for (const file of ['src/server.mjs', 'src/engine.mjs', 'src/frontend.mjs', 'src/compat/api-key-scopes.mjs', 'src/compat/scopes.mjs', 'bin/n8n-lego.mjs']) {
    for (const { specifier } of extractImports(readFileSync(join(APP_ROOT, file), 'utf8'))) {
      const target = resolve(dirname(join(APP_ROOT, file)), specifier);
      assert.notEqual(target, join(APP_ROOT, 'src/config.mjs'), file);
      assert.notEqual(target, join(APP_ROOT, 'src/logger.mjs'), file);
    }
  }
});
