/**
 * Integration smoke — fixtures REFERENCE n8n (02-one-node, 03-linear) dieksekusi
 * lewat runtime TS nyata. File integrasi baseline SATU-SATUNYA (Worker 3);
 * file integrasi existing (python) tidak disentuh.
 * Jalankan: node --test tests/integration/ts-baseline-smoke.test.mjs
 */
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, httpPost, spawnServer } from '../runtime/helpers.mjs';

function referenceWorkflow(name) {
  return JSON.parse(readFileSync(`${ROOT}/tests/reference/${name}/workflow.json`, 'utf8'));
}

describe('ts-baseline integration smoke (nyata + reference fixtures)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  it('02-one-node → COMPLETED', async () => {
    const workflow = referenceWorkflow('02-one-node');
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: { workflow } });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.status, 'COMPLETED');
    assert.equal(r.json.data.executionLog.length, 1);
    // nama node referensi dipertahankan byte-persis (termasuk unicode quotes)
    assert.equal(r.json.data.executionLog[0].node, 'When clicking ‘Test step’');
  });

  it('03-linear (manualTrigger → code) → COMPLETED, code di-skip aman', async () => {
    const workflow = referenceWorkflow('03-linear');
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: { workflow } });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.json.data.executionLog.map((e) => e.node),
      ['Manual Trigger', 'Code'],
    );
    // jsCode referensi TIDAK dieksekusi di baseline — marker eksplisit:
    assert.equal(r.json.data.data.Code[0].json.codeSkipped, true);
  });

  it('01-empty-workflow → 400 EMPTY_WORKFLOW', async () => {
    const workflow = referenceWorkflow('01-empty-workflow');
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: { workflow } });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'EMPTY_WORKFLOW');
  });
});
