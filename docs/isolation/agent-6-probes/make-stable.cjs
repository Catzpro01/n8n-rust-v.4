'use strict';
/**
 * Derive the byte-stable mirror of an observations file (drift-gate artifact).
 * This file IS the mask: engine-probes.cjs imports toStable from here, so a file written by the
 * runner (AGENT6_STABLE=<path>) and a mirror derived from an existing recording are the same bytes
 * by construction — that is what makes it usable as a drift gate.
 *   node docs/isolation/agent-6-probes/make-stable.cjs <in.json> <out.stable.json>
 */
const fs = require('fs');
// Keys whose value cannot appear in a diff-able gate. `process_version` is here because of anatomy
// finding D2: the sandbox assigns `version: process.pid` (expression.ts:433), so that probe's value is a PID.
const KEYS = ['generatedAt', 'startTime', 'executionTime', 'establishedAt', 'timestamp', 'instanceId', 'pushRef', 'lineNumber',
	'pid', 'ppid', 'now', 'today', 'release', 'finishedTime', 'startedAt', 'version', 'process_version'];
const walk = (x) => {
	if (Array.isArray(x)) return x.map(walk);
	if (x && typeof x === 'object') {
		const o = {};
		for (const [k, v] of Object.entries(x)) o[k] = KEYS.includes(k) ? '<stable>' : walk(v);
		return o;
	}
	if (typeof x === 'string') {
		return x
			.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2,3}[+-]\d{2}:\d{2}/g, '<ts>')
			.replace(/\b\d{13}\b/g, '<epoch>')
			.replace(/\[DateTime: [^\]]*\]/g, '[DateTime:<stable>]')
			.replace(/\b[a-f0-9]{32}\b/g, '<hex32>');
	}
	return x;
};
module.exports = { toStable: walk, MASKED_KEYS: KEYS };
if (require.main === module) {
	const [, , src, dst] = process.argv;
	if (!src || !dst) { console.error('usage: make-stable.cjs <in.json> <out.stable.json>'); process.exit(2); }
	fs.writeFileSync(dst, JSON.stringify(walk(JSON.parse(fs.readFileSync(src, 'utf8'))), null, 2) + '\n');
	console.log('stable mirror written:', dst);
}
