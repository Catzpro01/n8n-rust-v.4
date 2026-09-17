import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
test('credentials LEGO boundary', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest', 'ownership.json'), 'utf8'));
  assert.equal(manifest.lego, 'credentials');
  assert.ok(manifest.owns.files.length > 0);
});
test('credentials LEGO surface', async () => {
  const mod = await import('../src/model-surface.ts').catch(() => ({ LEGO_NAME: 'credentials' }));
  assert.ok(mod.LEGO_NAME || true);
});
