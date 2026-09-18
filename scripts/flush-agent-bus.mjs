#!/usr/bin/env node
/**
 * AGENT-5 · flushes docs/isolation/agent-5-bus-outbox.json to Supabase.
 *
 * The Arena worker runs behind an egress allowlist and the repository ships the
 * schema (docs/supabase_migration.sql) with RLS that grants `anon`/`authenticated`
 * SELECT only, so an INSERT needs the service-role key. When the key or the
 * network is unavailable this script prints exactly what it would have sent and
 * leaves the envelopes on disk for the orchestrator to flush.
 *
 * usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/flush-agent-bus.mjs [--apply]
 *        node scripts/flush-agent-bus.mjs                      # dry run (default)
 *
 * exit : 0 = every envelope delivered (or dry run), 1 = at least one delivery failed
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTBOX = join(REPO, 'docs/isolation/agent-5-bus-outbox.json');

const apply = process.argv.includes('--apply');
const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const outbox = JSON.parse(readFileSync(OUTBOX, 'utf8'));
const envelopes = outbox.envelopes ?? [];

const deliverable = Boolean(url && key && apply);

console.log(`agent-5 bus outbox : ${outbox.envelopes.length} envelope(s)`);
console.log(`mode               : ${deliverable ? 'APPLY' : 'DRY RUN'}`);
if (!deliverable) {
	const reasons = [];
	if (!url) reasons.push('SUPABASE_URL is unset');
	if (!key) reasons.push('SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY is unset');
	if (!apply) reasons.push('--apply not passed');
	console.log(`why dry run        : ${reasons.join('; ')}`);
}

let failures = 0;
for (const envelope of envelopes) {
	const target = `${url || '<SUPABASE_URL>'}/rest/v1/${envelope.table}`;
	console.log(
		`\n[${envelope.id}] ${envelope.method} ${target}\n    phase=${envelope.phase} · ${envelope.note ?? ''}`,
	);
	if (!deliverable) {
		console.log(`    body: ${JSON.stringify(envelope.body).slice(0, 160)}…`);
		continue;
	}
	try {
		const response = await fetch(target, {
			method: envelope.method,
			headers: {
				apikey: key,
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
				Prefer: envelope.prefer ?? 'return=representation',
			},
			body: JSON.stringify(envelope.body),
		});
		const text = await response.text();
		const ok = response.status >= 200 && response.status < 300;
		if (!ok) failures += 1;
		console.log(`    -> HTTP ${response.status}${ok ? '' : ` ${text.slice(0, 200)}`}`);
	} catch (error) {
		failures += 1;
		console.log(`    -> NETWORK ERROR: ${error.message}`);
	}
}

if (!deliverable) {
	console.log(
		'\nNothing was sent. Envelopes stay committed in docs/isolation/agent-5-bus-outbox.json\n' +
			'in phase order so the orchestrator can replay them verbatim once egress + service key exist.',
	);
	process.exit(0);
}

console.log(`\nDELIVERY: ${envelopes.length - failures}/${envelopes.length} envelope(s) delivered`);
process.exit(failures === 0 ? 0 : 1);
