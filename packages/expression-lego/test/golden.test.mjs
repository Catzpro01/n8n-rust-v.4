/**
 * Golden regression gate — Expression LEGO vs observed n8n 2.9.4 runtime.
 *
 * Drives the same probe format as tests/reference/harness/run.js
 * (runExpressionCase) against THIS reconstruction and compares to the
 * machine-recorded expected.json snapshots (never hand-written).
 *
 *   node --test test/golden.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Expression, WorkflowGraphAdapter } from '../index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_ROOT = path.resolve(__dirname, '../../../tests/reference/expression');

/** tests/reference/harness/harness.js errorToJson */
function errorToJson(e) {
	const out = { error: e.constructor.name, message: e.message };
	if (e.context) {
		for (const k of ['type', 'descriptionKey', 'nodeCause', 'parameter']) {
			if (e.context[k] !== undefined) out[k] = e.context[k];
		}
	}
	return out;
}

function runExpressionCase(c) {
	// mirror tests/reference/harness/harness.js buildWorkflow defaults
	const workflow = new WorkflowGraphAdapter(
		{
			...c.workflow,
			id: c.workflow.id ?? 'ref',
			name: c.workflow.name ?? 'ref',
			active: false,
			settings: { executionOrder: 'v1', ...(c.workflow.settings || {}) },
			pinData: c.workflow.pinData,
		},
		{ pinData: c.pinData },
	);
	const runExecutionData = c.runData === null ? null : { resultData: { runData: c.runData ?? {} } };
	const expression = workflow.expression;
	const out = {};
	for (const probe of c.probes) {
		const ctx = {
			runExecutionData: probe._runDataNull ? null : runExecutionData,
			runIndex: probe.runIndex ?? c.runIndex ?? 0,
			itemIndex: probe.itemIndex ?? 0,
			activeNodeName: probe.activeNodeName ?? c.activeNodeName,
			connectionInputData: probe.connectionInputData ?? c.connectionInputData ?? [],
			mode: probe.mode ?? c.mode ?? 'manual',
			additionalKeys: c.additionalKeys ?? {},
			executeData: probe.executeData === null ? undefined : (probe.executeData ?? c.executeData),
		};
		if (ctx.executeData && !ctx.executeData.node) {
			ctx.executeData = { ...ctx.executeData, node: workflow.getNode(ctx.activeNodeName) };
		}
		let value;
		try {
			const v = expression.getParameterValue(
				probe.value,
				ctx.runExecutionData,
				ctx.runIndex,
				ctx.itemIndex,
				ctx.activeNodeName,
				ctx.connectionInputData,
				ctx.mode,
				ctx.additionalKeys,
				ctx.executeData,
			);
			value = v === undefined ? { undefined: true } : JSON.parse(JSON.stringify(v));
		} catch (e) {
			value = errorToJson(e);
		}
		out[probe.name] = value;
	}
	return out;
}

/** Same deep-diff semantics as harness run.js diff(). */
function diff(a, b, p = '') {
	const out = [];
	if (JSON.stringify(a) === JSON.stringify(b)) return out;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
		out.push(`${p || '<root>'}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`);
		return out;
	}
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		out.push(...diff(a[k], b[k], p ? `${p}.${k}` : k));
	}
	return out;
}

const caseDirs = fs
	.readdirSync(CASES_ROOT)
	.filter((name) => fs.existsSync(path.join(CASES_ROOT, name, 'case.json')))
	.sort();

for (const name of caseDirs) {
	test(`golden: expression/${name}`, () => {
		const c = JSON.parse(fs.readFileSync(path.join(CASES_ROOT, name, 'case.json'), 'utf8'));
		const expected = JSON.parse(fs.readFileSync(path.join(CASES_ROOT, name, 'expected.json'), 'utf8'));
		assert.ifError(expected.UNKNOWN);
		const observed = runExpressionCase(c);
		const d = diff(expected, observed);
		assert.deepEqual(d, [], `probe mismatches:\n${d.map((l) => `  ${l}`).join('\n')}`);
	});
}
