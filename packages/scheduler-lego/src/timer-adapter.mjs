const MONTHS = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 });
const DAYS = Object.freeze({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 });
const LIMITS = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

const numberOf = (token, names) => {
  const lower = token.toLowerCase();
  if (names && lower in names) return names[lower];
  if (!/^\d+$/.test(token)) throw new Error(`Invalid cron value: ${token}`);
  return Number(token);
};

function compileField(source, index) {
  const [min, max] = LIMITS[index];
  const names = index === 4 ? MONTHS : index === 5 ? DAYS : undefined;
  const values = new Set();
  let wildcard = false;
  for (const part of source.split(',')) {
    const [basis, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : numberOf(stepText);
    if (step < 1) throw new Error(`Invalid cron step: ${part}`);
    let start; let end;
    if (basis === '*') { wildcard = true; start = min; end = max; }
    else if (basis.includes('-')) {
      const range = basis.split('-');
      if (range.length !== 2) throw new Error(`Invalid cron range: ${basis}`);
      start = numberOf(range[0], names); end = numberOf(range[1], names);
    } else { start = end = numberOf(basis, names); }
    if (start < min || end > max || start > end) throw new Error(`Cron value out of range: ${part}`);
    for (let value = start; value <= end; value += step) values.add(index === 5 && value === 7 ? 0 : value);
  }
  return { values, wildcard };
}

export function parseCronExpression(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length === 5) fields.unshift('0');
  if (fields.length !== 6) throw new Error(`Cron expression must contain 5 or 6 fields: ${expression}`);
  return fields.map(compileField);
}

function partsAt(date, timezone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false, weekday: 'short', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const parts = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  return [Number(parts.second), Number(parts.minute), Number(parts.hour) % 24, Number(parts.day), Number(parts.month), DAYS[parts.weekday.toLowerCase()]];
}

export function matchesCron(compiledOrExpression, date = new Date(), timezone = 'UTC') {
  const fields = typeof compiledOrExpression === 'string' ? parseCronExpression(compiledOrExpression) : compiledOrExpression;
  const values = partsAt(date, timezone);
  const basic = fields.slice(0, 3).every((field, index) => field.values.has(values[index]));
  const month = fields[4].values.has(values[4]);
  const dayOfMonth = fields[3].values.has(values[3]);
  const dayOfWeek = fields[5].values.has(values[5]);
  const day = fields[3].wildcard || fields[5].wildcard ? dayOfMonth && dayOfWeek : dayOfMonth || dayOfWeek;
  return basic && month && day;
}

/** Native Node timer adapter for ScheduledTaskManager's injected `createJob` port. */
export class CronTimerAdapter {
  constructor({ now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
  }

  createJob(context, onTick) {
    const compiled = parseCronExpression(context.expression);
    // Validate the timezone before registration, matching CronJob's synchronous failure behavior.
    partsAt(this.now(), context.timezone ?? 'UTC');
    const clear = this.clearTimer;
    let timer; let stopped = false; let lastSecond;
    const schedule = () => {
      if (stopped) return;
      const delay = Math.max(1, 1000 - (this.now().getTime() % 1000));
      timer = this.setTimer(run, delay);
    };
    const run = () => {
      if (stopped) return;
      const date = this.now();
      const second = Math.floor(date.getTime() / 1000);
      if (second !== lastSecond && matchesCron(compiled, date, context.timezone ?? 'UTC')) {
        lastSecond = second;
        onTick();
      }
      schedule();
    };
    schedule();
    return { stop() { stopped = true; if (timer !== undefined) clear(timer); } };
  }
}

export function createCronTimerJob(adapter = new CronTimerAdapter()) {
  return (context, onTick) => adapter.createJob(context, onTick);
}
