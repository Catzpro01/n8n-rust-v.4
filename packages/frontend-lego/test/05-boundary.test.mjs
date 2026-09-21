/**
 * I6/I7 — the boundary is enforced by machine, not by convention.
 *
 * These are architecture probes: they read the sources (and the app's sources)
 * and fail when a dependency points the wrong way.
 *
 *   F2  contract modules are framework-neutral and browser-safe (no `node:*`)
 *   F3  the framework is named only under `src/adapters/**`
 *   F4  no frontend-LEGO module imports a backend implementation module
 *   F5  the app imports the package through its entry, not into its internals
 *   F8  extension points stay declarative (no hook is implemented in P2.5)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { PACKAGE_ROOT } from '../src/manifests.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const SRC_DIR = join(PACKAGE_ROOT, 'src');
const APP_DIR = join(REPO_ROOT, 'apps', 'n8n-lego');

/** Every `.mjs` file under a directory, recursively. */
function walk(dir, { skip = [] } = {}) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skip.includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, { skip }));
    else if (path.endsWith('.mjs')) out.push(path);
  }
  return out;
}

const PACKAGE_FILES = walk(SRC_DIR).concat([join(PACKAGE_ROOT, 'index.mjs')]);
const rel = (path) => relative(PACKAGE_ROOT, path).split(sep).join('/');

/** Browser-safe modules: the contract surface a future implementation consumes. */
const BROWSER_SAFE = ['contract.mjs', 'errors.mjs', 'i18n.mjs', 'registry.mjs', 'boot.mjs', 'client.mjs'];

test('F2 — contract modules are browser-safe (no node: imports)', () => {
  for (const file of PACKAGE_FILES) {
    const name = file.split(sep).pop();
    if (!BROWSER_SAFE.includes(name)) continue;
    const source = readFileSync(file, 'utf8');
    const nodeImports = [...source.matchAll(/from\s+['"]node:([^'"]+)['"]/g)].map((match) => match[1]);
    assert.deepEqual(nodeImports, [], `${rel(file)} must stay browser-safe for a future implementation`);
  }
  // …and the only Node-only module is the manifest loader.
  const nodeUsers = PACKAGE_FILES.filter((file) => /from\s+['"]node:/.test(readFileSync(file, 'utf8'))).map(rel);
  assert.deepEqual(nodeUsers.sort(), ['src/manifests.mjs'], 'reading catalogs from disk is a boot concern and lives alone');
});

test('F2/F3 — contract modules import no framework and never name one', () => {
  for (const file of PACKAGE_FILES) {
    const source = readFileSync(file, 'utf8');
    const isAdapter = rel(file).startsWith('src/adapters/');
    const isEntry = file === join(PACKAGE_ROOT, 'index.mjs');
    assert.doesNotMatch(source, /from\s+['"]vue['"]/, 'the frontend LEGO never imports the framework it is decoupled from');
    if (isAdapter) continue;
    if (isEntry) {
      // The package entry may re-export the adapter — but only through the
      // adapter module, never by naming framework internals itself.
      const offenders = source
        .split('\n')
        .filter((line) => /vue/i.test(line) && !/^\s*\*/.test(line))
        .filter((line) => !/from '\.\/src\/adapters\//.test(line));
      assert.deepEqual(offenders, [], 'the entry may only re-export the adapter, not speak for it');
      continue;
    }
    assert.equal([...source.matchAll(/vue/gi)].length, 0, `${rel(file)} mentions the current framework — only src/adapters/** may`);
  }
  assert.ok(readFileSync(join(SRC_DIR, 'adapters', 'vue.mjs'), 'utf8').toLowerCase().includes('vue'), 'the adapter is where the framework lives');
});

test('F3 — the swap point is the adapter index, not a framework file', () => {
  const lego = readFileSync(join(SRC_DIR, 'lego.mjs'), 'utf8');
  assert.match(lego, /from '\.\/adapters\/index\.mjs'/);
  assert.doesNotMatch(lego, /vue/i, 'the assembly must stay framework-agnostic');
  const index = readFileSync(join(SRC_DIR, 'adapters', 'index.mjs'), 'utf8');
  assert.match(index, /CURRENT_ADAPTER_ID/, 'the current implementation is named in exactly one place');
});

test('F4 — no frontend-LEGO module imports a backend implementation module', () => {
  for (const file of PACKAGE_FILES) {
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.ok(
        !specifier.includes('apps/') && !specifier.includes('crates/') && !specifier.includes('reconstructed-engine'),
        `${rel(file)} imports the backend implementation (${specifier}) — dependencies must point inward`,
      );
    }
  }
});

test('F5 — the app consumes the package through its entry point only', () => {
  const appSources = walk(join(APP_DIR, 'src'));
  const frontendUsers = appSources.filter((file) => /frontend-lego/.test(readFileSync(file, 'utf8')));
  assert.ok(frontendUsers.length >= 1, 'the app must actually consume the frontend LEGO');
  for (const file of frontendUsers) {
    const source = readFileSync(file, 'utf8');
    // The app may resolve the package root and its entry file. Reaching for a
    // module *inside* the package would make the boundary a suggestion.
    for (const internals of ['frontend-lego/src', 'frontend-lego/manifest', 'frontend-lego/test', 'frontend-lego/package.json']) {
      assert.ok(!source.includes(internals), `${relative(APP_DIR, file)} reaches into the package internals (${internals})`);
    }
  }
  assert.ok(
    frontendUsers.some((file) => /'index\.mjs'/.test(readFileSync(file, 'utf8'))),
    'the app must resolve the package entry (index.mjs), not a directory path it hopes exists',
  );
});

test('F4 — the frontend LEGO does not touch the pinned reference source', () => {
  for (const file of PACKAGE_FILES) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /reference\/n8n/, `${rel(file)} must not depend on the reference checkout`);
  }
});

test('F8 — extension points stay declared: no hook is implemented in P2.5', () => {
  for (const file of PACKAGE_FILES) {
    const source = readFileSync(file, 'utf8');
    for (const [, handler] of source.matchAll(/^(?:export\s+)?function\s+(install[A-Za-z]*|apply[A-Za-z]*Hook)/gm)) {
      assert.fail(`${rel(file)} defines ${handler} — P2.5 declares extension points, it does not run them`);
    }
  }
});

test('the package ships no dictionary and no translated string', () => {
  const NON_LATIN = /['"]([\u0600-\u06FF\u4e00-\u9fff\u0400-\u04ff]{2,})['"]/g;
  // The only non-Latin literals allowed are the locales' own `nativeName`s: they
  // are identity metadata, not translations (a language switcher must show a
  // language in its own script even before a dictionary exists).
  const localeModel = readFileSync(join(SRC_DIR, 'i18n.mjs'), 'utf8');
  const declaredNativeNames = new Set([...localeModel.matchAll(/nativeName:\s*'([^']+)'/g)].map((match) => match[1]));
  assert.ok(declaredNativeNames.size === 6, 'the six locales must each carry a native name');

  for (const file of PACKAGE_FILES) {
    const name = rel(file);
    if (name.includes('test/')) continue;
    const found = [...readFileSync(file, 'utf8').matchAll(NON_LATIN)].map((match) => match[1]);
    const unexpected = found.filter((value) => !(name === 'src/i18n.mjs' && declaredNativeNames.has(value)));
    assert.deepEqual(unexpected, [], `${name} contains a non-Latin literal — dictionaries belong to the Translation LEGO`);
  }
});

test('the app serves the descriptor without patching the stock bundle', () => {
  const ui = readFileSync(join(APP_DIR, 'src', 'ui.mjs'), 'utf8');
  assert.match(ui, /frontend/i, 'the UI module must accept the frontend descriptor');
  assert.match(ui, /metaTag/, 'injection is additive: one meta tag, nothing else');
  for (const forbidden of ['innerHTML =', 'replaceScript', 'rewriteBundle']) {
    assert.ok(!ui.includes(forbidden), `ui.mjs must not rewrite the bundle (${forbidden})`);
  }
});
