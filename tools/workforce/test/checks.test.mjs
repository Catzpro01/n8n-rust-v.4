// Self-hosted-only CI check classification and exhaustion verdict tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChecks, formatChecks } from '../src/checks.mjs';

const self = (name, status = 'queued', conclusion = null, labels = ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust']) => ({
  name, status, conclusion, labels,
});
const nonSelfHosted = (name, conclusion = 'success', status = 'completed') => ({
  name, status, conclusion, labels: ['hosted-runner'],
});

test('all-green self-hosted checks derive ALL_GREEN and allow merge without any hosted check', () => {
  const jobs = [
    self('Backend LEGO architecture gate (P2.6)', 'completed', 'success'),
    self('Unit + integration tests and release package', 'completed', 'success'),
    self('Clean clone -> start -> health -> browser smoke -> restart', 'completed', 'success'),
    self('Windows worker portability probe', 'completed', 'skipped'),
  ];
  const c = classifyChecks(jobs, { onlineRunners: [] });
  assert.equal(c.verdict, 'ALL_GREEN');
  assert.equal(c.exhaustionState, 'NONE');
  assert.equal(c.mergeAllowed, true);
  assert.equal(c.hostedFallbackAllowed, false);
  assert.deepEqual(c.selfHosted.pass.length, 4);
  assert.equal(
    formatChecks(c),
    'Self-hosted: PASS 4/4 | Hosted fallback: disabled | Merge: ALL_GREEN',
  );
});

test('self-hosted exhaustion is explicit WAITING_RUNNER / BLOCKED_WITH_EVIDENCE and never allows merge or hosted fallback', () => {
  const jobs = [
    self('architecture', 'completed', 'success'),
    self('validation'),
    self('Windows worker portability probe'),
  ];
  // No online runner can take the queued self-hosted jobs: explicit WAITING_RUNNER / BLOCKED_WITH_EVIDENCE.
  let c = classifyChecks(jobs, { onlineRunners: [] });
  assert.equal(c.verdict, 'WAITING_RUNNER');
  assert.equal(c.exhaustionState, 'BLOCKED_WITH_EVIDENCE');
  assert.equal(c.mergeAllowed, false, 'WAITING_RUNNER must never claim PASS or allow merge');
  assert.equal(c.hostedFallbackAllowed, false);
  assert.deepEqual(c.deferredRunnerChecks, ['Windows worker portability probe', 'validation']);
  assert.match(c.reasons[0], /WAITING_RUNNER \/ BLOCKED_WITH_EVIDENCE \(not PASS\)/);
  assert.equal(
    formatChecks(c),
    'Self-hosted: WAITING_RUNNER (BLOCKED_WITH_EVIDENCE) 1/3 (Windows worker portability probe, validation) | Hosted fallback: disabled | Merge: WAITING_RUNNER',
  );

  // Even if a non-self-hosted check passed alongside queued self-hosted checks, hosted fallback is never used.
  c = classifyChecks([nonSelfHosted('external-status'), self('validation')], { onlineRunners: [] });
  assert.equal(c.verdict, 'WAITING_RUNNER');
  assert.equal(c.exhaustionState, 'BLOCKED_WITH_EVIDENCE');
  assert.equal(c.mergeAllowed, false, 'passing hosted check must never substitute for a queued self-hosted job');

  // Matching online runner exists -> job is about to run, so PENDING (not WAITING_RUNNER).
  c = classifyChecks(jobs, {
    onlineRunners: [{ labels: [{ name: 'self-hosted' }, { name: 'Windows' }, { name: 'X64' }, { name: 'rust-build' }, { name: 'n8n-rust' }] }],
  });
  assert.equal(c.verdict, 'PENDING');
  assert.equal(c.exhaustionState, 'NONE');
  assert.equal(c.mergeAllowed, false);

  // Runner inventory not supplied -> conservative PENDING (never claims WAITING_RUNNER without evidence).
  assert.equal(classifyChecks(jobs).verdict, 'PENDING');
});

test('failures, running jobs, empty heads, and hosted-only checks never allow merge', () => {
  assert.equal(classifyChecks([self('gate', 'in_progress', null)], { onlineRunners: [] }).verdict, 'PENDING');
  assert.equal(classifyChecks([self('gate', 'completed', 'failure')], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([nonSelfHosted('lint', 'failure'), self('v', 'completed', 'success')], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([], { onlineRunners: [] }).verdict, 'BLOCKED');

  // Hosted-only checks with zero self-hosted checks must be BLOCKED.
  const hostedOnly = classifyChecks([nonSelfHosted('gate', 'success')], { onlineRunners: [] });
  assert.equal(hostedOnly.verdict, 'BLOCKED');
  assert.equal(hostedOnly.mergeAllowed, false);
  assert.match(hostedOnly.reasons[0], /GitHub-hosted runners are not repository CI capacity/);
});
