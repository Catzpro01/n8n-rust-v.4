/**
 * Scheduler LEGO — `toCronExpression`.
 *
 * 1:1 port of `packages/workflow/src/cron.ts:50-71` (n8n 2.9.4), including the
 * control flow: every branch is an early `return` in a fixed order, and the
 * `everyX` branch returns only for `minutes` and `hours`.
 *
 * FROZEN QUIRK (S-03): **the seconds field is random**, `randomInt(60)`, so
 * `toCronExpression` is NOT a pure function. `docs/anatomy`/contract §9 already
 * warn "do not golden-test the generated expression" — this LEGO pins the
 * *shape* instead (see test/02 and test/04).
 *
 * FROZEN QUIRK (S-04): `everyX` + `unit: 'hours'` draws a SECOND random value
 * for the minute field (`randomInt(60)`), then returns
 * "<sec> <min> *SLASH<value> * * *" where *SLASH is a literal forward slash
 * (written this way so this comment cannot terminate itself). Every other
 * `everyX` unit only randomises the seconds field.
 *
 * FROZEN QUIRK (S-05): `everyX` with any unit other than `minutes`/`hours`
 * falls THROUGH the remaining mode checks (none match, because `mode` is
 * `'everyX'`) and reaches the final `return item.cronExpression.trim()` — which
 * throws `TypeError` because an `everyX` item has no `cronExpression`. The
 * union type in `TriggerTime` prevents this at compile time; at runtime it is a
 * crash. Reproduced, not guarded.
 *
 * FROZEN QUIRK (S-06): `custom` returns `item.cronExpression.trim()` — trimmed,
 * but never validated here. Validation belongs to the `cron` package at
 * `registerCron` time (contract §7).
 */

import { randomInt } from './random.mjs';

/**
 * @typedef {{ mode: 'custom', cronExpression: string }} CustomTrigger
 * @typedef {{ mode: 'everyMinute' }} EveryMinute
 * @typedef {{ mode: 'everyX', unit: 'minutes'|'hours', value: number }} EveryX
 * @typedef {{ mode: 'everyHour', minute: number }} EveryHour
 * @typedef {{ mode: 'everyDay', hour: number, minute: number }} EveryDay
 * @typedef {{ mode: 'everyWeek', hour: number, minute: number, weekday: number }} EveryWeek
 * @typedef {{ mode: 'everyMonth', hour: number, minute: number, dayOfMonth: number }} EveryMonth
 * @typedef {CustomTrigger|EveryMinute|EveryX|EveryHour|EveryDay|EveryWeek|EveryMonth} TriggerTime
 */

/**
 * @param {TriggerTime} item
 * @returns {string} a 6-field (seconds-precision) cron expression
 */
export function toCronExpression(item) {
	// S-03: drawn unconditionally, even for `custom`, even though it is unused there.
	const randomSecond = randomInt(60);

	if (item.mode === 'everyMinute') return `${randomSecond} * * * * *`;
	if (item.mode === 'everyHour') return `${randomSecond} ${item.minute} * * * *`;

	if (item.mode === 'everyX') {
		if (item.unit === 'minutes') return `${randomSecond} */${item.value} * * * *`;

		const randomMinute = randomInt(60); // S-04
		if (item.unit === 'hours') return `${randomSecond} ${randomMinute} */${item.value} * * *`;
	}

	if (item.mode === 'everyDay') return `${randomSecond} ${item.minute} ${item.hour} * * *`;
	if (item.mode === 'everyWeek') return `${randomSecond} ${item.minute} ${item.hour} * * ${item.weekday}`;
	if (item.mode === 'everyMonth')
		return `${randomSecond} ${item.minute} ${item.hour} ${item.dayOfMonth} * *`;

	return item.cronExpression.trim();
}
