/**
 * Surface recorder — regenerates `manifest/port-surface.json` and
 * `fixtures/reference-snapshot.json` from the *live* reference runtime.
 *
 * Both files are committed, so the gate works offline; the live reference is
 * only needed to re-derive them (drift detection lives in
 * `test/05-surface-coverage.test.mjs`).
 *
 * usage: node test/helpers/record-surface.mjs
 *
 * The classification tables below are the hand-written part. Everything else —
 * the reference export lists, the prototype method lists, the expression-sandbox
 * key set — is read out of the installed runtime, so the manifest cannot quietly
 * drift away from "what n8n actually exports". `scope: 'complete'` modules are
 * machine-enforced: an unclassified reference export aborts the recording.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import {
	buildDataProxy,
	buildExecuteContext,
	buildFixture,
	loadCorpus,
	oracle,
	prepareDi,
	referenceRootHash,
} from './harness.mjs';

const PKG = resolve(import.meta.dirname, '..', '..');

const runtime = oracle(); // throws with setup instructions if absent
prepareDi(runtime);
const req = createRequire(join(runtime.dir, 'noop.js'));
const WF = join(runtime.dir, 'n8n-workflow/dist/cjs');
const CORE = join(runtime.dir, 'n8n-core/dist/execution-engine');
const mine = (name) => import(`../../src/${name}.mjs`);

/**
 * Per-module classification.
 *   scope      'complete' → every reference export must be classified.
 *   ported     reference symbol implemented in my module (no entry needed if my
 *              module exports the same name; the recorder derives `ported`).
 *   deferred   symbol the port refuses to invent → must raise NotPortedError.
 *   outOfScope symbol that belongs to another LEGO / another task.
 *   additions  symbol my module exports that the reference module does not.
 */
const MODULES = [
	{
		my: 'constants.mjs',
		scope: 'complete',
		reference: [{ pkg: 'n8n-workflow', path: `${WF}/constants.js` }],
		note: 'Full port of constants.ts: 80 exports, values pinned by test/00.',
		additions: {
			NodeConnectionTypes:
				'interfaces.ts:2249-2263 const object (a TS type in the reference, a runtime value here).',
			PAIRED_ITEM_METHOD: 'workflow-data-proxy.ts PAIRED_ITEM_METHOD — reserved paired-item names.',
		},
	},
	{
		my: 'utils.mjs',
		scope: 'partial',
		reference: [{ pkg: 'n8n-workflow', path: `${WF}/utils.js` }],
		outOfScopeReason: 'owned by the Workflow-model / Expression LEGOs; only helpers this port needs are re-implemented',
		additions: {
			deepCopy:
				're-implementation of utils.ts deepCopy (the reference one is exported, so this is also `ported` — see ported[]); kept here because n8n-workflow must not be a runtime dependency',
			get: 'lodash/get subset with the reference call signature; declared as an addition because the reference gets `get` from lodash, not from utils.ts',
			isResourceLocatorValue: 'utils.ts type guard (a TS-only export in the compiled barrel, hence an addition here)',
			bindApplicationError: 'seam so errors.mjs and utils.mjs share one ApplicationError without a require cycle',
			jsonParse: 'utils.ts:jsonParse, needed by NodeError.findProperty',
		},
		note: 'Selective: only the helpers the data-proxy and execution-context ports call. ' +
			`Each one is a re-implementation, not a re-export, so the reconstruction keeps ` +
			'zero runtime dependency on lodash or on n8n-workflow.',
		deferred: {
			// lodash `get` is used by the reference; ours is a documented subset (see utils.mjs).
		},
	},
	{
		my: 'errors.mjs',
		scope: 'partial',
		reference: [{ pkg: 'n8n-workflow', path: `${WF}/errors/index.js` }],
		outOfScopeReason: 'error classes owned by other LEGOs (credential/webhook/workflow-activation errors)',
	},
	{
		my: 'run-execution-data.mjs',
		scope: 'complete',
		reference: [
			{ pkg: 'n8n-workflow', path: `${WF}/run-execution-data/run-execution-data.js` },
			{ pkg: 'n8n-workflow', path: `${WF}/run-execution-data-factory.js` },
		],
		notes: {
			runExecutionDataV0ToV1: 'internal to run-execution-data.ts; exported here for the migration test only',
			getContext: 'NodeHelpers.getContext in the reference (node-helpers.ts); re-exported from this module so the proxy and the context port share ONE implementation',
			createErrorExecutionData: 'run-execution-data-factory.ts:96-124',
			migrateRunExecutionData: 'the reference throws a plain Error for unsupported versions — not an ApplicationError',
		},
		additions: {
			runExecutionDataV0ToV1:
				'internal helper of run-execution-data.ts, exported here so the migration rewrite can be unit-tested directly',
			getContext:
				"the reference keeps this on NodeHelpers (node-helpers.ts); it lives here so the proxy and the execution context share ONE implementation — that sharing is what fixed a real port bug the goldens caught",
		},
		note: 'migrateRunExecutionData/createRunExecutionData/createEmptyRunExecutionData/createErrorExecutionData/getContext.',
	},
	{
		my: 'workflow-data-proxy-env-provider.mjs',
		scope: 'complete',
		reference: [{ pkg: 'n8n-workflow', path: `${WF}/workflow-data-proxy-env-provider.js` }],
		note: '$env provider. Ported after the golden caught a stub that returned undefined where the reference throws.',
	},
	{
		my: 'execution-metadata.mjs',
		scope: 'complete',
		reference: [
			{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/utils/execution-metadata.js` },
			{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/utils/construct-execution-metadata.js` },
		],
		additions: {
			setLogger: 'DI seam replacing Container.get(Logger); the reference injects a logger service',
			getCapturedLog: 'test seam: returns the last swallowed logger.warn call',
			constructExecutionMetaData:
				'ported from the sibling module construct-execution-metadata.ts (same port unit: both are called by the execute context)',
			KV_LIMIT: 'execution-metadata.ts:7 — the reference exports it and so do we; listed here so the additions check knows it is intentional',
			InvalidExecutionMetadataError:
				'packages/core/src/errors/invalid-execution-metadata.error.ts, exported from the core barrel rather than this util module',
		},
		note: 'KV_LIMIT, the four metadata functions, InvalidExecutionMetadataError and constructExecutionMetaData.',
	},
	{
		my: 'additional-keys.mjs',
		scope: 'complete',
		reference: [
			{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/utils/get-additional-keys.js` },
		],
		extraReferenceModules: {
			'get-secrets-proxy.js': 'the $secrets proxy this module builds — ported in src/get-secrets-proxy.mjs',
		},
		outOfScopeReason: 'the rest of getWorkflowDataProxy() lives in workflow-data-proxy.mjs',
		additions: {
			PLACEHOLDER_EMPTY_EXECUTION_ID:
				'packages/core/src/constants.ts:2 — lives in core constants, not next to getAdditionalKeys; exported here because the $execution.resumeUrl branch reads it',
		},
		note: '$execution/$executionId/$resumeWebhookUrl/$vars — the part core injects through IAdditionalData.',
	},
	{
		my: 'workflow-data-proxy.mjs',
		scope: 'complete',
		// $jmesPath/$jmespath are ported but only answer when the host injects the
		// jmespath module (see the ctor's 15th argument); moved out of `deferred` when
		// the seam started resolving it, because "inert without an injected capability"
		// is not the same claim as "not ported".
		injected: {
			jmespath: 'reference-runtime.mjs seam → ctor; without it $jmesPath/$jmespath raise',
			luxon: 'same seam; without it $now/$today/DateTime/Interval/Duration raise instead of answering undefined',
		},
		reference: [
			{ pkg: 'n8n-workflow', path: `${WF}/workflow-data-proxy.js` },
			{ pkg: 'n8n-workflow', path: `${WF}/workflow-data-proxy-helpers.js` },
		],
		deferred: {
			'$($x).pairedItem': 'paired-item resolution — paired-item LEGO (see docs)',
			getPairedItem: 'paired-item LEGO',
			$tool: 'tool/agent runtime (agent LEGO)',
			$agentInfo: 'only the agent-node branch of workflow-data-proxy.ts:1061 is missing; the non-agent answer (undefined) is ported and a real agent node raises instead of answering nothing',
			agentInfo: 'workflow-data-proxy.ts:1061 agentInfo getter — needs the agent-runtime LEGO',
			buildAgentToolInfo: 'workflow-data-proxy.ts agent tool metadata — agent-runtime LEGO',
			$fromAI:
				"workflow-data-proxy.ts:1038-1108 handleFromAi — fromAI placeholder parsing belongs to the Expression LEGO. The three sandbox keys ($fromAI/$fromAi/$fromai) exist and raise, so a workflow cannot read a silent undefined.", 
		},
		additions: {
			NotPortedError: 'the loud "not ported" error this package defines for deferred symbols',
			lodashGet: 're-export of the lodash-`get` subset used by the reference accessors',
			contextReader:
				'seam delegating to the ONE getContext implementation (run-execution-data.mjs); the reference calls NodeHelpers.getContext inline',
		},
	},
	{
		my: 'get-secrets-proxy.mjs',
		scope: 'complete',
		reference: [{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/utils/get-secrets-proxy.js` }],
		note: 'The $secrets access boundary: enumeration is answered by the store, writes are refused, missing values throw.',
	},
	{
		my: 'node-execution-context.mjs',
		scope: 'partial',
		reference: [
			{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/base-execute-context.js` },
			{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/execute-context.js` },
			{ pkg: 'n8n-core', path: `${CORE}/node-execution-context/node-execution-context.js` },
		],
		outOfScopeReason: 'hook/webhook/trigger/poll/supply-data/load-options contexts are separate port units',
		deferred: {
			startJob: 'base-execute-context.ts startJob — long-running/paused job resumption (job LEGO)',
			getInputConnectionData: 'execute-context.ts:164 → utils/get-input-connection-data.ts (connection LEGO)',
			getSignedResumeUrl: 'webhook-resume URL signing (external-secrets/webhook LEGO)',
			getInstanceBaseUrl: 'needs GlobalConfig; declared so the name is not silently missing',
			getInstanceId: 'needs instance-settings service',
		},
		notes: {
			getAdditionalKeys: 'get-additional-keys.ts:19-78',
		},
		additions: {
			CHAT_TRIGGER_NODE_TYPE: 're-export from constants.mjs for existing import sites',
			NotPortedError: 're-export for the deferred accessor sites',
			cleanupParameterData: 'utils/cleanup-parameters.ts helper (parameter-cleanup LEGO), kept here because both context classes call it',
		},
	},
];

/** Classes whose prototype surface is compared name-by-name. */
const CLASSES = [
	{
		name: 'WorkflowDataProxy',
		my: 'workflow-data-proxy.mjs',
		reference: { pkg: 'n8n-workflow', path: `${WF}/workflow-data-proxy.js` },
	},
	{
		name: 'BaseExecuteContext',
		my: 'node-execution-context.mjs',
		reference: { pkg: 'n8n-core', path: `${CORE}/node-execution-context/base-execute-context.js` },
	},
	{
		name: 'ExecuteContext',
		my: 'node-execution-context.mjs',
		reference: { pkg: 'n8n-core', path: `${CORE}/node-execution-context/execute-context.js` },
	},
	{
		name: 'NodeExecutionContext',
		my: 'node-execution-context.mjs',
		reference: { pkg: 'n8n-core', path: `${CORE}/node-execution-context/node-execution-context.js` },
	},
];

const ownNames = (proto) => Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
const chainUpTo = (proto, root) => {
	const out = [];
	let p = proto;
	while (p && p !== Object.prototype && p !== root) {
		out.push(...ownNames(p));
		p = Object.getPrototypeOf(p);
	}
	return out;
};

const loadRef = (entry) => req(entry.path);

/** Reference module key as it appears in the manifest (stable, human-checkable). */
const refKey = (entry) => `${entry.pkg}:${entry.path.replace(runtime.dir + '/', '')}`;

const manifest = {
	$generatedBy: 'node test/helpers/record-surface.mjs',
	$source:
		'GENERATED from the pinned reference runtime — DO NOT EDIT. Re-record after touching src/. ' +
		'Test 05 re-derives these lists live and fails on drift; test 05 also works offline against this file.',
	$runtimeVersion: runtime.version,
	$referenceRootHash: referenceRootHash(),
	$recordedAt: new Date().toISOString(),
	legend: {
		ported: 'exported by my module with the reference name',
		deferred: 'NOT implemented: must raise NotPortedError, never a value (anti-ISSUE-016)',
		outOfScope: 'exists in the reference module, belongs to another LEGO/task',
		additions: 'my module exports it, the reference module does not',
	},
	modules: {},
	classes: {},
};

const snapshot = {
	$generatedBy: 'node test/helpers/record-surface.mjs',
	$source: 'values read out of the pinned reference runtime — DO NOT EDIT',
	$runtimeVersion: runtime.version,
	$recordedAt: new Date().toISOString(),
	constants: {},
	utilsSubset: {},
	errorsSubset: {},
	sandboxKeys: [],
	sandboxKeysNote: '',
};

// --------------------------------------------------------------------------- modules
for (const mod of MODULES) {
	const mineMod = await mine(mod.my.replace(/\.mjs$/, ''));
	const refExports = new Set();
	for (const entry of mod.reference) {
		for (const k of Object.keys(loadRef(entry))) refExports.add(k);
	}
	const myExports = Object.keys(mineMod);
	const deferredKeys = Object.keys(mod.deferred ?? {});
	const ported = [...refExports].filter((k) => myExports.includes(k));
	const outOfScope = {};
	for (const k of [...refExports].filter((k) => !myExports.includes(k))) {
		if (mod.outOfScope?.[k]) outOfScope[k] = mod.outOfScope[k];
		else if (!deferredKeys.some((d) => d === k || d.startsWith(`${k}(`))) {
			outOfScope[k] = mod.outOfScopeReason ?? 'not required by this port';
		}
	}
	if (mod.scope === 'complete') {
		const unclassified = [...refExports].filter(
			(k) => !myExports.includes(k) && !deferredKeys.includes(k),
		);
		if (unclassified.length) {
			throw new Error(
				`${mod.my} claims scope:'complete' but these reference exports are unclassified: ${unclassified.join(', ')}`,
			);
		}
	}
	manifest.modules[mod.my] = {
		scope: mod.scope,
		referenceModules: mod.reference.map(refKey),
		referenceExports: [...refExports].sort(),
		ported: ported.sort(),
		deferred: mod.deferred ?? {},
		outOfScope,
		additions: mod.additions ?? {},
		notes: mod.notes ?? {},
		note: mod.note,
	};
}

// --------------------------------------------------------------------------- classes
for (const cls of CLASSES) {
	const refMod = loadRef(cls.reference);
	const Ref = refMod[cls.name];
	const Mine = (await mine(cls.my.replace(/\.mjs$/, '')))[cls.name];
	if (!Ref) throw new Error(`reference class ${cls.name} not found`);
	if (!Mine) throw new Error(`port class ${cls.name} not found in ${cls.my}`);
	// own names of the reference class (NOT inherited) vs own names of mine
	const refOwn = ownNames(Ref.prototype);
	const myOwn = ownNames(Mine.prototype);
	const myAll = new Set(chainUpTo(Mine.prototype, null));
	const mod = MODULES.find((m) => m.my === cls.my);
	// The chain direction is part of the contract: `BaseExecuteContext extends
	// NodeExecutionContext` in the reference (NodeExecutionContext is the SHARED
	// base, despite its name), so a port that inverts it would widen the surface of
	// the shallower classes. Compared by NAME because the classes are distinct.
	const superOf = (C) => {
		const p = Object.getPrototypeOf(C);
		return p === Function.prototype ? null : p.name || null;
	};
	const deferredKeys = Object.keys(mod?.deferred ?? {});
	const missing = refOwn.filter((n) => !myAll.has(n));
	const stillMissing = missing.filter((n) => !deferredKeys.includes(n));
	const refSuper = superOf(Ref);
	const mySuper = superOf(Mine);
	manifest.classes[cls.name] = {
		// `cls.my` already carries the extension — the doubled `…mjs.mjs` this line used to
		// produce pointed at a file that does not exist, which is worse than useless in a
		// manifest the Rust port reads to find the reference for each symbol.
		module: `src/${cls.my}`,
		referenceExtends: refSuper,
		portExtends: mySuper,
		hierarchyMatches: refSuper === mySuper,
		referenceModule: refKey(cls.reference),
		referenceOwnMethods: refOwn.sort(),
		portedFromThisClass: refOwn.filter((n) => myOwn.includes(n)).sort(),
		// In the port the shared implementation sits on the root class, so the leaf
		// classes inherit it instead of declaring it. Behaviourally equivalent
		// (proven by the goldens); declared so nobody mistakes it for coverage.
		portedOnRootInstead: missing.filter((n) => myAll.has(n)).sort(),
		deferred: Object.fromEntries(stillMissing.map((n) => [n, mod?.deferred?.[n] ?? 'UNDECLARED'])),
		undeclaredGaps: stillMissing.filter((n) => !(mod?.deferred ?? {})[n]).sort(),
		extras: myOwn.filter((n) => !refOwn.includes(n) && !(mod?.additions ?? {})[n]).sort(),
	};
}

// --------------------------------------------------------------------------- snapshot
const refConst = loadRef({ pkg: 'n8n-workflow', path: `${WF}/constants.js` });
const encode = (v) => {
	if (v instanceof Date) return { '#date': v.toISOString() };
	if (v instanceof Set) return { '#set': [...v].map(encode) };
	if (v instanceof Map) return { '#map': [...v.entries()].map(([k, x]) => [k, encode(x)]) };
	if (Array.isArray(v)) return v.map(encode);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
	return v;
};
for (const [k, v] of Object.entries(refConst)) snapshot.constants[k] = encode(v);

// expression-sandbox key set: what a workflow expression can actually see.
// Derived by running the REFERENCE proxy and MY proxy over the same fixture the
// goldens use — the offline test can then assert my key set against the snapshot
// without loading the runtime at all.
const corpus = loadCorpus();
const sandboxScenario = corpus.scenarios.find((sc) => sc.name === 'linear-3-run');
snapshot.sandboxKeys = { reference: [], reconstruction: [] };
for (const side of ['reference', 'reconstruction']) {
	const fixture = buildFixture(sandboxScenario, runtime, side);
	const proxy = buildDataProxy(fixture, runtime, side);
	snapshot.sandboxKeys[side] = Object.keys(proxy).sort();
	if (snapshot.sandboxKeys[side].length < 20) {
		throw new Error(`sandbox keys for ${side}: only ${snapshot.sandboxKeys[side].length} — refusing to record`);
	}
}
const ctxScenario = corpus.contextScenarios.find((sc) => sc.name === 'ctx-basic') ?? corpus.contextScenarios[0];
for (const side of ['reference', 'reconstruction']) {
	const fixture = buildFixture(ctxScenario, runtime, side);
	const ctx = buildExecuteContext(fixture, runtime, side);
	snapshot.contextMethods = snapshot.contextMethods ?? { reference: [], reconstruction: [] };
	snapshot.contextMethods[side] = [
		...new Set(
			(() => {
				const out = [];
				let p = Object.getPrototypeOf(ctx);
				while (p && p !== Object.prototype) {
					out.push(...Object.getOwnPropertyNames(p));
					p = Object.getPrototypeOf(p);
				}
				return out;
			})(),
		),
	].sort();
}
// $execution/$vars/... as a KEY SET: `getAdditionalKeys` builds an object, and a
// missing key is invisible to a module-level surface scan.
const stubAdditionalData = (overrides) => ({
	urlBaseWebhook: 'http://localhost:5678/webhook/',
	urlBaseElement: 'http://localhost:5678',
	instanceBaseUrl: 'http://localhost:5678',
	executionTimeout: 60,
	maxExecutionTimeout: 120,
	timezone: 'America/New_York',
	getInstanceId: () => 'instance-1',
	getSecrets: () => ({})	,
	...overrides,
});
snapshot.additionalKeys = { reference: [], reconstruction: [], input: null };
try {
	const refAk = req(join(CORE, 'node-execution-context/utils/get-additional-keys.js'));
	for (const [side, fn] of [
		['reference', refAk.getAdditionalKeys],
		['reconstruction', (await mine('additional-keys')).getAdditionalKeys],
	]) {
		const keys = fn(
			stubAdditionalData({ executionId: 'exec-1', workflowData: { id: 'wf-1', name: 'W' } }),
			'manual',
			{ resultData: { metadata: {} } },
			{},
		);
		snapshot.additionalKeys[side] = Object.keys(keys).sort();
	}
} catch (error) {
	snapshot.additionalKeys.input = `not derived: ${error.message}`;
}
snapshot.sandboxKeysNote =
	'Keys of the object returned by getDataProxy() for scenario ' +
	`${sandboxScenario.name}. Reference list = what the expression sandbox exposes.`;
if (!snapshot.sandboxKeys.reference.length) {
	throw new Error('sandbox keys: reference side produced no keys — refusing to write a vacuous snapshot');
}

mkdirSync(join(PKG, 'manifest'), { recursive: true });
writeFileSync(join(PKG, 'manifest', 'port-surface.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(PKG, 'fixtures', 'reference-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
const gapCount = Object.values(manifest.classes).reduce((n, c) => n + c.undeclaredGaps.length, 0);
console.log(
	`wrote manifest/port-surface.json (${Object.keys(manifest.modules).length} modules, ` +
		`${Object.keys(manifest.classes).length} classes, ${gapCount} undeclared gaps) + fixtures/reference-snapshot.json ` +
		`(sandbox keys: ${snapshot.sandboxKeys.reference.length} ref / ${snapshot.sandboxKeys.reconstruction.length} mine)`,
);
process.exit(0);
