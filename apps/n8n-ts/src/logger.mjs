const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * @param {{ logLevel?: string }} [opts]
 */
export function createLogger(opts = {}) {
  const min = LEVELS[opts.logLevel] ?? LEVELS.info;

  function write(level, message, meta) {
    if ((LEVELS[level] ?? 100) < min) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(meta && typeof meta === 'object' ? { meta } : meta !== undefined ? { meta } : {}),
    };
    const text = JSON.stringify(line);
    if (level === 'error') {
      console.error(text);
    } else if (level === 'warn') {
      console.warn(text);
    } else {
      console.log(text);
    }
  }

  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}
