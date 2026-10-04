/** Physical-layout ratchet for explicitly migrated backend LEGOs (no dependencies).
 * Non-migrated domains remain visible as migration debt, not silently certified.
 * This is a repository architecture check, not a JavaScript security sandbox.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

const inside = (file, root) => file.startsWith(`${root}/`);
const safePath = (value) => typeof value === 'string' && value.length > 0
  && !value.includes('\\') && !value.startsWith('/')
  && value.split('/').every((part) => part && part !== '.' && part !== '..');

export function checkPhysicalLayout(registry, appRoot) {
  const violations = [];
  const report = (file, message) => violations.push({
    rule: 'R10 physical-layout', file, line: 0, message,
    fix: 'Keep implementation and public contracts inside the owning LEGO root; historical paths may only forward named exports to its contract.',
  });
  const migrated = registry.domains.filter((domain) => domain.physical);
  for (const domain of migrated) {
    const { root, contractRoot, implementationRoot, compatibilityShims = [] } = domain.physical;
    const manifestFile = 'src/lego/manifest/domains.json';
    if (![root, contractRoot, implementationRoot].every(safePath)
      || !Array.isArray(compatibilityShims) || !compatibilityShims.every(safePath)
      || contractRoot !== `${root}/contract` || implementationRoot !== `${root}/internal`) {
      report(manifestFile, `${domain.id}: invalid physical roots or compatibility shim paths`);
      continue;
    }
    for (const other of migrated) {
      if (other.id === domain.id) continue;
      if (other.physical.root === root) report(manifestFile, `${domain.id}: physical root is also claimed by ${other.id}`);
    }
    const shimSet = new Set(compatibilityShims);
    if (!(domain.paths ?? []).includes(root)) report(manifestFile, `${domain.id}: paths must own ${root}`);
    for (const pattern of domain.paths ?? []) {
      if (pattern !== root && !inside(pattern, root) && !shimSet.has(pattern)) {
        report(manifestFile, `${domain.id}: implementation ownership escapes physical root via ${pattern}`);
      }
    }
    for (const file of domain.public ?? []) {
      if (!inside(file, contractRoot) && !shimSet.has(file)) report(manifestFile, `${domain.id}: public path is outside contract root: ${file}`);
      if (file.includes('*')) report(manifestFile, `${domain.id}: public surfaces must name exact files: ${file}`);
    }
    for (const dir of [root, contractRoot, implementationRoot]) {
      const full = join(appRoot, dir);
      if (!existsSync(full) || !lstatSync(full).isDirectory() || lstatSync(full).isSymbolicLink()) {
        report(manifestFile, `${domain.id}: missing/non-directory physical root ${dir}`);
      }
    }
    const walk = (dir) => {
      const full = join(appRoot, dir);
      if (!existsSync(full) || !lstatSync(full).isDirectory() || lstatSync(full).isSymbolicLink()) return;
      for (const entry of readdirSync(full).sort()) {
        const file = `${dir}/${entry}`;
        const stat = lstatSync(join(appRoot, file));
        if (stat.isSymbolicLink()) { report(file, `${domain.id}: symlinks cannot escape the physical boundary`); continue; }
        if (stat.isDirectory()) walk(file);
        else if (/\.(?:mjs|cjs|js|ts)$/.test(file) && !inside(file, contractRoot) && !inside(file, implementationRoot)) {
          report(file, `${domain.id}: source must live under contract/ or internal/`);
        }
      }
    };
    walk(root);
    for (const file of compatibilityShims) {
      if (inside(file, root) || !(domain.paths ?? []).includes(file) || !(domain.public ?? []).includes(file)) {
        report(manifestFile, `${domain.id}: shim must be explicitly owned, public, and outside the physical root: ${file}`);
      }
      const full = join(appRoot, file);
      if (!existsSync(full) || !lstatSync(full).isFile() || lstatSync(full).isSymbolicLink()) {
        report(file, `${domain.id}: missing/non-file compatibility shim`);
        continue;
      }
      const source = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
      // Intentionally narrow: no executable statements, wildcard exports, side effects,
      // private imports, or duplicate implementation are allowed in historical paths.
      const statement = /^export\s*\{\s*([\w$]+(?:\s+as\s+[\w$]+)?(?:\s*,\s*[\w$]+(?:\s+as\s+[\w$]+)?)*)\s*\}\s*from\s*(['"])([^'"]+)\2\s*;?$/;
      const match = source.match(statement);
      const target = match && posix.normalize(posix.join(dirname(file).replaceAll('\\', '/'), match[3]));
      if (!match || !match[3].startsWith('.') || !inside(target, contractRoot)
        || !(domain.public ?? []).includes(target) || !existsSync(join(appRoot, target))) {
        report(file, `${domain.id}: compatibility shim must only forward named exports to an existing public contract`);
      }
    }
  }
  return violations;
}
