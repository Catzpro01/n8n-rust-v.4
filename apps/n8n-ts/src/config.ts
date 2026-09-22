/**
 * Runtime configuration — every knob is an environment variable documented in
 * contracts/runtime-api.contract.md §2.  Invalid values fail fast (exit 78,
 * EX_CONFIG) instead of silently falling back, because a runtime that comes up
 * with the wrong port or the wrong data directory is worse than one that does
 * not come up at all.
 */
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'text';
export type StorageKind = 'file' | 'memory';
export type UnknownNodePolicy = 'passthrough' | 'error';
export type UnknownConnectionPolicy = 'warn' | 'error';
export type RuntimeEnv = 'development' | 'production' | 'test';

export type RuntimeConfig = {
  host: string;
  port: number;
  env: RuntimeEnv;
  logLevel: LogLevel;
  logFormat: LogFormat;
  dataDir: string;
  storage: StorageKind;
  maxBodyBytes: number;
  executionTimeoutMs: number;
  unknownNodePolicy: UnknownNodePolicy;
  unknownConnectionPolicy: UnknownConnectionPolicy;
  allowCodeEval: boolean;
  apiKey: string | null;
  corsOrigin: string;
  locale: string;
  executionHistory: number;
  pidFile: string;
  repoRoot: string;
  version: string;
  startedAt: string;
};

/** Thrown for every configuration problem; `server.ts` maps it to exit code 78. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LOG_FORMATS: LogFormat[] = ['json', 'text'];
const STORAGE_KINDS: StorageKind[] = ['file', 'memory'];
const RUNTIME_ENVS: RuntimeEnv[] = ['development', 'production', 'test'];
const UNKNOWN_NODE_POLICIES: UnknownNodePolicy[] = ['passthrough', 'error'];
const UNKNOWN_CONNECTION_POLICIES: UnknownConnectionPolicy[] = ['warn', 'error'];
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function repoRootFromModule(): string {
  // apps/n8n-ts/src/config.ts -> <repo>
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function readPackageVersion(repoRoot: string): string {
  try {
    const raw = readFileSync(join(repoRoot, 'apps', 'n8n-ts', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function firstDefined(env: NodeJS.ProcessEnv, ...names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== '') return { name, value };
  }
  return undefined;
}

function readEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  names: string[],
  allowed: T[],
  fallback: T,
): T {
  const found = firstDefined(env, ...names);
  if (!found) return fallback;
  const value = found.value.trim().toLowerCase();
  if (!(allowed as string[]).includes(value)) {
    throw new ConfigError(`${found.name}="${found.value}" is invalid — expected one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function readInt(env: NodeJS.ProcessEnv, names: string[], fallback: number, min: number, max: number): number {
  const found = firstDefined(env, ...names);
  if (!found) return fallback;
  const value = Number(found.value.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${found.name}="${found.value}" is invalid — expected an integer in [${min}, ${max}]`);
  }
  return value;
}

function readBool(env: NodeJS.ProcessEnv, names: string[], fallback: boolean): boolean {
  const found = firstDefined(env, ...names);
  if (!found) return fallback;
  const value = found.value.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new ConfigError(`${found.name}="${found.value}" is invalid — expected one of: true, false, 1, 0, yes, no, on, off`);
}

function readString(env: NodeJS.ProcessEnv, names: string[], fallback: string): string {
  const found = firstDefined(env, ...names);
  return found ? found.value.trim() : fallback;
}

/**
 * Build the frozen runtime configuration.
 *
 * @throws {ConfigError} on any invalid value (never silently ignored)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = repoRootFromModule()): RuntimeConfig {
  const envName = readEnum<RuntimeEnv>(env, ['N8N_TS_ENV'], RUNTIME_ENVS, 'development');
  const dataDirRaw = readString(env, ['N8N_TS_DATA_DIR'], join(repoRoot, 'data'));
  const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : resolve(repoRoot, dataDirRaw);

  const config: RuntimeConfig = {
    host: readString(env, ['N8N_TS_HOST', 'HOST'], '0.0.0.0'),
    port: readInt(env, ['N8N_TS_PORT', 'PORT'], 5678, 1, 65535),
    env: envName,
    logLevel: readEnum<LogLevel>(env, ['N8N_TS_LOG_LEVEL'], LOG_LEVELS, 'info'),
    logFormat: readEnum<LogFormat>(env, ['N8N_TS_LOG_FORMAT'], LOG_FORMATS, envName === 'development' ? 'text' : 'json'),
    dataDir,
    storage: readEnum<StorageKind>(env, ['N8N_TS_STORAGE'], STORAGE_KINDS, 'file'),
    maxBodyBytes: readInt(env, ['N8N_TS_MAX_BODY_BYTES'], 1024 * 1024, 1024, 256 * 1024 * 1024),
    executionTimeoutMs: readInt(env, ['N8N_TS_EXECUTION_TIMEOUT_MS'], 30_000, 1, 24 * 60 * 60 * 1000),
    unknownNodePolicy: readEnum<UnknownNodePolicy>(env, ['N8N_TS_UNKNOWN_NODE_POLICY'], UNKNOWN_NODE_POLICIES, 'passthrough'),
    unknownConnectionPolicy: readEnum<UnknownConnectionPolicy>(
      env,
      ['N8N_TS_UNKNOWN_CONNECTION_POLICY'],
      UNKNOWN_CONNECTION_POLICIES,
      'warn',
    ),
    allowCodeEval: readBool(env, ['N8N_TS_ALLOW_CODE_EVAL'], false),
    apiKey: firstDefined(env, 'N8N_TS_API_KEY')?.value.trim() ?? null,
    corsOrigin: readString(env, ['N8N_TS_CORS_ORIGIN'], '*') || '*',
    locale: readString(env, ['N8N_TS_LOCALE'], 'id').toLowerCase(),
    executionHistory: readInt(env, ['N8N_TS_EXECUTION_HISTORY'], 200, 0, 10_000),
    pidFile: '',
    repoRoot,
    version: readPackageVersion(repoRoot),
    startedAt: new Date().toISOString(),
  };

  const pidRaw = readString(env, ['N8N_TS_PID_FILE'], join(config.dataDir, 'runtime.pid'));
  config.pidFile = isAbsolute(pidRaw) ? pidRaw : resolve(repoRoot, pidRaw);
  if (config.apiKey === '') throw new ConfigError('N8N_TS_API_KEY is set but empty — unset it or provide a value');

  return config;
}

/** Human readable configuration summary (never contains the API key). */
export function describeConfig(config: RuntimeConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    env: config.env,
    logLevel: config.logLevel,
    logFormat: config.logFormat,
    dataDir: config.dataDir,
    storage: config.storage,
    maxBodyBytes: config.maxBodyBytes,
    executionTimeoutMs: config.executionTimeoutMs,
    unknownNodePolicy: config.unknownNodePolicy,
    unknownConnectionPolicy: config.unknownConnectionPolicy,
    allowCodeEval: config.allowCodeEval,
    authRequired: config.apiKey !== null,
    corsOrigin: config.corsOrigin,
    locale: config.locale,
    executionHistory: config.executionHistory,
    pidFile: config.pidFile,
    version: config.version,
  };
}
