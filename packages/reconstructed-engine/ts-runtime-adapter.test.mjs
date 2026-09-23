/**
 * Test adapter baseline (Worker 4). Tanpa server — langsung ke adapter + engine.
 * Jalankan: node --test packages/reconstructed-engine/ts-runtime-adapter.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_KNOWN_NODE_TYPES,
  createBaselineEngine,
  validateBaselineWorkflow,
} from './ts-runtime-adapter.mjs';

describe('ts-runtime-adapter: BASELINE_KNOWN_NODE_TYPES', () => {
  it('memuat 5 handler bawaan kontrak §4', () => {
    assert.deepEqual(
      [...BASELINE_KNOWN_NODE_TYPES].sort(),
      [
        'n8n-nodes-base.code',
        'n8n-nodes-base.if',
        'n8n-nodes-base.manualTrigger',
        'n8n-nodes-base.noOp',
        'n8n-nodes-base.set',
      ].sort(),
    );
  });
});

describe('ts-runtime-adapter: validateBaselineWorkflow', () => {
  it('menerima workflow minimal valid', () => {
    const r = validateBaselineWorkflow({
      nodes: [{ name: 'Start', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
      connections: {},
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
  });

  it('menolak workflow hilang / bukan object', () => {
    for (const bad of [undefined, null, 42, 'x', [], [{ nodes: [] }]]) {
      const r = validateBaselineWorkflow(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.errors[0].hint, 'MALFORMED_REQUEST');
    }
  });

  it('menolak nodes bukan array', () => {
    const r = validateBaselineWorkflow({ nodes: 'bukan-array' });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].hint, 'MALFORMED_REQUEST');
  });

  it('menolak nodes kosong dengan EMPTY_WORKFLOW', () => {
    const r = validateBaselineWorkflow({ nodes: [] });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].hint, 'EMPTY_WORKFLOW');
    assert.match(r.errors[0].message, /no nodes/i);
  });

  it('menolak node tanpa name/type valid', () => {
    const r = validateBaselineWorkflow({ nodes: [{ name: '', type: '' }] });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].hint, 'MALFORMED_REQUEST');
    assert.match(r.errors[0].message, /index 0/);
  });

  it('menolak nama duplikat', () => {
    const r = validateBaselineWorkflow({
      nodes: [
        { name: 'A', type: 'n8n-nodes-base.noOp' },
        { name: 'A', type: 'n8n-nodes-base.noOp' },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].hint, 'MALFORMED_REQUEST');
    assert.match(r.errors[0].message, /Duplicate/);
  });

  it('menolak koneksi dangling (target tak ada)', () => {
    const r = validateBaselineWorkflow({
      nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp' }],
      connections: { A: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].hint, 'UNKNOWN_NODE');
  });

  it('menolak startNode yang tak ada', () => {
    const r = validateBaselineWorkflow(
      { nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp' }] },
      { startNode: 'Ghost' },
    );
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].hint, 'UNKNOWN_NODE');
  });

  it('tidak pernah throw untuk input absurd', () => {
    const absurd = [
      { nodes: [null, 42, { name: 'A' }], connections: 42 },
      { nodes: [{ name: 'A', type: 't' }], connections: { A: { main: 'nope' } } },
      { nodes: [{ name: 'A', type: 't' }], connections: { Nope: { main: [] } } },
    ];
    for (const w of absurd) {
      const r = validateBaselineWorkflow(w);
      assert.equal(r.ok, false);
      assert.ok(r.errors.length > 0);
    }
  });
});

describe('ts-runtime-adapter: createBaselineEngine', () => {
  it('menjalankan rantai linear dan COMPLETED', async () => {
    const engine = createBaselineEngine(
      {
        nodes: [
          { name: 'Start', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step', type: 'n8n-nodes-base.noOp', parameters: {} },
        ],
        connections: { Start: { main: [[{ node: 'Step', type: 'main', index: 0 }]] } },
      },
      { locale: 'id' },
    );
    const result = await engine.runWorkflow();
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.finished, true);
    assert.equal(result.executionLog.length, 2);
    assert.ok(result.data.Start);
    assert.ok(result.data.Step);
  });

  it('unknown type = passthrough 200 (bukan error)', async () => {
    const engine = createBaselineEngine({
      nodes: [{ name: 'Weird', type: 'custom.unknownType', parameters: {} }],
    });
    const result = await engine.runWorkflow('Weird', [{ hello: 'world' }]);
    assert.equal(result.status, 'COMPLETED');
    assert.deepEqual(result.data.Weird, [{ json: { hello: 'world' } }]);
  });

  it('code node tidak dieksekusi, diberi marker', async () => {
    const engine = createBaselineEngine({
      nodes: [
        {
          name: 'Code',
          type: 'n8n-nodes-base.code',
          parameters: { jsCode: 'while(true){} // jahat' },
        },
      ],
    });
    const result = await engine.runWorkflow('Code', [{ a: 1 }]);
    assert.equal(result.data.Code[0].json.codeSkipped, true);
    assert.equal(result.data.Code[0].json.a, 1);
  });

  it('locale tak dikenal fallback tanpa error + machine fields utuh', async () => {
    const engine = createBaselineEngine(
      { nodes: [{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }] },
      { locale: 'xx-unknown' },
    );
    const result = await engine.runWorkflow();
    assert.equal(result.status, 'COMPLETED');
    // machine fields tidak berubah oleh locale layer
    assert.equal(result.executionLog[0].node, 'Start');
    assert.equal(result.executionLog[0].type, 'n8n-nodes-base.manualTrigger');
  });
});
