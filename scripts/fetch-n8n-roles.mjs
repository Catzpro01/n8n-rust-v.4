#!/usr/bin/env node
/**
 * Extracts the role → scope map from the pinned n8n source.
 *
 * The editor hides buttons based on scopes (`workflow:create`, `credential:share`,
 * …) that it reads from `GET /rest/roles`. Those scopes live in
 * `reference/n8n/packages/@n8n/permissions/src/roles/**` as plain string arrays,
 * so this script reads them instead of hard-coding a guess that would silently
 * drift from the UI's expectations.
 *
 *   node scripts/fetch-n8n-roles.mjs [--dir <output dir>]
 *
 * Output: <dir>/roles.json — shaped like `AllRolesMap` from `@n8n/permissions`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PERMISSIONS_SRC = join(REPO_ROOT, 'reference', 'n8n', 'packages', '@n8n', 'permissions', 'src');

function parseArgs(argv) {
  const args = { dir: join(REPO_ROOT, 'data', 'n8n-lego', 'catalog') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = resolve(argv[++i]);
  }
  return args;
}

/** `export const NAME: Scope[] = ['a', 'b'];` -> { NAME: ['a','b'] } */
function extractScopeArrays(source) {
  const out = {};
  const pattern = /export const ([A-Z_0-9]+)(?::\s*[^=]+)?\s*=\s*\[([\s\S]*?)\];/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, body] = match;
    out[name] = [...body.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  }
  return out;
}

/** `export const X_MAP: ... = { 'role': CONST, ... }` -> { role: CONST } */
function extractRoleMap(source, mapName) {
  const start = source.indexOf(`export const ${mapName}`);
  if (start === -1) throw new Error(`cannot find ${mapName} in role-maps.ee.ts`);
  const end = source.indexOf('};', start);
  const body = source.slice(start, end);
  const map = {};
  for (const match of body.matchAll(/'([^']+)'\s*:\s*([A-Z_0-9]+)/g)) {
    map[match[1]] = match[2];
  }
  return map;
}

/** `'global:owner': 'Owner',` -> { 'global:owner': 'Owner' } */
function extractStringRecord(source, recordName) {
  const start = source.indexOf(`const ${recordName}`);
  if (start === -1) return {};
  const end = source.indexOf('};', start);
  const body = source.slice(start, end);
  const record = {};
  for (const match of body.matchAll(/\[?([A-Za-z_0-9.]+)\]?|'([^']+)'\s*:\s*'([^']*)'/g)) {
    /* handled below */
  }
  for (const match of body.matchAll(/'([^']+)'\s*:\s*'([^']*)'/g)) record[match[1]] = match[2];
  for (const match of body.matchAll(/\[([A-Z_0-9]+)\]\s*:\s*'([^']*)'/g)) record[match[1]] = match[2];
  return record;
}

function readConstants(source) {
  const constants = {};
  for (const match of source.matchAll(/export const ([A-Z_0-9]+)\s*=\s*'([^']+)'/g)) constants[match[1]] = match[2];
  return constants;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scopesDir = join(PERMISSIONS_SRC, 'roles', 'scopes');
  if (!existsSync(scopesDir)) {
    process.stderr.write(`reference source not found: ${scopesDir}\n`);
    process.exit(1);
  }

  const scopes = {};
  for (const file of ['credential-sharing-scopes.ee.ts', 'global-scopes.ee.ts', 'project-scopes.ee.ts', 'workflow-sharing-scopes.ee.ts']) {
    Object.assign(scopes, extractScopeArrays(readFileSync(join(scopesDir, file), 'utf8')));
  }

  const roleMaps = readFileSync(join(PERMISSIONS_SRC, 'roles', 'role-maps.ee.ts'), 'utf8');
  const allRoles = readFileSync(join(PERMISSIONS_SRC, 'roles', 'all-roles.ts'), 'utf8');
  const constants = readConstants(readFileSync(join(PERMISSIONS_SRC, 'constants.ee.ts'), 'utf8'));
  const names = extractStringRecord(allRoles, 'ROLE_NAMES');
  const descriptions = extractStringRecord(allRoles, 'ROLE_DESCRIPTIONS');

  const resolveSlug = (value) => constants[value] ?? value;

  const maps = {
    global: extractRoleMap(roleMaps, 'GLOBAL_SCOPE_MAP'),
    project: extractRoleMap(roleMaps, 'PROJECT_SCOPE_MAP'),
    credential: extractRoleMap(roleMaps, 'CREDENTIALS_SHARING_SCOPE_MAP'),
    workflow: extractRoleMap(roleMaps, 'WORKFLOW_SHARING_SCOPE_MAP'),
  };

  const result = {};
  for (const [roleType, map] of Object.entries(maps)) {
    result[roleType] = Object.entries(map).map(([rawSlug, scopeConst]) => {
      const slug = resolveSlug(rawSlug);
      return {
        slug,
        displayName: names[rawSlug] ?? names[slug] ?? slug,
        description: descriptions[rawSlug] ?? descriptions[slug] ?? slug,
        scopes: scopes[scopeConst] ?? [],
        licensed: false,
        systemRole: true,
        roleType,
      };
    });
  }

  mkdirSync(args.dir, { recursive: true });
  const target = join(args.dir, 'roles.json');
  writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  const counts = Object.entries(result)
    .map(([type, roles]) => `${type}:${roles.length}`)
    .join(' ');
  const ownerScopes = result.global.find((role) => role.slug === 'global:owner')?.scopes.length ?? 0;
  process.stdout.write(`wrote ${target} (${counts}; global:owner has ${ownerScopes} scopes)\n`);
}

main();
