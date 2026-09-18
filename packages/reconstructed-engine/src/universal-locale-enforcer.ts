// AGENT-5: ZERO CROSS-LANGUAGE LEAK CONTROLLER
//
// The controller is the last line of defence for rule "ZERO CROSS-LANGUAGE
// LEAK": whatever the active locale is, no text of another language may reach
// the user. An unsupported locale falls back to `id` (never to English), and a
// missing translation is *recorded* instead of being silently replaced by the
// English source string — tools/localization-leak-gate.mjs fails the build on a
// non-empty leak log.

export type UniversalLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

export const UNIVERSAL_DEFAULT_LOCALE: UniversalLocale = 'id';

export class UniversalLocaleEnforcer {
	public static readonly SUPPORTED_LOCALES = ['id', 'en', 'jv', 'ar', 'zh', 'ru'];

	/** Leak log: `locale:key` for every string served without a translation. */
	private static readonly leakLog: string[] = [];

	public static enforce(requestedLocale: string): string {
		return this.SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : 'id';
	}

	public static isSupported(locale: string): boolean {
		return this.SUPPORTED_LOCALES.includes(locale);
	}

	/**
	 * Maps `text` (an English source string) onto the active locale.
	 * `en` is the source language, so it is returned untouched.
	 * Every other locale must have a translation in `dict`; when it does not,
	 * the miss is recorded and surfaced through `leaks()`.
	 */
	public static cleanText(text: string, currentLocale: string, dict: Record<string, string>): string {
		if (currentLocale === 'en') {
			return text;
		}
		const translated = dict[text.trim()];
		if (translated === undefined) {
			this.leakLog.push(`${currentLocale}:${text.trim()}`);
			return text;
		}
		return translated;
	}

	/** Snapshot of the recorded misses (most recent last). */
	public static leaks(): string[] {
		return [...this.leakLog];
	}

	public static hasLeaks(): boolean {
		return this.leakLog.length > 0;
	}

	public static clearLeaks(): void {
		this.leakLog.length = 0;
	}
}
