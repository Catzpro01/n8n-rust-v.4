#!/usr/bin/env node
/**
 * Backend LEGO architecture gate (P2.6) — CLI.
 *
 *   node tools/lego/architecture-gate.mjs             # human report, exit 1 on violation
 *   node tools/lego/architecture-gate.mjs --json      # machine report
 *   node tools/lego/architecture-gate.mjs --selftest  # prove the gate catches real violations
 *
 * Isolation is only real when a machine checks it. The rules themselves live in
 * `architecture-gate.core.mjs`; this file is the entry point CI calls.
 * Every violation names the rule, the file, the line and the fix — the gate is
 * a boundary teacher, not just a wall.
 */
import { loadRegistry } from '../../apps/n8n-lego/src/lego/registry.mjs';
import { runGate, formatReport } from './architecture-gate.core.mjs';
import { runSelftest, runNegativeControl } from './architecture-gate.selftest.mjs';

const args = process.argv.slice(2);

if (args.includes('--selftest')) {
  const results = runSelftest();
  for (const result of results) {
    process.stdout.write(`${result.detected ? 'PASS' : 'FAIL'}  ${result.name} (expects ${result.expectedRule})\n`);
  }
  const control = runNegativeControl();
  process.stdout.write(`${control.clean ? 'PASS' : 'FAIL'}  negative control: a correct file raises nothing\n`);
  const failed = results.filter((result) => !result.detected).length + (control.clean ? 0 : 1);
  process.stdout.write(`\nselftest: ${results.length + 1 - failed}/${results.length + 1} checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

const violations = runGate();
if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`);
} else {
  process.stdout.write(formatReport(violations, loadRegistry()));
}
process.exit(violations.length === 0 ? 0 : 1);
