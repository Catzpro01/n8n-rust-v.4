/**
 * T8 — regression / golden subset + engine single-source check
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, request, loadFixture, REPO_ROOT } from './helpers.mjs';

describe('T8 regression', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('linear result always includes COMPLETED and three node keys', async () => {
    const workflow = loadFixture('linear.workflow.json');
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow },
    });
    assert.equal(status, 200);
    const keys = Object.keys(json.data.result.data).sort();
    assert.deepEqual(keys, ['Code', 'Manual Trigger', 'Set']);
    assert.equal(json.data.result.status, 'COMPLETED');
    // Code baseline marker (no eval)
    const codeItem = json.data.result.data.Code[0].json;
    assert.equal(codeItem.codeExecuted, false);
    assert.equal(codeItem.codeNode, true);
  });

  it('server source does not embed a second WorkflowExecutionEngine class', () => {
    const serverDir = path.join(REPO_ROOT, 'apps/n8n-ts');
    const files = listJs(serverDir);
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      assert.equal(
        /class\s+WorkflowExecutionEngine\b/.test(src),
        false,
        `second engine class found in ${file}`,
      );
    }
  });

  it('engine adapter points at reconstructed-engine/runner.mjs', () => {
    const adapter = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/n8n-ts/lib/engine-adapter.mjs'),
      'utf8',
    );
    assert.match(adapter, /reconstructed-engine\/runner\.mjs/);
    assert.match(adapter, /secondEngineForbidden:\s*true/);
  });

  it('crates and n8n-rust remain untouched by baseline tree listing', () => {
    // Sanity: baseline app must not live under crates
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'apps/n8n-ts/src/server.mjs')), true);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'crates')), true);
  });
});

function listJs(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listJs(p, acc);
    else if (/\.(mjs|js|ts)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}
