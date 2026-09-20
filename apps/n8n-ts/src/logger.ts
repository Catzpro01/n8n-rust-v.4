/**
 * Zero-dependency structured logger.
 *
 * `json` format is line-delimited JSON (what the VPS/systemd journal wants),
 * `text` is the laptop-friendly default in development.
 */
import type { LogFormat, LogLevel } from './config.ts';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_LABEL: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

export type LogFields = Record<string, unknown>;

export type Logger = {
  level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = serializeError(value);
  }
  return out;
}

export type LoggerOptions = {
  level?: LogLevel;
  format?: LogFormat;
  base?: LogFields;
  /** injectable for tests */
  sink?: (line: string, isError: boolean) => void;
  now?: () => Date;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level: LogLevel = options.level ?? 'info';
  const format: LogFormat = options.format ?? 'json';
  const base = options.base ?? {};
  const sink = options.sink ?? ((line: string, isError: boolean) => (isError ? process.stderr : process.stdout).write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_WEIGHT[level];

  const emit = (entryLevel: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return;
    const payload = { ...base, ...sanitize(fields) };
    const timestamp = now().toISOString();
    if (format === 'text') {
      const extras = Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : '';
      sink(`${timestamp} ${LEVEL_LABEL[entryLevel]} ${message}${extras}`, entryLevel === 'error');
      return;
    }
    sink(JSON.stringify({ ts: timestamp, level: entryLevel, msg: message, ...payload }), entryLevel === 'error');
  };

  const logger: Logger = {
    level,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ level, format, base: { ...base, ...fields }, sink, now }),
  };

  return logger;
}
