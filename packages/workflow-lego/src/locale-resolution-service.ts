// Locale Resolution & Native Message Runtime (Phase 4B lanjutan)
// Menyatukan kamus 6 bahasa Phase 4B dengan negosiasi locale (RFC 4647 basic
// filtering), aturan plural kardinal CLDR, dan interpolasi placeholder —
// semuanya di backend, tanpa menyentuh UI (PROJECT_RULES #2).
//
// ZERO RUST: TypeScript murni, nol dependensi runtime.

import {
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	SUPPORTED_LOCALES,
} from './backend-localization-service';
import type { SupportedLocale } from './backend-localization-service';

// ---------------------------------------------------------------------------
// 1. Negosiasi locale (RFC 4647 — basic filtering, disederhanakan)
// ---------------------------------------------------------------------------

export interface AcceptLanguageEntry {
	locale: string;
	quality: number;
}

/** Mengurai header `Accept-Language` menjadi daftar locale terurut by q-value.
 *  Entri dengan q-value di luar 0..1 atau bersistaksional (mis. `q=1.5`, `q=2`)
 *  ditolak sesuai RFC 7231 §5.3.1 — entri itu tidak boleh mengungguli preferensi valid. */
export function parseAcceptLanguage(header: string): AcceptLanguageEntry[] {
	if (!header || typeof header !== 'string') return [];
	const out: AcceptLanguageEntry[] = [];
	for (const rawPart of header.split(',')) {
		const part = rawPart.trim();
		if (!part) continue;
		const [rawTag, ...params] = part.split(';');
		const tag = rawTag.trim();
		if (!tag || !/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(tag)) continue;
		let quality = 1;
		let rejected = false;
		for (const param of params) {
			if (!/^\s*q\s*=/i.test(param)) continue; // parameter selain q diabaikan
			const m = /^\s*q\s*=\s*(\d+(?:\.\d{1,3})?)\s*$/i.exec(param);
			const q = m ? Number(m[1]) : NaN;
			if (!Number.isFinite(q) || q < 0 || q > 1) {
				rejected = true; // q-value invalid menurut RFC 7231 (harus 0..1)
				break;
			}
			quality = q;
		}
		if (rejected) continue;
		out.push({ locale: normalizeLocaleTag(tag), quality });
	}
	// stabil: q desc, urutan asal sebagai tie-breaker
	return out
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => b.entry.quality - a.entry.quality || a.index - b.index)
		.map(({ entry }) => entry);
}

/** Normalisasi tag BCP-47 sederhana: language lowercase, region uppercase. */
export function normalizeLocaleTag(tag: string): string {
	const parts = tag.trim().split('-');
	if (parts.length === 0) return tag.trim();
	const normalized = parts.map((part, i) => {
		if (i === 0) return part.toLowerCase();
		if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase(); // script
		if (part.length === 2) return part.toUpperCase(); // region
		return part;
	});
	return normalized.join('-');
}

/**
 * Memilih locale yang didukung dari daftar preferensi pengguna.
 * Urutan pencocokan per kandidat: exact match → language-only match.
 * Jika tidak ada yang cocok, kembalikan `fallback`.
 */
export function resolveLocale(
	requested: ReadonlyArray<string>,
	fallback: SupportedLocale = NativeLocalizationService.getLocale(),
): SupportedLocale {
	const supported = Object.keys(SUPPORTED_LOCALES) as SupportedLocale[];
	for (const raw of requested) {
		const tag = normalizeLocaleTag(String(raw));
		if (!tag) continue;
		const lower = tag.toLowerCase();
		const exact = supported.find((s) => s.toLowerCase() === lower);
		if (exact) return exact;
		const language = lower.split('-')[0];
		const langMatch = supported.find((s) => s.toLowerCase() === language);
		if (langMatch) return langMatch;
	}
	return fallback;
}

/** Negosiasi langsung dari header Accept-Language. */
export function resolveFromAcceptLanguage(
	header: string,
	fallback: SupportedLocale = NativeLocalizationService.getLocale(),
): SupportedLocale {
	return resolveLocale(
		parseAcceptLanguage(header).map((e) => e.locale),
		fallback,
	);
}

// ---------------------------------------------------------------------------
// 2. Aturan plural kardinal CLDR (subset 6 locale target)
//    Referensi: https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html
// ---------------------------------------------------------------------------

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * Aturan plural kardinal CLDR untuk keenam locale yang didukung.
 * Sesuai CLDR: pecahan desimal (v > 0) tidak pernah `one/few/...` pada
 * en/ru (jatuh ke `other`), dan kategori exact-match/range ar hanya berlaku
 * untuk nilai integer. `i` = digit integer, `v` = digit pecahan yang terlihat.
 */
export function selectPluralCategory(n: number, locale: SupportedLocale): PluralCategory {
	if (!Number.isFinite(n)) return 'other';
	const abs = Math.abs(n);
	const i = Math.floor(abs); // integer digits
	const dot = String(abs).indexOf('.');
	const v = dot === -1 ? 0 : String(abs).length - dot - 1; // visible fraction digits
	switch (locale) {
		case 'id':
		case 'jv':
		case 'zh':
			return 'other';
		case 'en':
			return i === 1 && v === 0 ? 'one' : 'other';
		case 'ru': {
			if (v !== 0) return 'other'; // CLDR: semua aturan ru mensyaratkan v = 0
			const mod10 = i % 10;
			const mod100 = i % 100;
			if (mod10 === 1 && mod100 !== 11) return 'one';
			if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
			if (mod10 === 0 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 11 && mod100 <= 14))
				return 'many';
			return 'other';
		}
		case 'ar': {
			if (abs === 0) return 'zero';
			if (abs === 1) return 'one';
			if (abs === 2) return 'two';
			if (!Number.isInteger(abs)) return 'other'; // range CLDR hanya utk integer
			const mod100 = i % 100;
			if (mod100 >= 3 && mod100 <= 10) return 'few';
			if (mod100 >= 11 && mod100 <= 99) return 'many';
			return 'other';
		}
		default:
			return 'other';
	}
}

// ---------------------------------------------------------------------------
// 3. Interpolasi placeholder
// ---------------------------------------------------------------------------

/**
 * Substitusi placeholder `{{name}}`. Placeholder tanpa parameter dibiarkan
 * apa adanya (deterministik, tidak pernah melempar).
 */
export function interpolate(
	template: string,
	params: Record<string, string | number> = {},
): string {
	return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}

// ---------------------------------------------------------------------------
// 4. Bridge pesan backend terlokalisasi
// ---------------------------------------------------------------------------

/**
 * Penerjemah pesan backend dengan rantai fallback `locale → en → key`,
 * dukungan plural via sufiks kunci `key#kategori`, dan interpolasi.
 */
export class LocalizedBackendMessages {
	/**
	 * Terjemahkan `key` ke `locale` (default: locale aktif) dengan rantai
	 * fallback `locale → en → key`. Parameter diinterpolasi ke `{{nama}}`.
	 */
	public static t(
		key: string,
		params: Record<string, string | number> = {},
		locale?: SupportedLocale,
	): string {
		const loc = locale ?? NativeLocalizationService.getLocale();
		const template = this.lookup([key], loc);
		return interpolate(template, params);
	}

	/**
	 * Terjemahkan pesan ber-plural. Kunci varian memakai sufiks kategori CLDR:
	 * `items#one`, `items#few`, `items#many`, `items#other`, dst. Kategori
	 * dihitung dari `count` lewat `selectPluralCategory`; pencarian varian
	 * jatuh ke `key#other` lalu ke `key` polos.
	 */
	public static tp(
		key: string,
		count: number,
		params: Record<string, string | number> = {},
		locale?: SupportedLocale,
	): string {
		const loc = locale ?? NativeLocalizationService.getLocale();
		const category = selectPluralCategory(count, loc);
		const template = this.lookup([`${key}#${category}`, `${key}#other`, key], loc);
		return interpolate(template, { count, ...params });
	}

	private static lookup(candidates: string[], loc: SupportedLocale): string {
		const dictionaries: Array<Record<string, string> | undefined> = [
			NATIVE_DICTIONARIES[loc],
			NATIVE_DICTIONARIES.en,
		];
		for (const candidate of candidates) {
			for (const dict of dictionaries) {
				const hit = dict?.[candidate];
				if (hit !== undefined) return hit;
			}
		}
		return candidates[candidates.length - 1];
	}

	/** Daftar locale yang didukung beserta metadata arah teks. */
	public static locales() {
		return Object.values(SUPPORTED_LOCALES);
	}
}
