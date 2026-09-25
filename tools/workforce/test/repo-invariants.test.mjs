// Repository-level invariants for the workforce control plane (DEC-0002, DEC-0004).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../src/schema.mjs';
import { checkDecisionRecords, main } from '../src/cli.mjs';

const git = (...args) => { try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

test('DEC-0004: gateway token files are never tracked', (t) => {
  const tracked = git('ls-files', '--', '.arena/gateway_tokens.json', '.arena/workforce-state');
  if (tracked === null) { t.skip('not a git checkout'); return; }
  assert.equal(tracked.trim(), '');
  const ignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.arena\/gateway_tokens\.json$/m);
  assert.match(ignore, /^\.arena\/workforce-state\/$/m);
});

test('workforce control plane stays out of the product manifests and product code', () => {
  for (const f of ['apps/n8n-lego/data/domains.json', 'apps/n8n-lego/data/ai-lego-set.json', 'docs/n8n-lego/ai-lego-set.json']) {
    const p = join(REPO_ROOT, f);
    if (existsSync(p)) assert.doesNotMatch(readFileSync(p, 'utf8'), /tools\/workforce|engineering-operations\/workforce/, f);
  }
  const src = join(REPO_ROOT, 'tools', 'workforce', 'src');
  for (const f of readdirSync(src)) assert.doesNotMatch(readFileSync(join(src, f), 'utf8'), /from ['"][./]*\/?apps\/|n8n-lego\/src/, `${f} must not import product code`);
});

test('no secret-like material in workforce sources, policy or decisions', () => {
  const roots = [join(REPO_ROOT, 'tools', 'workforce'), join(REPO_ROOT, 'docs', 'engineering-operations', 'workforce')];
  const pat = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else assert.doesNotMatch(readFileSync(p, 'utf8'), pat, p); } };
  for (const r of roots) walk(r);
});

test('canonical decision records are schema-valid and consistent', () => {
  const r = checkDecisionRecords();
  assert.deepEqual(r.problems, []);
  const ids = r.records.map((d) => d.objectId);
  for (const id of ['DEC-0001', 'DEC-0002', 'DEC-0003', 'DEC-0004', 'DEC-0005', 'DEC-0006', 'DEC-0007', 'DEC-0008']) assert.ok(ids.includes(id), id);
  const d5 = r.records.find((d) => d.objectId === 'DEC-0005');
  assert.match(JSON.stringify(d5), /AVAILABLE/, 'DEC-0005 records the AgentState release-edge amendment');
  assert.ok(ids.includes('DEC-0009'), 'DEC-0009 records the Manager credential mechanism');
  for (const d of r.records.filter((x) => x.promotion.canonical)) {
    assert.match(d.promotion.mainCommitSha, /^[0-9a-f]{40}$/, `${d.objectId}: canonical needs the main commit SHA`);
    assert.equal(d.promotion.mainPath, `docs/engineering-operations/workforce/decisions/${d.objectId}.json`, `${d.objectId}: mainPath`);
    assert.ok(d.sources.issues.length || d.sources.prs.length, `${d.objectId}: canonical needs provenance`);
  }
  assert.ok(ids.includes('DEC-0011'), 'DEC-0011 records the Manager-executed completion path');
  const d14 = r.records.find((d) => d.objectId === 'DEC-0014');
  assert.ok(d14 && d14.state === 'ACTIVE' && d14.authority.decidedBy === 'OWNER' && d14.sources.issues.includes(282), 'DEC-0014 records the owner Slice delivery rule (#282)');
  const d15 = r.records.find((d) => d.objectId === 'DEC-0015');
  assert.ok(d15 && d15.state === 'ACTIVE' && d15.authority.decidedBy === 'OWNER' && d15.sources.issues.includes(285) && d15.selectedOption.startsWith('B-'), 'DEC-0015 records the owner two-phase rule, model B (#285)');
  for (const d of r.records) assert.ok(Date.parse(d.createdAt) <= Date.parse(d.updatedAt), `${d.objectId}: createdAt <= updatedAt`);
  for (const d of r.records.filter((x) => x.promotion.canonical)) assert.ok(Date.parse(d.createdAt) <= Date.parse(d.promotion.promotedAt), `${d.objectId}: created before promotion`);
  for (const id of ['DEC-0001', 'DEC-0002', 'DEC-0003', 'DEC-0004', 'DEC-0005', 'DEC-0006', 'DEC-0007', 'DEC-0008', 'DEC-0009', 'DEC-0010', 'DEC-0011', 'DEC-0012', 'DEC-0013', 'DEC-0014']) {
    assert.equal(r.records.find((d) => d.objectId === id).promotion.canonical, true, `${id} promoted canonical`);
  }
});

test('cli: validate-policy and decisions-check succeed; unknown command is a usage error', () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: () => {} };
  assert.equal(main(['validate-policy'], io), 0);
  assert.equal(main(['decisions-check'], io), 0);
  assert.equal(main(['frobnicate'], io), 2);
});
