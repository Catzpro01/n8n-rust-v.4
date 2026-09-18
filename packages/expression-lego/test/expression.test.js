'use strict';
/**
 * Golden test for @lego/expression (Agent 4).
 * Runs every tests/reference/expression/<case>/case.json against our port and
 * compares the result against expected.json.
 *
 * Mirrors the shape of tests/reference/harness/run.js but drives our own
 * implementation instead of n8n-workflow.
 */
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Expression, ExpressionError, ApplicationError } = require('../src');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CASES_DIR = path.join(ROOT, 'tests', 'reference', 'expression');

// Minimal Workflow facade providing the surface Expression needs.
class MiniWorkflow {
	constructor(wfJson) {
		this.id = wfJson.id ?? 'ref';
		this.name = wfJson.name ?? 'ref';
		this.active = !!wfJson.active;
		this.nodes = (wfJson.nodes || []).map((n) => ({ ...n, typeVersion: n.typeVersion ?? 1 }));
		this.connections = wfJson.connections || {};
		this.settings = wfJson.settings || {};
		this.pinData = wfJson.pinData || null;
		this._nodeMap = new Map(this.nodes.map((n) => [n.name, n]));
	}
	getNode(name) { return this._nodeMap.get(name); }
	getPinDataOfNode(name) { return this.pinData && this.pinData[name]; }
	// Graph helpers used by data proxy:
	getNodeConnectionIndexes(activeNodeName, parentNodeName /*, type*/) {
		// Returns { sourceIndex: <int> } based on adjacency.
		// Search connections[parent].main[i] for connection to activeNodeName.
		const c = this.connections[parentNodeName];
		if (!c || !c.main) return { sourceIndex: 0 };
		for (let i = 0; i < c.main.length; i++) {
			const arr = c.main[i];
			if (arr && arr.some((x) => x.node === activeNodeName)) return { sourceIndex: i };
		}
		return { sourceIndex: 0 };
	}
}

function createRunExecutionDataShape(runData) {
	// Our proxy accepts both raw runData maps and the real shape.
	return { resultData: { runData: runData || {} } };
}

function errorToJson(e) {
	const out = { error: e.constructor.name, message: e.message };
	if (e.context) {
		for (const k of ['type', 'descriptionKey', 'nodeCause', 'parameter', 'itemIndex', 'runIndex']) {
			if (e.context[k] !== undefined) out[k] = e.context[k];
		}
	}
	return out;
}

function runCase(c) {
	const workflow = new MiniWorkflow(c.workflow);
	const expr = new Expression(workflow);
	const defaultRunData = c.runData === null ? null : createRunExecutionDataShape(c.runData);
	const out = {};
	for (const probe of c.probes) {
		const runExecutionData = probe._runDataNull ? null : defaultRunData;
		const connectionInputData = probe.connectionInputData ?? c.connectionInputData ?? [];
		const executeData = probe.executeData === null ? undefined : (probe.executeData ?? c.executeData);
		const activeNodeName = probe.activeNodeName ?? c.activeNodeName;
		let executeDataForExpr = executeData ? { ...executeData, node: workflow.getNode(activeNodeName) } : undefined;
		let value;
		try {
			const v = expr.getParameterValue(
				probe.value,
				runExecutionData,
				probe.runIndex ?? c.runIndex ?? 0,
				probe.itemIndex ?? 0,
				activeNodeName,
				connectionInputData,
				probe.mode ?? c.mode ?? 'manual',
				c.additionalKeys ?? {},
				executeDataForExpr,
			);
			if (v === undefined) {
				value = { undefined: true };
			} else {
				value = JSON.parse(JSON.stringify(v));
			}
		} catch (e) {
			value = errorToJson(e);
		}
		out[probe.name] = value;
	}
	return out;
}

function diff(a, b, p = '') {
	if (a === null && b === null) return [];
	if (a === undefined && b === undefined) return [];
	if (JSON.stringify(a) === JSON.stringify(b)) return [];
	if (typeof a !== typeof b) {
		// undefined in expected == { undefined: true } wrapper
		if (b && typeof b === 'object' && 'undefined' in b && b.undefined === true && a === undefined) return [];
		if (a && typeof a === 'object' && 'undefined' in a && a.undefined === true && b === undefined) return [];
		return [`${p || '<root>'}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`];
	}
	if (typeof a !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
		return [`${p || '<root>'}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`];
	}
	const out = [];
	const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
	for (const k of keys) {
		const av = a ? a[k] : undefined;
		const bv = b ? b[k] : undefined;
		// Special-case { undefined: true } === undefined
		if (av && typeof av === 'object' && 'undefined' in av && av.undefined === true && bv === undefined) continue;
		if (bv && typeof bv === 'object' && 'undefined' in bv && bv.undefined === true && av === undefined) continue;
		// Error messages are matched loosely (message substring).
		if (av && av.error && bv && bv.error) {
			if (av.error !== bv.error) { out.push(`${p}.${k}.error: expected ${av.error} got ${bv.error}`); continue; }
			if (av.message && bv.message && !bv.message.includes(av.message)) {
				out.push(`${p}.${k}.message: expected "${av.message}" got "${bv.message}"`);
			}
			for (const f of ['type', 'descriptionKey', 'nodeCause']) {
				if (av[f] !== undefined && bv[f] !== av[f]) {
					out.push(`${p}.${k}.${f}: expected ${av[f]} got ${bv[f]}`);
				}
			}
			continue;
		}
		out.push(...diff(av, bv, p ? `${p}.${k}` : k));
	}
	return out;
}

const cases = fs.readdirSync(CASES_DIR).filter((n) => fs.statSync(path.join(CASES_DIR, n)).isDirectory()).sort();

for (const name of cases) {
	test(`expression/${name}`, () => {
		const c = JSON.parse(fs.readFileSync(path.join(CASES_DIR, name, 'case.json'), 'utf8'));
		const expected = JSON.parse(fs.readFileSync(path.join(CASES_DIR, name, 'expected.json'), 'utf8'));
		const observed = runCase(c);
		const failures = diff(expected, observed);
		if (failures.length) {
			assert.fail('\n  ' + failures.join('\n  '));
		}
	});
}
