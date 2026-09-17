/**
 * Records the content hashes of the POOL-001 execution-loop files that this package
 * promises not to touch, into fixtures/legacy-runner.lock.json.
 *
 * Why a lock file and not an inline constant: `runner.mjs` legitimately moved on this
 * branch (cc2d111f rewrote the loop). A pin against a fixed baseline commit therefore
 * either goes stale or blocks a neighbour's work. The lock says "the port has not
 * changed these since <commit>", which stays true across rebases and is re-derivable
 * with one command when the neighbour moves them again.
 *
 *   node test/helpers/record-runner-lock.mjs
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..', '..');
const REPO = resolve(PKG, '..', '..');
const FILES = ['runner.mjs', 'test-run.mjs', 'runner.test.mjs'];

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();

const lock = {
	$comment:
		'Reference: gate 06 asserts these files still hash to what is recorded here and that neither direction imports the other. Re-record after an AUTHORIZED change to the POOL-001 loop (that lane belongs to POOL-001/agent-2 core, not to this port) and say why in results/.',
	purpose: 'POOL-001 non-entanglement pin (not a proof of correctness — those files are not reference-derived)',
	commitAtRecord: git('rev-parse', 'HEAD'),
	commitSubjectAtRecord: git('log', '-1', '--format=%s'),
	files: Object.fromEntries(
		FILES.map((file) => {
			const buffer = readFileSync(join(PKG, file));
			return [
				file,
				{
					sha256: createHash('sha256').update(buffer).digest('hex'),
					bytes: buffer.length,
					lastCommit: git('log', '-1', '--format=%H'),
					gitBlob: git('hash-object', '-w', join(PKG, file)),
				},
			];
		}),
	),
};
// `git log -1` above is repo-wide; per-file history is what actually matters.
for (const file of FILES) {
	lock.files[file].lastCommit = git('log', '-1', '--format=%H', '--', `packages/reconstructed-engine/${file}`);
	lock.files[file].lastCommitSubject = git('log', '-1', '--format=%s', '--', `packages/reconstructed-engine/${file}`);
}

const out = join(PKG, 'fixtures', 'legacy-runner.lock.json');
writeFileSync(out, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`wrote ${out.replace(`${REPO}/`, '')}`);
for (const [file, meta] of Object.entries(lock.files)) console.log(`  ${file}  ${meta.sha256.slice(0, 12)}  ${meta.bytes}B  last: ${meta.lastCommit.slice(0, 8)}`);
