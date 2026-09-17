// Determinism recipe for the TASK-403 engine observations: mask wall-clock / process-dependent
// fields, then compare two recordings of engine-probes.cjs. Usage:
//   node docs/isolation/agent-6-probes/engine-determinism-check.cjs <a.json> <b.json>
const MASKED_KEYS = ['generatedAt', 'startTime', 'executionTime', 'establishedAt', 'timestamp', 'instanceId', 'pushRef', 'lineNumber'];
const mask = (x) => {
	if (Array.isArray(x)) return x.map(mask);
	if (x && typeof x === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(x)) out[k] = MASKED_KEYS.includes(k) ? '<env>' : mask(v);
		return out;
	}
	if (typeof x === 'string') {
		return x
			.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2,3}[+-]\d{2}:\d{2}/g, '<ts>')
			.replace(/\b\d{13}\b/g, '<epoch>');
	}
	return x;
};
const a = mask(require(require('path').resolve(process.argv[2])));
const b = mask(require(require('path').resolve(process.argv[3])));
const same = JSON.stringify(a) === JSON.stringify(b);
console.log('ENGINE DETERMINISM CHECK:', same ? 'MATCH (only wall-clock / process fields differ)' : 'MISMATCH');
if (!same) {
	const pa = JSON.stringify(a), pb = JSON.stringify(b);
	let i = 0; while (pa[i] === pb[i]) i++;
	console.log('first diff at', i, '\nA:', pa.slice(i - 140, i + 140), '\nB:', pb.slice(i - 140, i + 140));
}
process.exit(same ? 0 : 1);
