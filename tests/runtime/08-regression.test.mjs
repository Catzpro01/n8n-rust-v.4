/**
 * 08-regression — anti engine-kedua, envelope stabil, locale additive-only,
 * Rust/reference tak tersentuh, nol dep runtime. Sebagian statis (baca file),
 * sebagian melawan runtime nyata.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, httpGet, httpPost, spawnServer } from './helpers.mjs';

function srcFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(`${ROOT}/apps/n8n-ts/src`);
  return out;
}

describe('regression: tanpa engine kedua (statis)', () => {
  it('tidak ada loop BFS / execution store duplikat di apps/n8n-ts/src', () => {
    const hits = [];
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const marker of ['while (queue.length', 'executionData.set', 'visited.add(']) {
        if (text.includes(marker)) hits.push(`${file}: ${marker}`);
      }
    }
    assert.deepEqual(hits, [], 'tanda engine kedua ditemukan — runtime harus delegasi ke adapter');
  });

  it('runWorkflow hanya disebut di engine.ts (delegasi adapter)', () => {
    const callers = srcFiles().filter((f) => readFileSync(f, 'utf8').includes('runWorkflow'));
    assert.deepEqual(
      callers.map((f) => f.replace(`${ROOT}/`, '')),
      ['apps/n8n-ts/src/engine.ts'],
    );
  });

  it('engine.ts memuat adapter beku Worker 4', () => {
    const text = readFileSync(`${ROOT}/apps/n8n-ts/src/engine.ts`, 'utf8');
    assert.match(text, /ts-runtime-adapter\.mjs/);
  });

  it('tanpa framework HTTP (node:http saja)', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /from ['"]express|require\(['"]express|fastify|koa|hono/i, file);
    }
  });

  it('dependencies runtime NOL', () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}/apps/n8n-ts/package.json`, 'utf8'));
    assert.deepEqual(pkg.dependencies ?? {}, {});
  });
});

describe('regression: forbidden paths tak tersentuh', () => {
  it('crates/**, apps/n8n-rust/**, reference/n8n/** nol diff vs main', { skip: process.env.SKIP_GIT_CHECKS === '1' }, async (t) => {
    const refs = ['origin/main', 'main'];
    let base = null;
    for (const ref of refs) {
      try {
        execFileSync('git', ['rev-parse', '--verify', ref], { cwd: ROOT, stdio: 'pipe' });
        base = ref;
        break;
      } catch {
        // coba ref berikutnya
      }
    }
    if (!base) {
      t.skip('ref main tidak tersedia (bukan git checkout penuh)');
      return;
    }
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['diff', '--name-only', `${base}...HEAD`, '--', 'crates', 'apps/n8n-rust', 'reference/n8n'],
        { cwd: ROOT, encoding: 'utf8' },
      ).trim();
    } catch (err) {
      t.skip(`git diff gagal: ${String(err).slice(0, 120)}`);
      return;
    }
    assert.equal(out, '', `forbidden paths berubah:\n${out}`);
  });
});

describe('regression: envelope + locale (nyata)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  it('GET / keys stabil persis', async () => {
    const r = await httpGet(srv.baseUrl, '/');
    assert.deepEqual(Object.keys(r.json).sort(), ['endpoints', 'name', 'status', 'version']);
  });

  it('locale tak dikenal → 200 + machine fields utuh (additive-only)', async () => {
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', {
      body: {
        workflow: { nodes: [{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }] },
        locale: 'xx-unknown',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.status, 'COMPLETED');
    assert.equal(r.json.data.executionLog[0].node, 'Start');
    assert.equal(r.json.data.executionLog[0].type, 'n8n-nodes-base.manualTrigger');
    assert.equal(r.json.data.data.Start[0].json.status, 'ACTIVE');
  });
});
