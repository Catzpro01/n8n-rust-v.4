/**
 * Execution Data LEGO — `prettyBytes`.
 *
 * 1:1 port of `pretty-bytes@5.6.0` (the exact version pinned by n8n-core
 * 2.9.1, used at packages/core/src/binary-data/binary-data.service.ts:75,90,
 * 107,121 to fill `IBinaryData.fileSize`).
 *
 * Ported rather than depended upon so the LEGO keeps ZERO runtime
 * dependencies; `test/06-parity.test.mjs` diffs it against the real
 * `pretty-bytes@5.6.0` over a deterministic corpus.
 *
 * Only the byte (decimal) branch is reachable from n8n's binary metadata:
 * `prettyBytes(n)` is always called un-optioned, so `bits`/`binary`/`signed`
 * are unreachable in production. They are ported anyway for faithful
 * equivalence with the pinned package.
 */

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
const BIBYTE_UNITS = ['B', 'kiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
const BIT_UNITS = ['b', 'kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit', 'Ebit', 'Zbit', 'Ybit'];
const BIBIT_UNITS = ['b', 'kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit', 'Eibit', 'Zibit', 'Yibit'];

function toLocaleString(number, locale, options) {
	let result = number;
	if (typeof locale === 'string' || Array.isArray(locale)) {
		result = number.toLocaleString(locale, options);
	} else if (locale === true || options !== undefined) {
		result = number.toLocaleString(undefined, options);
	}
	return result;
}

export function prettyBytes(number, options = {}) {
	if (!Number.isFinite(number)) {
		throw new TypeError(`Expected a finite number, got ${typeof number}: ${number}`);
	}

	const opts = { bits: false, binary: false, ...options };

	const UNITS = opts.bits
		? opts.binary
			? BIBIT_UNITS
			: BIT_UNITS
		: opts.binary
			? BIBYTE_UNITS
			: BYTE_UNITS;

	if (opts.signed && number === 0) {
		return ` 0 ${UNITS[0]}`;
	}

	const isNegative = number < 0;
	const prefix = isNegative ? '-' : opts.signed ? '+' : '';

	if (isNegative) {
		number = -number;
	}

	let localeOptions;
	if (opts.minimumFractionDigits !== undefined) {
		localeOptions = { minimumFractionDigits: opts.minimumFractionDigits };
	}
	if (opts.maximumFractionDigits !== undefined) {
		localeOptions = { maximumFractionDigits: opts.maximumFractionDigits, ...localeOptions };
	}

	if (number < 1) {
		const numberString = toLocaleString(number, opts.locale, localeOptions);
		return prefix + numberString + ' ' + UNITS[0];
	}

	const exponent = Math.min(
		Math.floor(opts.binary ? Math.log(number) / Math.log(1024) : Math.log10(number) / 3),
		UNITS.length - 1,
	);

	number /= opts.binary ? 1024 ** exponent : 1000 ** exponent;

	if (!localeOptions) {
		number = number.toPrecision(3);
	}

	const numberString = toLocaleString(Number(number), opts.locale, localeOptions);
	const unit = UNITS[exponent];

	return prefix + numberString + ' ' + unit;
}
