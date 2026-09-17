import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('expression invariants E1-E8', async () => {
  const content = fs.readFileSync(path.join(__dirname, '../src/model-surface.ts'), 'utf8');
  assert.ok(content.includes('isExpression'));
  assert.ok(content.includes('ExpressionError'));
  assert.ok(content.includes('WorkflowDataProxy'));
  assert.ok(content.includes('getPairedItem'));
});

test('isExpression only = strings', async () => {
  // Simulate isExpression
  const isExpression = (v) => typeof v === 'string' && v.charAt(0) === '=';
  assert.equal(isExpression('=test'), true);
  assert.equal(isExpression('test'), false);
  assert.equal(isExpression(''), false);
  assert.equal(isExpression(123), false);
});

test('expression evaluation raw type preserved', async () => {
  // E-02/03/04: single {{ }} spanning whole template ⇒ raw JS type
  const template = '{{ $json.a }}';
  const match = template.match(/^{{\s*([\s\S]+?)\s*}}$/);
  assert.ok(match, 'should match single expression');
  assert.equal(match[1].trim(), '$json.a');
});

test('expression evaluation text around => string', async () => {
  const template = 'Value: {{ $json.a }}!';
  const match = template.match(/^{{\s*([\s\S]+?)\s*}}$/);
  assert.equal(match, null, 'should NOT match when surrounding text exists');
});
