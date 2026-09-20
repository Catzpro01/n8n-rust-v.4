/**
 * Runtime configuration for n8n-ts baseline.
 * Contract: contracts/ts-runtime-baseline.contract.md §3
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(APP_ROOT, '../..');

export const PACKAGE_VERSION = readPackageVersion();

function readPackageVersion() {
  try {
    const raw = fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8');
    return JSON.parse(raw).version ?? '0.4.0';
  } catch {
    return '0.4.0';
  }
}

/**
 * Load KEY=VALUE pairs from a .env file into process.env (does not override existing).
 * @param {string} filePath
 */
export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

/** Attempt repo-root and app-root .env */
export function loadDefaultEnv() {
  loadEnvFile(path.join(REPO_ROOT, '.env'));
  loadEnvFile(path.join(APP_ROOT, '.env'));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveConfig(env = process.env) {
  const portRaw = env.N8N_TS_PORT || env.PORT || '5678';
  const port = Number.parseInt(String(portRaw), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${portRaw}`);
  }

  let basePath = String(env.N8N_TS_BASE_PATH ?? '').trim();
  if (basePath === '/') basePath = '';
  if (basePath && !basePath.startsWith('/')) basePath = `/${basePath}`;
  if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);

  const payloadLimit = Number.parseInt(String(env.N8N_TS_PAYLOAD_LIMIT || '1048576'), 10);

  return {
    host: String(env.N8N_TS_HOST || '0.0.0.0'),
    port,
    basePath,
    locale: String(env.N8N_LOCALE || 'id'),
    logLevel: String(env.N8N_TS_LOG_LEVEL || 'info').toLowerCase(),
    payloadLimit: Number.isFinite(payloadLimit) && payloadLimit > 0 ? payloadLimit : 1048576,
    pidFile: path.resolve(REPO_ROOT, env.N8N_TS_PID_FILE || 'run/n8n-ts.pid'),
    logFile: path.resolve(REPO_ROOT, env.N8N_TS_LOG_FILE || 'run/n8n-ts.log'),
    nodeEnv: String(env.NODE_ENV || 'production'),
    version: PACKAGE_VERSION,
    service: 'n8n-ts-baseline',
  };
}
