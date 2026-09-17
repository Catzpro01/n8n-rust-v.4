/**
 * Gate 05 — port surface coverage.
 *
 * The question this answers is the one a reviewer cannot answer by reading code:
 * "is anything in the reference MISSING here without being declared?". A symbol
 * that is silently absent reads as "not needed"; a symbol that is present but inert
 * reads as "done" — which is worse (CROSS-AGENT-ISSUES ISSUE-016). So every
 * reference symbol must land in exactly one bucket: ported, deferred (raises),
 * out-of-scope, or a declared addition.
 *
 * Offline: asserts the committed manifest against the actual modules — that is the
 * part that runs in `--offline-only` gates and it is what catches undeclared drift.
 * Live: re-derives the reference lists from the installed package and fails if the
 * manifest went stale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { referenceRuntime } from '../src/reference-runtime.mjs';
import { NotPortedError } from '../src/workflow-data-proxy.mjs';

const PKG = resolve(import.meta.dirname, '..');
const surface = JSON.parse(readFileSync(join(PKG, 'manifest', 'port-surface.json'), 'utf8'));
const snapshot = JSON.parse(readFileSync(join(PKG, 'fixtures', 'reference-snapshot.json'), 'utf8'));
const runtime = referenceRuntime();

const load = async (file) => await import(`../src/${file}`);

test('manifest: every bucket is disjoint and complete per module', async () => {
	const problems = [];
	for (const [file, entry] of Object.entries(surface.modules)) {
		const mod = await load(file);
		const mine = Object.keys(mod);
		const declared = new Set([...entry.ported, ...Object.keys(entry.deferred), ...Object.keys(entry.outOfScope), ...Object.keys(entry.additions)]);
		// (1) nothing I export may be undeclared
		for (const name of mine) {
			if (!declared.has(name)) problems.push(`${file}: exports ${name}, which the manifest does not declare`);
		}
		// (2) every reference export must be classified, and `ported` must be real
		for (const name of entry.referenceExports) {
			const bucket = entry.ported.includes(name)
				? 'ported'
				: name in entry.deferred
					? 'deferred'
					: name in entry.outOfScope
						? 'outOfScope'
						: null;
			if (!bucket) {
				problems.push(`${file}: reference export ${name} is in none of the buckets`);
				continue;
			}
			if (bucket === 'ported' && !(name in mod)) {
				problems.push(`${file}: manifest says ${name} is ported but the module does not export it`);
			}
			if (bucket === 'deferred' && name in mod && typeof mod[name] === 'function') {
				// A deferred symbol may exist as a *throwing* accessor (that is how the
				// proxy exposes e.g. $fromAI); it may not exist as something usable.
				try {
					mod[name]();
					problems.push(`${file}: ${name} is declared deferred but calling it returned normally`);
				} catch (error) {
					if (!(error instanceof NotPortedError) && error?.name !== 'NotPortedError') {
						problems.push(`${file}: ${name} is declared deferred but threw ${error.constructor.name}`);
					}
				}
			}
		}
		// (3) a 'complete' module must cover the whole reference surface
		if (entry.scope === 'complete') {
			const uncovered = entry.referenceExports.filter(
				(n) => !(n in entry.outOfScope) && !n.startsWith('$'),
			);
			const missing = uncovered.filter((n) => !entry.ported.includes(n) && !(n in entry.deferred));
			for (const name of missing) problems.push(`${file}: scope=complete but ${name} is unaccounted for`);
		}
	}
	assert.deepEqual(problems, [], 'port-surface.json and src/ disagree');
});

test('manifest: class surfaces match the reference method-for-method', () => {
	const problems = [];
	for (const [name, entry] of Object.entries(surface.classes)) {
		if (!entry.hierarchyMatches) {
			problems.push(
				`${name}: reference extends ${entry.referenceExtends ?? '(nothing)'}, port extends ${entry.portExtends ?? '(nothing)'}`,
			);
		}
		for (const gap of entry.undeclaredGaps) problems.push(`${name}: ${gap} is missing and undeclared`);
		for (const extra of entry.extras) problems.push(`${name}: ${extra} is an undeclared addition`);
	}
	assert.deepEqual(problems, [], 'class surface drifted from the reference');
});

test('expression sandbox: my key set equals the reference key set', () => {
	const { reference, reconstruction } = snapshot.sandboxKeys;
	assert.ok(reference.length >= 40, `reference sandbox key list looks truncated (${reference.length})`);
	const missing = reference.filter((k) => !reconstruction.includes(k));
	const extra = reconstruction.filter((k) => !reference.includes(k));
	assert.deepEqual(missing, [], 'these sandbox keys exist in n8n but not in the port — a workflow using them would see undefined');
	assert.deepEqual(extra, [], 'these sandbox keys exist only in the port');
});

test('context surface: every method the reference context exposes is reachable here', () => {
	const { reference, reconstruction } = snapshot.contextMethods;
	assert.ok(reference.length >= 30, `reference context method list looks truncated (${reference.length})`);
	// A context method may legitimately be absent ONLY if it is declared deferred on
	// the context module or on one of the context classes. Anything else is a silent
	// gap, and `nodeContext.someMethod` would then be `undefined` at the call site.
	const ctxModule = surface.modules['node-execution-context.mjs'];
	const declared = new Set([
		...Object.keys(ctxModule?.deferred ?? {}),
		...Object.values(surface.classes).flatMap((c) => Object.keys(c.deferred ?? {})),
	]);
	const missing = reference.filter((k) => !reconstruction.includes(k) && !declared.has(k));
	assert.deepEqual(
		missing,
		[],
		`undeclared context methods (declared deferred: ${[...declared].join(', ')})`,
	);
});

test('additional keys: $execution/$vars/$secrets key set equals the reference', () => {
	const { reference, reconstruction, input } = snapshot.additionalKeys ?? {};
	assert.ok(Array.isArray(reference) && reference.length, `snapshot has no additionalKeys (${input ?? 'n/a'})`);
	assert.deepEqual(reconstruction, reference, 'the object spread over every workflow expression must have identical keys');
});

test('$secrets: disabled yields undefined, enabled yields the reference proxy behaviour', async () => {
	const mod = await load('additional-keys.mjs');
	const { getSecretsProxy } = await import('../src/get-secrets-proxy.mjs');
	const host = {
		externalSecretsProxy: {
			providers: { vault: { token: 's3cr3t', nested: { deep: 'd' } } },
			hasProvider(name) {
				return name in this.providers;
			},
			hasSecret(provider, name) {
				return provider in this.providers && name in this.providers[provider];
			},
			getSecret(provider, name) {
				return this.providers[provider][name];
			},
			listProviders() {
				return Object.keys(this.providers);
			},
			listSecrets(provider) {
				return Object.keys(this.providers[provider] ?? {});
			},
		},
	};
	const additionalData = {
		...host,
		urlBaseWebhook: 'http://localhost:5678/webhook/',
		urlBaseElement: 'http://localhost:5678',
		instanceBaseUrl: 'http://localhost:5678',
		executionTimeout: 60,
		maxExecutionTimeout: 120,
		timezone: 'UTC',
		getInstanceId: () => 'i',
	};
	const off = mod.getAdditionalKeys(additionalData, 'manual', { resultData: { metadata: {} } }, {});
	assert.equal(off.$secrets, undefined, 'the reference sets undefined when secretsEnabled is falsy');
	const on = mod.getAdditionalKeys(additionalData, 'manual', { resultData: { metadata: {} } }, { secretsEnabled: true });
	assert.equal(on.$secrets.vault.token, 's3cr3t');
	// nested values come back through the same proxy, so a missing nested key throws
	// instead of returning undefined (that is how a workflow learns the key is gone).
	assert.equal(on.$secrets.vault.nested.deep, 'd');
	assert.throws(() => on.$secrets.vault.nested.missing, (error) => {
		assert.equal(error.name, 'ExpressionError');
		assert.equal(error.message, 'Could not load secrets');
		assert.match(error.description, /could not be found/);
		return true;
	});
	assert.throws(() => on.$secrets.unknownProvider.anything, (error) => {
		assert.match(error.description, /not reachable/);
		return true;
	});
	// Writes are refused rather than silently dropped on the floor: `set` returning
	// false is what makes a strict-mode assignment throw a TypeError.
	assert.throws(() => {
		'use strict';
		on.$secrets.vault = {};
	}, TypeError);
	assert.deepEqual(Reflect.ownKeys(on.$secrets), ['vault']);
	assert.deepEqual(Reflect.ownKeys(on.$secrets.vault), ['token', 'nested']);

	if (!runtime) {
		t_diagnosticLive('reference runtime not installed — $secrets parity not run');
		return;
	}
	const req = createRequire(join(runtime.dir, 'noop.js'));
	const ref = req(join(runtime.dir, 'n8n-core/dist/execution-engine/node-execution-context/utils/get-secrets-proxy.js'));
	const refProxy = ref.getSecretsProxy({ ...host });
	const mineProxy = getSecretsProxy({ ...host });
	const probes = [
		['read', (p) => p.vault.token],
		['nested', (p) => p.vault.nested.deep],
		['missing', (p) => p.vault.nope],
		['unknown provider', (p) => p.nope.x],
		['ownKeys', (p) => Reflect.ownKeys(p).join(',')],
		['nested ownKeys', (p) => Reflect.ownKeys(p.vault).join(',')],
		['write', (p) => Reflect.set(p.vault, 'injected', 'x')],
	];
	const diffs = [];
	for (const [label, run] of probes) {
		const one = describe(run, refProxy);
		const other = describe(run, mineProxy);
		if (one !== other) diffs.push(`${label}\n    reference:      ${one}\n    reconstruction: ${other}`);
	}
	assert.deepEqual(diffs, [], 'the secrets proxy diverged from the reference');
});

function describe(run, target) {
	try {
		const value = run(target);
		return typeof value === 'object' && value !== null ? `[object ${value.constructor?.name ?? 'Proxy'}]` : JSON.stringify(value);
	} catch (error) {
		return `throws ${error.name}: ${error.message} | ${error.description ?? ''}`;
	}
}

const t_diagnosticLive = (message) => process.stdout.write(`# SKIP(live): ${message}\n`);

test('live: the manifest is not stale against the installed runtime', async (t) => {
	if (!runtime) {
		t.diagnostic('reference runtime not installed — manifest staleness not checked');
		return;
	}
	const req = createRequire(join(runtime.dir, 'noop.js'));
	const problems = [];
	for (const [file, entry] of Object.entries(surface.modules)) {
		const live = new Set();
		for (const refModule of entry.referenceModules) {
			const [, rel] = refModule.split(':');
			for (const k of Object.keys(req(join(runtime.dir, rel)))) live.add(k);
		}
		const manifestSet = new Set(entry.referenceExports);
		for (const k of live) if (!manifestSet.has(k)) problems.push(`${file}: runtime exports ${k}, manifest does not list it`);
		for (const k of manifestSet) if (!live.has(k)) problems.push(`${file}: manifest lists ${k}, runtime no longer exports it`);
	}
	assert.deepEqual(problems, [], 'manifest/port-surface.json is stale — re-record with test/helpers/record-surface.mjs');
});
