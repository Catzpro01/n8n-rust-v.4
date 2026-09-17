function defaultRandomInt(max) { return Math.floor(Math.random() * max); }

/** Literal TriggerTime conversion from n8n-workflow 2.9.4 cron.ts. */
export function toCronExpression(item, randomInt = defaultRandomInt) {
  const second = randomInt(60);
  if (item.mode === 'everyMinute') return `${second} * * * * *`;
  if (item.mode === 'everyHour') return `${second} ${item.minute} * * * *`;
  if (item.mode === 'everyX') {
    if (item.unit === 'minutes') return `${second} */${item.value} * * * *`;
    if (item.unit === 'hours') return `${second} ${randomInt(60)} */${item.value} * * *`;
  }
  if (item.mode === 'everyDay') return `${second} ${item.minute} ${item.hour} * * *`;
  if (item.mode === 'everyWeek') return `${second} ${item.minute} ${item.hour} * * ${item.weekday}`;
  if (item.mode === 'everyMonth') return `${second} ${item.minute} ${item.hour} ${item.dayOfMonth} * *`;
  return item.cronExpression.trim();
}

export function toCronKey(context) {
  const { recurrence, ...rest } = context;
  const flattened = !recurrence ? rest : {
    ...rest,
    recurrenceActivated: recurrence.activated,
    ...(recurrence.activated ? {
      recurrenceIndex: recurrence.index,
      recurrenceIntervalSize: recurrence.intervalSize,
      recurrenceTypeInterval: recurrence.typeInterval,
    } : {}),
  };
  return JSON.stringify(Object.fromEntries(Object.entries(flattened).sort(([a], [b]) => a.localeCompare(b))));
}
