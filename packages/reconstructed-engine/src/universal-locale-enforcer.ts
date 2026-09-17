// Zero Cross-Language Leak Enforcer (Agent 5 — integration guardian)
//
// Two responsibilities:
//   1. `UniversalLocaleEnforcer.enforceLocale()` — resolve an untrusted locale to a
//      supported one (kept from the original TASK-EXP-A5 increment, API unchanged).
//   2. `auditLocaleDictionaries()` — scan every locale dictionary shipped in this
//      package and report where a UI string leaks across languages:
//        * `missingKeys`   — a locale does not cover a key the reference locale has;
//                            at runtime that renders the untranslated fallback.
//        * `untranslated`  — the value is byte-identical to the reference locale AND
//                            long enough to be prose rather than a proper noun
//                            (brand names like "Telegram" are expected to match).
//        * `blankValues`   — empty / whitespace-only translation.
//
// Reference locale is `id` (Bahasa Indonesia) because every dictionary in this
// package is authored Indonesian-first; `en` is not present in all of them.
//
// Pure TypeScript, zero imports from reference/ or packages/core, no runtime
// dependency on the n8n tree — the audit runs anywhere Node can strip types.

export const SUPPORTED_LOCALES = ['id', 'en', 'jv', 'ar', 'zh', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const REFERENCE_LOCALE: SupportedLocale = 'id';

/** Values shorter than this, or a single word, are treated as proper nouns (brand names). */
export const PROSE_MIN_LENGTH = 12;

export type LocaleDictionary = Partial<Record<string, Record<string, string>>>;

export interface LocaleFinding {
	locale: string;
	key: string;
	value: string;
}

export interface DictionaryAudit {
	name: string;
	locales: string[];
	referenceLocale: string;
	keyCount: Record<string, number>;
	missingKeys: LocaleFinding[];
	untranslated: LocaleFinding[];
	blankValues: LocaleFinding[];
	/** True when the dictionary is internally consistent (no leak of any kind). */
	clean: boolean;
}

export interface LocaleAuditReport {
	dictionaries: DictionaryAudit[];
	clean: boolean;
	totals: { dictionaries: number; locales: number; keys: number; findings: number };
}

/** Duck-type check: `{ [locale]: { [key]: string } }` with at least one locale. */
export function isLocaleDictionary(value: unknown): value is Record<string, Record<string, string>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0) return false;
	return entries.every(([locale, block]) => {
		if (typeof block !== 'object' || block === null || Array.isArray(block)) return false;
		const pairs = Object.entries(block as Record<string, unknown>);
		return pairs.length > 0 && pairs.every(([, v]) => typeof v === 'string');
	});
}

/** Extract every locale-shaped export from a set of imported modules. */
export function collectLocaleDictionaries(
	modules: Record<string, Record<string, unknown>>,
): Array<{ name: string; dictionary: Record<string, Record<string, string>> }> {
	const found: Array<{ name: string; dictionary: Record<string, Record<string, string>> }> = [];
	for (const [moduleName, mod] of Object.entries(modules)) {
		for (const [exportName, value] of Object.entries(mod ?? {})) {
			if (!isLocaleDictionary(value)) continue;
			found.push({ name: `${moduleName}.${exportName}`, dictionary: value });
		}
	}
	return found.sort((a, b) => a.name.localeCompare(b.name));
}

function isProse(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length >= PROSE_MIN_LENGTH && /\s/.test(trimmed);
}

/** Audit one dictionary. `reference` defaults to the package-wide reference locale. */
export function auditDictionary(
	name: string,
	dictionary: Record<string, Record<string, string>>,
	reference: string = REFERENCE_LOCALE,
): DictionaryAudit {
	const locales = Object.keys(dictionary).sort();
	const refBlock = dictionary[reference] ?? {};
	const refKeys = Object.keys(refBlock);
	const keyCount: Record<string, number> = {};
	const missingKeys: LocaleFinding[] = [];
	const untranslated: LocaleFinding[] = [];
	const blankValues: LocaleFinding[] = [];

	for (const locale of locales) {
		const block = dictionary[locale] ?? {};
		keyCount[locale] = Object.keys(block).length;
		if (locale === reference) continue;

		for (const key of refKeys) {
			const value = block[key];
			if (value === undefined) {
				missingKeys.push({ locale, key, value: '' });
				continue;
			}
			if (value.trim() === '') {
				blankValues.push({ locale, key, value });
				continue;
			}
			if (value === refBlock[key] && isProse(value)) {
				untranslated.push({ locale, key, value });
			}
		}
	}

	const findings = missingKeys.length + untranslated.length + blankValues.length;
	return {
		name,
		locales,
		referenceLocale: reference,
		keyCount,
		missingKeys,
		untranslated,
		blankValues,
		clean: findings === 0,
	};
}

/** Audit every locale dictionary found in `modules`. */
export function auditLocaleDictionaries(
	modules: Record<string, Record<string, unknown>>,
): LocaleAuditReport {
	const dictionaries = collectLocaleDictionaries(modules).map(({ name, dictionary }) =>
		auditDictionary(name, dictionary),
	);
	const clean = dictionaries.every((d) => d.clean);
	return {
		dictionaries,
		clean,
		totals: {
			dictionaries: dictionaries.length,
			locales: new Set(dictionaries.flatMap((d) => d.locales)).size,
			keys: dictionaries.reduce(
				(sum, d) => sum + Object.values(d.keyCount).reduce((a, b) => a + b, 0),
				0,
			),
			findings: dictionaries.reduce(
				(sum, d) => sum + d.missingKeys.length + d.untranslated.length + d.blankValues.length,
				0,
			),
		},
	};
}

/**
 * Same audit driven from the filesystem — used by the gate script so the check can
 * run without hand-wiring imports.
 */
export async function auditLocaleModules(load: (path: string) => Promise<Record<string, unknown>>, paths: string[]): Promise<LocaleAuditReport> {
	const modules: Record<string, Record<string, unknown>> = {};
	for (const p of paths) {
		const name = p.split(/[\\/]/).pop()!.replace(/\.ts$/, '');
		modules[name] = (await load(p)) as Record<string, unknown>;
	}
	return auditLocaleDictionaries(modules);
}

/** Hard gate: throws when any dictionary leaks a string across languages. */
export function assertNoCrossLanguageLeak(report: LocaleAuditReport): void {
	if (report.clean) return;
	const lines = report.dictionaries
		.filter((d) => !d.clean)
		.map((d) => {
			const detail = [
				d.missingKeys.length ? `${d.missingKeys.length} missing` : '',
				d.untranslated.length ? `${d.untranslated.length} untranslated` : '',
				d.blankValues.length ? `${d.blankValues.length} blank` : '',
			]
				.filter(Boolean)
				.join(', ');
			return `  - ${d.name} (${detail})`;
		});
	throw new Error(
		`Cross-language leak detected in ${report.totals.findings} string(s):\n${lines.join('\n')}`,
	);
}

/** Original TASK-EXP-A5 API — resolves an untrusted locale, never falls back to English. */
export class UniversalLocaleEnforcer {
	public static enforceLocale(requestedLocale: string): SupportedLocale {
		return (SUPPORTED_LOCALES as readonly string[]).includes(requestedLocale)
			? (requestedLocale as SupportedLocale)
			: REFERENCE_LOCALE;
	}

	/** Translate one key through a dictionary, falling back to the reference locale. */
	public static translate(
		dictionary: Record<string, Record<string, string>>,
		key: string,
		locale: string,
	): string {
		const resolved = this.enforceLocale(locale);
		return dictionary[resolved]?.[key] ?? dictionary[REFERENCE_LOCALE]?.[key] ?? key;
	}
}
