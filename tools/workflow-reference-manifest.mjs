#!/usr/bin/env node
/**
 * Workflow LEGO — reference integrity manifest.
 *
 * The whole premise of Phase 2 is that the reference tree is untouched. This
 * tool proves it: it hashes the reference sources and either pins or verifies
 * them.
 *
 *   --write : regenerate packages/workflow-lego/manifest/reference.sha256.json
 *   --check : fail if any file under reference/n8n/** changed, appeared or vanished
 *
 * Scope:
 *   - reference/n8n/**                → single root hash over all files
 *   - packages/workflow/**            → per-file hashes (the LEGO's source of truth)
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO } from './workflow-boundary-map.mjs';

const REF = join(REPO, 'reference/n8n');
const OUT = join(REPO, 'packages/workflow-lego/manifest/reference.sha256.json');
const WORKFLOW_PKG = 'packages/workflow';

function listFiles(root, out = []) {
	for (const entry of readdirSync(root).sort()) {
		const abs = join(root, entry);
		const st = lstatSync(abs);
		if (st.isDirectory()) listFiles(abs, out);
		else if (st.isSymbolicLink()) out.push(relative(REF, abs).replace(/\\/g, '/') + ' ->symlink');
		else out.push(relative(REF, abs).replace(/\\/g, '/'));
	}
	return out;
}

const hashFile = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

function build() {
	const files = listFiles(REF);
	const root = createHash('sha256');
	const workflowPkg = {};
	let workflowFiles = 0;
	for (const rel of files) {
		const abs = join(REF, rel);
		if (rel.endsWith('->symlink')) {
			root.update(`${rel}\n`);
			continue;
		}
		const h = hashFile(abs);
		root.update(`${rel}:${h}\n`);
		if (rel.startsWith(`${WORKFLOW_PKG}/`)) {
			workflowPkg[rel] = h;
			workflowFiles++;
		}
	}
	return {
		scope: 'reference/n8n',
		pinnedVersion: '2.9.4',
		pinnedCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
		fileCount: files.length,
		rootHash: root.digest('hex'),
		workflowPackage: { path: WORKFLOW_PKG, fileCount: workflowFiles, files: workflowPkg },
	};
}

const args = process.argv.slice(2);
if (!existsSync(REF)) {
	console.error(`missing reference tree at ${REF}`);
	process.exit(1);
}

if (args.includes('--write')) {
	const manifest = build();
	writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
	console.log(`wrote ${relative(REPO, OUT)}`);
	console.log(`  files hashed        : ${manifest.fileCount}`);
	console.log(`  root hash           : ${manifest.rootHash}`);
	console.log(`  packages/workflow   : ${manifest.workflowPackage.fileCount} files`);
} else if (args.includes('--check')) {
	const manifest = build();
	if (!existsSync(OUT)) {
		console.error(`MISSING ${relative(REPO, OUT)} — run with --write`);
		process.exit(1);
	}
	const pinned = JSON.parse(readFileSync(OUT, 'utf8'));
	const problems = [];
	if (pinned.rootHash !== manifest.rootHash || pinned.fileCount !== manifest.fileCount) {
		problems.push(`reference tree changed: ${manifest.fileCount} files (root ${manifest.rootHash.slice(0, 12)}) vs pinned ${pinned.fileCount} files (root ${pinned.rootHash.slice(0, 12)})`);
		const pinnedFiles = pinned.workflowPackage.files;
		for (const [rel, h] of Object.entries(manifest.workflowPackage.files)) {
			if (!(rel in pinnedFiles)) problems.push(`  new file      : ${rel}`);
			else if (pinnedFiles[rel] !== h) problems.push(`  modified      : ${rel}`);
		}
		for (const rel of Object.keys(pinnedFiles)) {
			if (!(rel in manifest.workflowPackage.files)) problems.push(`  deleted       : ${rel}`);
		}
	}
	if (problems.length) {
		console.error('REFERENCE MUTATION DETECTED:');
		for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
		if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
		process.exitCode = 1;
	} else {
		console.log(`Reference integrity check: PASS (${manifest.fileCount} files, root ${manifest.rootHash.slice(0, 16)}…)`);
	}
} else {
	console.log(JSON.stringify(build(), null, 2));
}
