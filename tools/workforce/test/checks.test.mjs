// DEC-0015 merge verdict: GitHub-hosted vs self-hosted checks on the exact PR head.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChecks, formatChecks } from '../src/checks.mjs';

test('check classifier: hosted green + self-hosted queued with no online runner = ALLOWED_BY_DEC-0015 (not PASS)', () => {
  const hosted = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion, labels: ['ubuntu-latest'] });
  const self = (name, status = 'queued', conclusion = null, labels = ['self-hosted', 'windows', 'x64']) => ({ name, status, conclusion, labels });
  const jobs = [hosted('gate'), hosted('architecture'), self('Windows worker portability probe'), self('validation', 'queued', null, ['self-hosted', 'linux', 'x64'])];
  let c = classifyChecks(jobs, { onlineRunners: [] });
  assert.equal(c.verdict, 'ALLOWED_BY_DEC-0015');
  assert.equal(c.mergeAllowed, true);
  assert.deepEqual(c.deferredRunnerChecks, ['Windows worker portability probe', 'validation']);
  assert.equal(formatChecks(c), 'GitHub-hosted: PASS 2/2 | Self-hosted: WAITING_RUNNER 2 (Windows worker portability probe, validation) | Merge: ALLOWED_BY_DEC-0015');
  // An online runner that matches the labels may still pick it up: wait.
  c = classifyChecks(jobs, { onlineRunners: [{ labels: [{ name: 'self-hosted' }, { name: 'Windows' }, { name: 'X64' }] }] });
  assert.equal(c.verdict, 'PENDING');
  assert.deepEqual(c.selfHosted.waitingRunner, ['validation']);
  // Unknown availability: never assume the runner is gone.
  assert.equal(classifyChecks(jobs).verdict, 'PENDING');
  // Hosted pending, hosted failure, self-hosted failure, nothing ran, only self-hosted.
  assert.equal(classifyChecks([hosted('gate', null, 'in_progress'), self('v')], { onlineRunners: [] }).verdict, 'PENDING');
  assert.equal(classifyChecks([hosted('gate', 'failure'), self('v')], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([hosted('gate'), self('v', 'completed', 'failure')], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([self('v')], { onlineRunners: [] }).verdict, 'BLOCKED');
  // Everything green, skipped jobs are not failures.
  c = classifyChecks([hosted('gate'), hosted('fork-only', 'skipped'), self('v', 'completed', 'success')], { onlineRunners: [] });
  assert.equal(c.verdict, 'ALL_GREEN');
  assert.deepEqual(c.deferredRunnerChecks, []);
});
