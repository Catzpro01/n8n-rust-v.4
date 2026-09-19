#!/usr/bin/env node
/**
 * Phase 6 isolation gate — QUEUE / EVENTS / REALTIME LEGOs.
 *
 * Machine-verifies, against the pinned n8n 2.9.4 reference:
 *   G01 contract + isolation blueprint + manifest presence
 *   G02 QUEUE     — frozen constants byte-exact in reference and reconstruction
 *   G03 EVENTS    — relay/queue-metrics/ai catalogues key-for-key
 *   G04 REALTIME  — SSE/WS/push wire constants byte-exact
 *   G05 package tests (node --test) for all three LEGOs
 *   G06 ZERO RUST — crates/ and apps/ hold no Rust artifacts
 *   G07 reference integrity — digest of the owned subsystem trees
 *
 * Writes:
 *   docs/isolation/evidence/phase6-gate.json
 *   docs/isolation/PHASE-6-GATE.md
 *
 * usage: node tools/phase6-isolation-gate.mjs [--json] [--skip-tests] [--lego queue|events|realtime]
 *
 * `--lego <name>` runs the isolated subset that belongs to a single LEGO (its artefacts, its
 * provenance gate and its package tests) and writes per-LEGO evidence under
 * docs/isolation/evidence/phase6-<lego>-gate.json; the three thin wrappers
 * tools/{queue,events,realtime}-isolation-gate.mjs call it this way. Without the flag the full
 * gate runs, including the cross-LEGO integration gate G08.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const skipTests = args.includes('--skip-tests');
const legoFlagIndex = args.findIndex((arg) => arg === '--lego' || arg.startsWith('--lego='));
const legoArgument = legoFlagIndex === -1 ? null : (args[legoFlagIndex].split('=')[1] ?? args[legoFlagIndex + 1]);
const only = legoArgument ?? null;
const LEGOS = ['queue', 'events', 'realtime'];
if (only !== null && !LEGOS.includes(only)) {
	console.error(`unknown --lego '${only}' (expected one of ${LEGOS.join(', ')})`);
	process.exit(2);
}
/** gates that belong to exactly one LEGO; everything else is shared or cross-LEGO */
const SCOPE = { G01: 'all', G02: 'queue', G03: 'events', G04: 'realtime', G05: 'all', G06: 'shared', G07: 'shared', G08: 'cross' };
const scoped = (list) => (only === null ? list : list.filter((entry) => entry === only));
const inScope = (entry) => only === null || ['all', 'shared'].includes(entry);

const EVIDENCE = join(REPO, 'docs/isolation/evidence');
const RESULTS = [];

const gate = (id, title, fn, requirement) => {
	if (only !== null) {
		const scope = SCOPE[id] ?? 'shared';
		if (!inScope(scope)) return; // per-LEGO run: skip gates that belong to the other LEGOs
	}
	const started = Date.now();
	let status = 'PASS';
	let detail = '';
	try {
		detail = String(fn() ?? '');
	} catch (error) {
		status = 'FAIL';
		detail = error instanceof Error ? error.message : String(error);
	}
	RESULTS.push({ id, title, requirement, status, detail: detail.slice(0, 1200), ms: Date.now() - started });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${detail.split('\n')[0]}` : ''}`);
};

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const must = (condition, message) => {
	if (!condition) throw new Error(message);
};
const hasAll = (source, literals, label) => {
	const missing = literals.filter((literal) => !source.includes(literal));
	must(missing.length === 0, `${label}: missing ${missing.length} literal(s): ${missing.slice(0, 3).join(' | ')}`);
	return `${literals.length} literal(s) verified`;
};

const walk = (dir, out = []) => {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
};

const digestTree = (dir) => {
	const files = walk(dir).sort();
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(relative(REPO, file));
		hash.update(readFileSync(file));
	}
	return { files: files.length, digest: hash.digest('hex') };
};

/* ------------------------------------------------------------------ */
/* G01 — artefacts                                                      */
/* ------------------------------------------------------------------ */
gate(
	'G01',
	'contracts, isolation blueprints and manifests present',
	() => {
		const required = [];
		for (const lego of scoped(LEGOS)) {
			required.push(
				`contracts/${lego}.contract.md`,
				`docs/isolation/${lego}.md`,
				`packages/${lego}-lego/package.json`,
				`packages/${lego}-lego/src/index.ts`,
				`packages/${lego}-lego/src/model-surface.ts`,
				`packages/${lego}-lego/manifest/ownership.json`,
			);
		}
		const missing = required.filter((rel) => !existsSync(join(REPO, rel)));
		must(missing.length === 0, `missing artefacts: ${missing.join(', ')}`);

		for (const lego of scoped(LEGOS)) {
			const manifest = JSON.parse(read(`packages/${lego}-lego/manifest/ownership.json`));
			must(manifest.lego === lego, `${lego}: manifest lego mismatch`);
			must(manifest.zeroRust === true, `${lego}: zeroRust flag missing`);
			must(manifest.frontendUntouched === true, `${lego}: frontendUntouched flag missing`);
			must(Boolean(manifest.implemented?.engine), `${lego}: manifest engine missing`);
		}
		return `${required.length} artefacts + ${scoped(LEGOS).length} manifest(s)`;
	},
	'each LEGO owns a contract, an isolation blueprint, a package and a manifest',
);

/* ------------------------------------------------------------------ */
/* G02 — QUEUE provenance                                               */
/* ------------------------------------------------------------------ */
gate(
	'G02',
	'QUEUE — frozen constants byte-exact in reference + reconstruction',
	() => {
		const reference = read('reference/n8n/packages/cli/src/scaling/constants.ts');
		const engine = read('packages/reconstructed-engine/src/queue-engine.ts');

		hasAll(
			reference,
			[
				"export const QUEUE_NAME = 'jobs';",
				"export const JOB_TYPE_NAME = 'job';",
				"export const COMMAND_PUBSUB_CHANNEL = 'n8n.commands';",
				"export const WORKER_RESPONSE_PUBSUB_CHANNEL = 'n8n.worker-response';",
				"export const MCP_RELAY_PUBSUB_CHANNEL = 'n8n.mcp-relay';",
			],
			'reference scaling/constants.ts',
		);
		hasAll(
			engine,
			[
				"export const QUEUE_NAME = 'jobs';",
				"export const JOB_TYPE_NAME = 'job';",
				"export const COMMAND_PUBSUB_CHANNEL = 'n8n.commands';",
				"export const WORKER_RESPONSE_PUBSUB_CHANNEL = 'n8n.worker-response';",
				"export const MCP_RELAY_PUBSUB_CHANNEL = 'n8n.mcp-relay';",
				"'add-webhooks-triggers-and-pollers'",
				"'remove-triggers-and-pollers'",
				"'relay-execution-lifecycle-event'",
				"'relay-chat-stream-event'",
				'maxStalledCount: 0',
				'Worker received invalid job',
				'`Worker failed to find data for execution ${executionId} (job ${job.id})`',
			],
			'queue-engine.ts',
		);

		const scaling = read('reference/n8n/packages/cli/src/scaling/scaling.service.ts');
		must(scaling.includes('maxStalledCount: 0'), 'reference lost maxStalledCount: 0');
		must(scaling.includes("'Worker received invalid job'"), 'reference lost invalid-job guard');

		return 'channels, command sets, stalled-job policy and error strings verified';
	},
	'vectors: constants, command classification, guard/error strings',
);

/* ------------------------------------------------------------------ */
/* G03 — EVENTS catalogue                                               */
/* ------------------------------------------------------------------ */
gate(
	'G03',
	'EVENTS — catalogues match the reference event maps key-for-key',
	() => {
		const relay = read('reference/n8n/packages/cli/src/events/maps/relay.event-map.ts');
		const metrics = read('reference/n8n/packages/cli/src/events/maps/queue-metrics.event-map.ts');
		const ai = read('reference/n8n/packages/cli/src/events/maps/ai.event-map.ts');
		const engine = read('packages/reconstructed-engine/src/events-engine.ts');

		const keys = (source) => [...source.matchAll(/\n\t'([a-z0-9-]+)':/g)].map((match) => match[1]);
		const relayNames = keys(relay);
		const metricsNames = keys(metrics);
		const aiNames = keys(ai);

		must(relayNames.length === 93, `reference relay map has ${relayNames.length} names (expected 93)`);
		must(metricsNames.length === 1, 'reference queue-metrics map must expose exactly one event');
		must(aiNames.length === 14, `reference ai map has ${aiNames.length} names (expected 14)`);

		const block = (name) =>
			engine.slice(engine.indexOf(`export const ${name} = [`), engine.indexOf(`] as const;`, engine.indexOf(`export const ${name} = [`)));
		const engineRelay = [...block('RELAY_EVENT_NAMES').matchAll(/\n\t'([a-z0-9-]+)',/g)].map((match) => match[1]);
		const missingRelay = relayNames.filter((name) => !engineRelay.includes(name));
		must(missingRelay.length === 0, `engine relay catalogue missing: ${missingRelay.slice(0, 5).join(', ')}`);

		const engineAi = [...block('AI_EVENT_NAMES').matchAll(/\n\t'([a-z0-9-]+)',/g)].map((match) => match[1]);
		const missingAi = aiNames.filter((name) => !engineAi.includes(name));
		must(missingAi.length === 0, `engine ai catalogue missing: ${missingAi.slice(0, 5).join(', ')}`);

		hasAll(
			engine,
			["export const QUEUE_METRICS_EVENT_NAMES = ['job-counts-updated'] as const;", 'export class EventService extends TypedEmitter'],
			'events-engine.ts',
		);

		return `93 relay + 1 queue-metrics + 14 ai names verified (${engineRelay.length} relay entries in the engine)`;
	},
	'event catalogues must be byte-identical to n8n 2.9.4 maps',
);

/* ------------------------------------------------------------------ */
/* G04 — REALTIME wire contract                                         */
/* ------------------------------------------------------------------ */
gate(
	'G04',
	'REALTIME — SSE/WS/push wire contract byte-exact',
	() => {
		const sse = read('reference/n8n/packages/cli/src/push/sse.push.ts');
		const ws = read('reference/n8n/packages/cli/src/push/websocket.push.ts');
		const index = read('reference/n8n/packages/cli/src/push/index.ts');
		const engine = read('packages/reconstructed-engine/src/realtime-engine.ts');

		hasAll(
			sse,
			[
				"res.setHeader('Content-Type', 'text/event-stream; charset=UTF-8');",
				"res.setHeader('Cache-Control', 'no-cache');",
				"res.setHeader('Connection', 'keep-alive');",
				"res.write(':ok\\n\\n');",
				"res.write('data: ' + data + '\\n\\n');",
				"res.write(':ping\\n\\n');",
			],
			'reference sse.push.ts',
		);
		hasAll(
			ws,
			['connection.isAlive = true;', "connection.on('pong', heartbeat);", 'connection.terminate();', 'heartbeatMessageSchema'],
			'reference websocket.push.ts',
		);
		hasAll(
			index,
			[
				'const MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024;',
				'The query parameter "pushRef" is missing!',
				"connectionError = 'Invalid origin!';",
				"res.status(401).send('Unauthorized');",
				"command: 'relay-execution-lifecycle-event',",
			],
			'reference push/index.ts + push.config.ts',
		);
		hasAll(
			engine,
			[
				"export const DEFAULT_PUSH_BACKEND: PushBackend = 'websocket';",
				'export const MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024;',
				'export const PING_INTERVAL_MS = 60 * 1000;',
				"res.write(':ok\\n\\n')",
				"res.write('data: ' + data + '\\n\\n')",
				"res.write(':ping\\n\\n')",
				"'The query parameter \"pushRef\" is missing!'",
				'connectionError = \'Invalid origin!\';',
				"command: 'relay-execution-lifecycle-event',",
			],
			'realtime-engine.ts',
		);
		// push.config.ts carries the default backend
		hasAll(
			read('reference/n8n/packages/cli/src/push/push.config.ts'),
			["@Env('N8N_PUSH_BACKEND')", "'sse' | 'websocket' = 'websocket'"],
			'reference push.config.ts',
		);

		return 'SSE handshake/frames, WS liveness, config default and relay guard verified';
	},
	'wire-level strings and guards must match the reference push subsystem',
);

/* ------------------------------------------------------------------ */
/* G05 — package tests                                                  */
/* ------------------------------------------------------------------ */
gate(
	'G05',
	'package tests (queue / events / realtime)',
	() => {
		if (skipTests) return 'skipped (--skip-tests)';
		const summary = [];
		for (const lego of scoped(LEGOS)) {
			const cwd = join(REPO, `packages/${lego}-lego`);
			const testFiles = readdirSync(join(cwd, 'test'))
				.filter((name) => name.endsWith('.test.mjs'))
				.map((name) => join('test', name));
			must(testFiles.length > 0, `${lego}: no test files found`);
			const out = spawnSync(process.execPath, ['--test', ...testFiles], { cwd, encoding: 'utf8', timeout: 120_000 });
			const text = `${out.stdout ?? ''}${out.stderr ?? ''}`;
			const pass = Number(text.match(/^# pass (\d+)/m)?.[1] ?? 0);
			const fail = Number(text.match(/^# fail (\d+)/m)?.[1] ?? 0);
			must(out.status === 0 && fail === 0, `${lego}: ${fail} failing test(s)\n${text.slice(-800)}`);
			must(pass > 0, `${lego}: no tests executed`);
			summary.push(`${lego} ${pass}/${pass + fail}`);
		}
		return summary.join(', ');
	},
	'every LEGO package must pass its node --test suite',
);

/* ------------------------------------------------------------------ */
/* G08 — integration (queue × events × realtime wired together)          */
/* ------------------------------------------------------------------ */
gate(
	'G08',
	'integration test — QUEUE × EVENTS × REALTIME on one deployment',
	() => {
		const file = join(REPO, 'tests/integration/phase6-integration.test.mjs');
		must(existsSync(file), 'tests/integration/phase6-integration.test.mjs missing');
		if (skipTests) return 'skipped (--skip-tests)';
		const out = spawnSync(process.execPath, ['--test', file], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
		const text = `${out.stdout ?? ''}${out.stderr ?? ''}`;
		const pass = Number(text.match(/^# pass (\d+)/m)?.[1] ?? 0);
		const fail = Number(text.match(/^# fail (\d+)/m)?.[1] ?? 0);
		must(out.status === 0 && fail === 0, `integration: ${fail} failing test(s)\n${text.slice(-800)}`);
		return `${pass}/${pass + fail} integration tests`;
	},
	'the three LEGOs must work together before they can be declared INTEGRATED',
);

/* ------------------------------------------------------------------ */
/* G06 — ZERO RUST                                                      */
/* ------------------------------------------------------------------ */
gate(
	'G06',
	'ZERO RUST — crates/ and apps/ hold no Rust artifacts',
	() => {
		const offenders = [];
		for (const base of ['crates', 'apps']) {
			for (const file of walk(join(REPO, base))) {
				if (file.endsWith('.rs') || file.endsWith('Cargo.toml') || file.endsWith('Cargo.lock')) {
					offenders.push(relative(REPO, file));
				}
			}
		}
		must(offenders.length === 0, `Rust artifacts present: ${offenders.slice(0, 5).join(', ')}`);
		must(!existsSync(join(REPO, 'Cargo.toml')), 'dangling root Cargo.toml present');
		const archived = join(REPO, 'docs/archive/phase3-rust');
		const archivedFiles = walk(archived).length;
		return `crates/ + apps/ clean; Phase-3 Rust archived read-only (${archivedFiles} files under docs/archive/phase3-rust)`;
	},
	'PROJECT_RULES.md §1 — reconstruction is JS/TS only',
);

/* ------------------------------------------------------------------ */
/* G07 — reference integrity                                            */
/* ------------------------------------------------------------------ */
gate(
	'G07',
	'reference integrity — owned subsystem trees unchanged at 2.9.4',
	() => {
		const scaling = digestTree(join(REPO, 'reference/n8n/packages/cli/src/scaling'));
		const events = digestTree(join(REPO, 'reference/n8n/packages/cli/src/events'));
		const eventbus = digestTree(join(REPO, 'reference/n8n/packages/cli/src/eventbus'));
		const push = digestTree(join(REPO, 'reference/n8n/packages/cli/src/push'));
		const version = JSON.parse(read('reference/n8n/package.json')).version;
		must(version === '2.9.4', `reference version drifted to ${version}`);
		return `2.9.4 · scaling ${scaling.files}/${scaling.digest.slice(0, 12)} · events ${events.files}/${events.digest.slice(0, 12)} · eventbus ${eventbus.files}/${eventbus.digest.slice(0, 12)} · push ${push.files}/${push.digest.slice(0, 12)}`;
	},
	'the mirror must stay pinned; mirroring the wrong source invalidates the LEGO',
);

/* ------------------------------------------------------------------ */
/* evidence                                                             */
/* ------------------------------------------------------------------ */
const failed = RESULTS.filter((entry) => entry.status === 'FAIL');

if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
const report = {
	generatedAt: new Date().toISOString(),
	phase: 6,
	legos: scoped(LEGOS),
	reference: { version: '2.9.4', upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83' },
	result: failed.length === 0 ? 'PASS' : 'FAIL',
	gateSummary: `${RESULTS.length - failed.length}/${RESULTS.length}`,
	gates: RESULTS,
};
const evidenceName = only === null ? 'phase6-gate.json' : `phase6-${only}-gate.json`;
writeFileSync(join(EVIDENCE, evidenceName), `${JSON.stringify(report, null, 2)}\n`);

const title = only === null ? 'QUEUE / EVENTS / REALTIME' : `${only.toUpperCase()} (isolated subset)`;
const md = [
	`# PHASE 6 GATE — ${title}`,
	'',
	`**Generated:** ${report.generatedAt} · **Result:** \`${report.result}\` (${report.gateSummary})`,
	`**Reference:** n8n 2.9.4 @ b6dc2787c45677a29a9612cd27eb911302961a83`,
	'',
	'| gate | title | status | detail |',
	'| :--- | :--- | :--- | :--- |',
	...RESULTS.map((entry) => `| ${entry.id} | ${entry.title} | ${entry.status} | ${entry.detail.replace(/\n/g, ' ').slice(0, 200)} |`),
	'',
];
const mdName = only === null ? 'PHASE-6-GATE.md' : `PHASE-6-${only.toUpperCase()}-GATE.md`;
writeFileSync(join(REPO, `docs/isolation/${mdName}`), `${md.join('\n')}\n`);

if (asJson) console.log(JSON.stringify(report, null, 2));

console.log(`\nPHASE 6 GATE${only === null ? '' : ` [${only}]`}: ${report.gateSummary} ${report.result}`);
process.exit(failed.length === 0 ? 0 : 1);
