#!/usr/bin/env node
/**
 * Phase 4B — module loader for the Backend Native Localization Hub.
 *
 * The hub is TypeScript and the verification is the Node test runner, so this helper
 * compiles the two Phase 4B sources with the repository's pinned `typescript`
 * (`packages/workflow-lego/node_modules`) into a temporary directory and imports the
 * emitted ESM. It deliberately does **not** need the reference runtime: the localization
 * hub has no n8n dependency, which is the point of the boundary.
 *
 * usage:
 *   const { service, adapter, sources } = await loadLocalizationHub();
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HUB_SOURCES = {
	service: join(REPO, 'packages/workflow-lego/src/backend-localization-service.ts'),
	adapter: join(REPO, 'packages/workflow-lego/src/settings-localization-adapter.ts'),
};

const require = createRequire(join(REPO, 'packages/workflow-lego/package.json'));

let cached = null;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Compiles the hub (and its adapter) into one temporary ESM directory. Relative
 * extension-less imports are rewritten to `.mjs`, because Node ESM requires the
 * extension while the TypeScript sources follow the n8n module style.
 */
export async function loadLocalizationHub({ fresh = false } = {}) {
	if (cached && !fresh) return cached;

	let ts;
	try {
		ts = require('typescript');
	} catch (error) {
		throw new Error(
			`typescript is required to load the localization hub — run: npm install --prefix packages/workflow-lego (${error.message})`,
		);
	}

	const outDir = mkdtempSync(join(tmpdir(), 'lego-i18n-'));
	const compile = (sourcePath, outName) => {
		const source = readFileSync(sourcePath, 'utf8');
		const emitted = ts.transpileModule(source, {
			compilerOptions: {
				module: ts.ModuleKind.ES2022,
				target: ts.ScriptTarget.ES2022,
				moduleResolution: ts.ModuleResolutionKind.NodeJs,
			},
			fileName: sourcePath,
		}).outputText;
		const rewritten = emitted.replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
		const outFile = join(outDir, `${outName}.mjs`);
		writeFileSync(outFile, rewritten);
		return { source, outFile, digest: sha256(source) };
	};

	const service = compile(HUB_SOURCES.service, 'backend-localization-service');
	const adapter = compile(HUB_SOURCES.adapter, 'settings-localization-adapter');

	const serviceModule = await import(pathToFileURL(service.outFile).href);
	const adapterModule = await import(pathToFileURL(adapter.outFile).href);

	cached = {
		service: serviceModule,
		adapter: adapterModule,
		sources: {
			service: { path: HUB_SOURCES.service, digest: service.digest },
			adapter: { path: HUB_SOURCES.adapter, digest: adapter.digest },
		},
		outDir,
	};
	return cached;
}
