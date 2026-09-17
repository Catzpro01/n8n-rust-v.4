/**
 * Phase 4F — API response layer: localized `sendSuccessResponse` / `sendErrorResponse` bodies.
 *
 * The reference behaviour is fixed by `contracts/api.contract.md` §3 (verified against n8n 2.9.4):
 *
 *   success  200                `{ data: <result> }`            (`ResponseHelper.sendSuccessResponse`)
 *   known    <httpStatusCode>   `{ code: <errorCode>, message, hint?, meta?, stacktrace? (dev) }`
 *   generic  500                `{ code: 0, message }`
 *   health   GET /healthz       `{ status: 'ok' }` / `{ status: 'error' }` (503 when not ready)
 *
 * This module reproduces those shapes and adds **localized** `message`/`hint` text. Nothing in the
 * reference shape is renamed or dropped — the localization is additive, so a client that only knows
 * `{ code, message }` keeps working, and a client that reads the new `label`/`hint` gets a language
 * the operator actually chose.
 *
 * BOUNDARY (contracts/localization.contract.md §4.11)
 *   owns         : response body assembly, HTTP-status mapping for the five error classes,
 *                  localized hints, the localized health `label`
 *   does NOT own : express, routing, auth, streaming, headers, status-line emission — this module
 *                  returns `{ statusCode, body }` and the API LEGO sends it
 *
 * IMPORTS: in-package only (`./localization-envelope.ts`, `./localization-vocabulary.ts`).
 *
 * RUST: none. Erasable-syntax TypeScript only.
 */

import {
	API_ERROR_CODES,
	localizeApiError,
	type ApiErrorCode,
	type LocalizedApiError,
} from './localization-envelope.ts';
import { createProductRuntime } from './localization-vocabulary.ts';
import type { InterpolationParams, LocalizationRuntime } from './localization-runtime.ts';

/* ------------------------------------------------------------------------------------------------------------------ *
 * HTTP status mapping — mirrors the reference `ResponseError` hierarchy
 * ------------------------------------------------------------------------------------------------------------------ */

/** HTTP status per error code, matching `errors/response-errors/*` in n8n 2.9.4. */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ApiErrorCode, number>> = {
	badRequest: 400,
	unauthorized: 401,
	notFound: 404,
	conflict: 409,
	internal: 500,
};

/** The reference's generic-error code (`body.code = 0` when the error is not a `ResponseError`). */
export const GENERIC_ERROR_CODE = 0;

/** Hint vocabulary per error code; `internal` deliberately has none (nothing actionable to say). */
export const HINT_KEY_BY_ERROR_CODE: Readonly<Record<ApiErrorCode, string | null>> = {
	badRequest: 'api.hint.payload',
	unauthorized: 'api.hint.credentials',
	notFound: null,
	conflict: 'api.hint.retry',
	internal: null,
};

/* ------------------------------------------------------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------------------------------------------------------ */

export interface ApiErrorResponseInput {
	/**
	 * One of `API_ERROR_CODES` (localized envelope), any other string (generic error, reference-style
	 * `code: 0`), or a number — the reference serializes `code: <errorCode || httpStatusCode>`, so a
	 * `ResponseError` without an `errorCode` comes out as e.g. `code: 401`. A numeric code is passed
	 * through untouched and needs a `rawMessage`, because no vocabulary entry can exist for it.
	 */
	readonly code: string | number;
	/** Overrides the mapped status; the reference lets a `ResponseError` carry its own. */
	readonly httpStatusCode?: number;
	/** Message key override — for errors whose text is not in the vocabulary (caller owns the text). */
	readonly rawMessage?: string;
	readonly params?: InterpolationParams;
	readonly locale?: string;
	/** Extra data the reference passes through untouched (`meta`). */
	readonly meta?: Readonly<Record<string, unknown>>;
	/** Development-only stack trace; omitted unless the caller supplies it (reference: non-production only). */
	readonly stacktrace?: string;
}

export interface ApiErrorResponse {
	/** What the API LEGO must pass to `res.status(...)`. */
	readonly statusCode: number;
	readonly body: {
		readonly code: number | string;
		readonly message: string;
		readonly hint?: string;
		readonly meta?: Readonly<Record<string, unknown>>;
		readonly stacktrace?: string;
	};
	/** Localization bookkeeping for the caller: which key was used, and whether the vocabulary had it. */
	readonly localized: {
		readonly locale: string;
		readonly messageKey: string;
		readonly hintKey: string | null;
		/**
	 * `true` only when the message text came from a vocabulary entry for this exact code. A generic
	 * (unknown or numeric) code falls back to the internal message on purpose — the caller owns that
	 * text — so it reports `false`.
	 */
	readonly vocabularyHit: boolean;
		/** Raw code as received — preserved so a generic error never hides what actually happened. */
		readonly rawCode: string;
	};
}

export interface ApiSuccessResponse {
	readonly statusCode: number;
	readonly body: { readonly data: unknown };
}

export interface ApiHealthResponse {
	readonly statusCode: number;
	/** Reference-exact field: `'ok'` / `'error'` — clients key on this, so it is never localized. */
	readonly body: { readonly status: 'ok' | 'error'; readonly label: string };
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------------------------------------------------------ */

const isKnownErrorCode = (code: string): code is ApiErrorCode =>
	(API_ERROR_CODES as readonly string[]).includes(code);

/**
 * Build a localized error response body.
 *
 * Known code → mapped status, `body.code = code`, localized `message`, localized `hint` when the
 * code has one. Unknown code → the reference's generic shape (`500`, `body.code = 0`) with the
 * localized internal message; the raw code is preserved in `localized.rawCode` rather than leaking
 * into a user-facing string.
 */
export function buildApiErrorResponse(
	input: ApiErrorResponseInput,
	runtime: LocalizationRuntime = createProductRuntime(),
): ApiErrorResponse {
	const locale = runtime.resolveLocale(input.locale);
	const numericCode = typeof input.code === 'number' ? input.code : null;
	const known = typeof input.code === 'string' && isKnownErrorCode(input.code);

	const localized: LocalizedApiError = known
		? localizeApiError(input.code, runtime, input.params, locale)
		: localizeApiError('internal', runtime, input.params, locale);

	const message = input.rawMessage ?? localized.message;
	const statusCode =
		input.httpStatusCode ?? (known ? HTTP_STATUS_BY_ERROR_CODE[input.code as ApiErrorCode] : numericCode ?? 500);

	const hintKey = known ? HINT_KEY_BY_ERROR_CODE[input.code as ApiErrorCode] : null;
	let hint: string | undefined;
	if (hintKey !== null) {
		// Translate first (so a gap is recorded in diagnostics), then only surface it when the
		// vocabulary actually had the key — a raw `api.hint.*` key must never reach a client.
		const translated = runtime.t(hintKey, input.params, locale);
		hint = runtime.has(hintKey, locale) ? translated : undefined;
	}

	const body: ApiErrorResponse['body'] = {
		// Reference: a `ResponseError` reports its own code (`errorCode || httpStatusCode`);
		// anything without one reports 0.
		code: known ? (input.code as ApiErrorCode) : numericCode ?? GENERIC_ERROR_CODE,
		message,
		...(hint === undefined ? {} : { hint }),
		...(input.meta === undefined ? {} : { meta: input.meta }),
		...(input.stacktrace === undefined ? {} : { stacktrace: input.stacktrace }),
	};

	return {
		statusCode,
		body,
		localized: {
			locale,
			messageKey: localized.messageKey,
			hintKey,
			vocabularyHit: known && !localized.fallbackUsed,
			rawCode: String(input.code),
		},
	};
}

/** Build the success envelope: `200 { data }` — exactly the reference wrapper. */
export function buildApiSuccessResponse(data: unknown, httpStatusCode = 200): ApiSuccessResponse {
	return { statusCode: httpStatusCode, body: { data } };
}

/**
 * Build the health response. `status` stays the reference's machine field; `label` is the localized
 * human string, so an operator reading `curl /healthz` in their own language is not a breaking change
 * for monitors.
 */
export function buildHealthResponse(
	readiness: 'ready' | 'not-ready',
	runtime: LocalizationRuntime = createProductRuntime(),
	locale?: string,
): ApiHealthResponse {
	const ready = readiness === 'ready';
	return {
		statusCode: ready ? 200 : 503,
		body: {
			status: ready ? 'ok' : 'error',
			label: runtime.t('api.health.ok', undefined, locale),
		},
	};
}
