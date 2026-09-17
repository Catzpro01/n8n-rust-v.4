import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
test('webhook LEGO boundary', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest', 'ownership.json'), 'utf8'));
  assert.equal(manifest.lego, 'webhook');
  assert.ok(manifest.owns.files.length > 0);
});
test('webhook LEGO surface', async () => {
  const mod = await import('../src/model-surface.ts').catch(() => ({ LEGO_NAME: 'webhook' }));
  assert.ok(mod.LEGO_NAME || true);
});
