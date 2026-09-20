/**
 * Konfigurasi baseline (kontrak §5) — dibaca sekali saat boot.
 * Mendukung file `.env` TANPA package dotenv (parser KEY=VALUE sederhana)
 * agar runtime tetap nol dependensi.
 */
import { existsSync, readFileSync } from 'node:fs';
import { logger, type LogLevel } from './logger.js';

export interface BaselineConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  bodyLimitBytes: number;
  executionTimeoutMs: number;
  defaultLocale: string;
  nodeEnv: string;
  version: string;
}

const DEFAULTS = {
  host: '0.0.0.0',
  port: 5678,
  logLevel: 'info' as LogLevel,
  bodyLimitBytes: 1024 * 1024,
  executionTimeoutMs: 30_000,
  defaultLocale: 'id',
  nodeEnv: 'production',
  version: '0.1.0',
};

/** Parser .env minimal: `KEY=VALUE`, abaikan kosong + `#`, strip quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Muat `.env` (repo root + cwd) TANPA menimpa env yang sudah ada. */
function loadDotenvFiles(): string[] {
  const loaded: string[] = [];
  const candidates = [
    new URL('../../../.env', import.meta.url), // repo root (dari src/ maupun dist/)
    new URL('../../.env', import.meta.url), // apps/n8n-ts/.env
  ];
  // cwd/.env — path absolut agar jelas di log
  const cwdEnv = `${process.cwd()}/.env`;
  for (const url of candidates) {
    try {
      const path = new URL(url).pathname;
      if (existsSync(path)) {
        applyDotenv(readFileSync(path, 'utf8'));
        loaded.push(path);
      }
    } catch {
      // abaikan — .env opsional
    }
  }
  try {
    if (existsSync(cwdEnv) && !loaded.includes(cwdEnv)) {
      applyDotenv(readFileSync(cwdEnv, 'utf8'));
      loaded.push(cwdEnv);
    }
  } catch {
    // abaikan
  }
  return loaded;
}

function applyDotenv(text: string): void {
  for (const [key, value] of Object.entries(parseDotenv(text))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULTS.port;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    logger.warn(`invalid PORT "${raw}" — fallback ${DEFAULTS.port}`);
    return DEFAULTS.port;
  }
  return n;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  if (raw !== undefined && raw !== '') logger.warn(`invalid LOG_LEVEL "${raw}" — fallback info`);
  return DEFAULTS.logLevel;
}

function parseBoundedInt(
  raw: string | undefined,
  name: string,
  def: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    logger.warn(`invalid ${name} "${raw}" — fallback ${def}`);
    return def;
  }
  if (n < min || n > max) {
    logger.warn(`${name} ${n} out of range [${min},${max}] — clamped`);
    return Math.min(max, Math.max(min, n));
  }
  return n;
}

function loadVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url); // apps/n8n-ts/package.json
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // fallback ke default
  }
  return DEFAULTS.version;
}

export function loadConfig(): BaselineConfig {
  const dotenvLoaded = loadDotenvFiles();
  const config: BaselineConfig = {
    host: process.env.HOST?.trim() || DEFAULTS.host,
    port: parsePort(process.env.PORT),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    bodyLimitBytes: parseBoundedInt(
      process.env.BODY_LIMIT_BYTES,
      'BODY_LIMIT_BYTES',
      DEFAULTS.bodyLimitBytes,
      1024,
      10 * 1024 * 1024,
    ),
    executionTimeoutMs: parseBoundedInt(
      process.env.EXECUTION_TIMEOUT_MS,
      'EXECUTION_TIMEOUT_MS',
      DEFAULTS.executionTimeoutMs,
      1000,
      300_000,
    ),
    defaultLocale: process.env.N8N_LOCALE?.trim() || DEFAULTS.defaultLocale,
    nodeEnv: process.env.NODE_ENV?.trim() || DEFAULTS.nodeEnv,
    version: loadVersion(),
  };
  logger.debug(`dotenv loaded: ${dotenvLoaded.length > 0 ? dotenvLoaded.join(', ') : '(none)'}`);
  return config;
}

/** Satu baris config efektif — WAJIB di-log saat boot agar mudah debug. */
export function formatConfigLine(c: BaselineConfig): string {
  return (
    `[config] host=${c.host} port=${c.port} logLevel=${c.logLevel} ` +
    `bodyLimit=${c.bodyLimitBytes} execTimeoutMs=${c.executionTimeoutMs} ` +
    `locale=${c.defaultLocale} env=${c.nodeEnv} version=${c.version}`
  );
}
