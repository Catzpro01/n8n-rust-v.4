/**
 * Port runtime — where the pinned reference artifact lives.
 * Default: the sandbox n8n 2.9.4 install (n8n-workflow@2.9.1). Override with LEGO_REFERENCE_PKG
 * (absolute path to the n8n-workflow package dir) or N8N_RUNTIME (dir containing node_modules/n8n).
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function referencePackage(): string {
	if (process.env.LEGO_REFERENCE_PKG) return process.env.LEGO_REFERENCE_PKG;
	const root = process.env.N8N_RUNTIME ?? '/home/user/n8n-runtime';
	const p = join(root, 'node_modules', 'n8n-workflow');
	return existsSync(join(p, 'package.json')) ? p : 'n8n-workflow';
}
export function referenceRequire(): NodeRequire {
	return createRequire(join(referencePackage(), 'package.json'));
}
