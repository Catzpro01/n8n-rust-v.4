/**
 * Runtime port mode selector — reference vs strict.
 *
 * - reference (default): binds to pinned n8n-workflow@2.9.1 (n8n 2.9.4 artifact)
 * - strict: standalone implementations with no reference runtime
 */

export type PortMode = 'reference' | 'strict';

export function portMode(): PortMode {
  return (process.env.LEGO_CONNECTION_PORT_MODE as PortMode) || 'reference';
}

export function referencePackage(): string {
  // Try to locate n8n-workflow package
  if (process.env.LEGO_REFERENCE_PKG) return process.env.LEGO_REFERENCE_PKG;
  try {
    // From packages/connection-lego, reference is at ../../.. /reference/n8n/packages/workflow
    const path = require('path');
    const pkgPath = path.resolve(__dirname, '..', '..', '..', '..', 'reference', 'n8n', 'packages', 'workflow');
    require('fs').accessSync(pkgPath);
    return pkgPath;
  } catch {
    // Fallback to node_modules
    const path = require('path');
    return path.dirname(require.resolve('n8n-workflow/package.json'));
  }
}

export function referenceRequire(): NodeRequire {
  return require;
}
