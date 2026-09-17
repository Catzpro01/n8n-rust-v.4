/**
 * `utils.ts` (pinned `reference/n8n/packages/workflow/src/utils.ts`, 512 ln) — the deterministic
 * helper surface the Node Model boundary owns. Line anchors:
 *
 *   isObject                     L29-35    plain-object guard (NOT the `lodash/isObject` subset,
 *                                        which is DELTA-01's `lodashIsObject` in `lodash-lite.mjs`)
 *   isObjectEmpty                L37-49    incl. FormData / Set / Map / typed arrays / streams
 *   base64DecodeUTF8             L195-209  `atob` + TextDecoder, console fallback on failure
 *   replaceCircularReferences    L211-233  toJSON-first, WeakSet bookkeeping, readonly-property skip
 *   jsonStringify                L235-237
 *   fileTypeFromMimeType         L261-270
 *   assert                       L272-289  V8 `captureStackTrace` frame hiding
 *   isTraversableObject          L290-292
 *   removeCircularRefs           L294-314  in-place `{ circularReference: true }` markers
 *   randomInt                    L337-343  `crypto.getRandomValues` (global WebCrypto)
 *   randomString                 L354-361  ALPHABET from `constants.ts` L1-4
 *   hasKey                       L364-366
 *   isSafeObjectProperty         L396-397  + the `unsafeObjectProperties` set L367-387
 *   setSafeObjectProperty        L405-412
 *   isDomainAllowed              L415-466  wildcard `*.` semantics, trailing-dot normalisation
 *   isCommunityPackageName       L468-475
 *   sanitizeFilename             L496-511  `path.basename` via `node:path`
 *
 * Completed by TASK-UTILS-02 (the trio the coverage manifest used to defer):
 *   sleep                        L239-241  resolves on the injected timer
 *   sleepWithAbort               L243-259  rejects with `ManualExecutionCancelledError('')`
 *   updateDisplayOptions         L316-326  lodash `merge` subset over `displayOptions`
 *
 * Still out of this module (tracked by the coverage manifest in `tools/node-lego-coverage.mjs`):
 *   dedupe                       L477-479  already owned by `workflow-lego`/`workflow-model-lego`
 *   deepCopy / jsonParse         L53-193   live in `deep-copy.mjs` / `type-validation.mjs`
 *
 * Deltas used here: DELTA-06 (the reference's `LoggerProxy` call sites become an injected logger,
 * and `setUtilsTimerFns` is the same seam for `sleep`/`sleepWithAbort` — the defaults are the
 * globals, so the default behaviour is 1:1),
 * no-op by default; this module's `replaceCircularReferences` and `base64DecodeUTF8` fallback).
 * Boundaries: imports `./lodash-lite.mjs` (`lodashIsObject` semantics not needed here) and
 * `node:path` only.
 */

import { basename } from 'node:path';

import { ManualExecutionCancelledError } from './errors.mjs';
import { merge } from './lodash-lite.mjs';

/** utils.ts L9/L1-4 — `ALPHABET` is `DIGITS + UPPERCASE + lowercase` from `constants.ts`. */
const DIGITS = '0123456789';
const UPPERCASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHABET = [DIGITS, UPPERCASE_LETTERS, UPPERCASE_LETTERS.toLowerCase()].join('');

/** utils.ts L14 */
const readStreamClasses = new Set(['ReadStream', 'Readable', 'ReadableStream']);

/** DELTA-06: the reference warns/errors through `LoggerProxy`; injected, no-op by default. */
let fallbackLogger = { warn: () => {}, error: () => {} };

/** Test/embedding seam for DELTA-06 (never called by the reference surface itself). */
export const setUtilsLogger = (logger) => {
	fallbackLogger = logger ?? { warn: () => {}, error: () => {} };
};

/** utils.ts L29-35 */
export const isObject = (value) => {
	if (value === null || typeof value !== 'object') return false;
	if (Array.isArray(value)) return false;
	if (Object.prototype.toString.call(value) !== '[object Object]') return false;

	return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
};

/** utils.ts L37-49 */
export const isObjectEmpty = (obj) => {
	if (obj === undefined || obj === null) return true;
	if (typeof obj === 'object') {
		if (typeof FormData !== 'undefined' && obj instanceof FormData) return obj.getLengthSync() === 0;
		if (Array.isArray(obj)) return obj.length === 0;
		if (obj instanceof Set || obj instanceof Map) return obj.size === 0;
		if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return obj.byteLength === 0;
		if (Symbol.iterator in obj || readStreamClasses.has(obj.constructor.name)) return false;
		return Object.keys(obj).length === 0;
	}
	return true;
};

/** utils.ts L195-209 */
export const base64DecodeUTF8 = (str) => {
	try {
		const bytes = new Uint8Array(
			atob(str)
				.split('')
				.map((char) => char.charCodeAt(0)),
		);
		return new TextDecoder('utf-8').decode(bytes);
	} catch (error) {
		fallbackLogger.warn('TextDecoder not available, using fallback method');
		return atob(str);
	}
};

/** utils.ts L211-233 */
export const replaceCircularReferences = (value, knownObjects = new WeakSet()) => {
	if (typeof value !== 'object' || value === null || value instanceof RegExp) return value;
	if ('toJSON' in value && typeof value.toJSON === 'function') return value.toJSON();
	if (knownObjects.has(value)) return '[Circular Reference]';
	knownObjects.add(value);
	const copy = Array.isArray(value) ? [] : {};
	for (const key in value) {
		try {
			copy[key] = replaceCircularReferences(value[key], knownObjects);
		} catch (error) {
			if (error instanceof TypeError && error.message.includes('Cannot assign to read only property')) {
				fallbackLogger.error('Error while replacing circular references: ' + error.message, { error });
				continue; // Skip properties that cannot be assigned to (readonly, non-configurable, etc.)
			}
			throw error;
		}
	}
	knownObjects.delete(value);
	return copy;
};

/** utils.ts L235-237 */
export const jsonStringify = (obj, options = {}) =>
	JSON.stringify(options?.replaceCircularRefs ? replaceCircularReferences(obj) : obj);

/** utils.ts L261-270 */
export const fileTypeFromMimeType = (mimeType) => {
	if (mimeType.startsWith('application/json')) return 'json';
	if (mimeType.startsWith('text/html')) return 'html';
	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType.startsWith('audio/')) return 'audio';
	if (mimeType.startsWith('video/')) return 'video';
	if (mimeType.startsWith('text/') || mimeType.startsWith('application/javascript')) return 'text';
	if (mimeType.startsWith('application/pdf')) return 'pdf';
	return undefined;
};

/** utils.ts L272-289 */
export const assert = (condition, msg) => {
	if (!condition) {
		const error = new Error(msg ?? 'Invalid assertion');
		// hide assert stack frame if supported
		if (Error.hasOwnProperty('captureStackTrace')) {
			// V8 only
			Error.captureStackTrace(error, assert);
		} else if (error.stack) {
			// fallback for IE and Firefox
			error.stack = error.stack.split('\n').slice(1).join('\n');
		}
		throw error;
	}
};

/** utils.ts L290-292 */
export const isTraversableObject = (value) =>
	value && typeof value === 'object' && !Array.isArray(value) && !!Object.keys(value).length;

/** utils.ts L294-314 */
export const removeCircularRefs = (obj, seen = new Set()) => {
	seen.add(obj);
	Object.entries(obj).forEach(([key, value]) => {
		if (isTraversableObject(value)) {
			seen.has(value) ? (obj[key] = { circularReference: true }) : removeCircularRefs(value, seen);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((val, index) => {
				if (seen.has(val)) {
					value[index] = { circularReference: true };
					return;
				}
				if (isTraversableObject(val)) {
					removeCircularRefs(val, seen);
				}
			});
		}
	});
};

/** utils.ts L328-343 (both overloads collapse into the one implementation). */
export const randomInt = (min, max) => {
	if (max === undefined) {
		max = min;
		min = 0;
	}
	return min + (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min));
};

/** utils.ts L345-361 */
export const randomString = (minLength, maxLength) => {
	const length = maxLength === undefined ? minLength : randomInt(minLength, maxLength + 1);
	return [...crypto.getRandomValues(new Uint32Array(length))]
		.map((byte) => ALPHABET[byte % ALPHABET.length])
		.join('');
};

/** utils.ts L364-366 */
export const hasKey = (value, key) => value !== null && typeof value === 'object' && value.hasOwnProperty(key);

/** utils.ts L367-387 */
const unsafeObjectProperties = new Set([
	'__proto__',
	'prototype',
	'constructor',
	'getPrototypeOf',
	'mainModule',
	'binding',
	'_linkedBinding',
	'_load',
	'prepareStackTrace',
	'__lookupGetter__',
	'__lookupSetter__',
	'__defineGetter__',
	'__defineSetter__',
	'caller',
	'arguments',
	'getBuiltinModule',
	'dlopen',
	'execve',
	'loadEnvFile',
]);

/** utils.ts L396-397 */
export const isSafeObjectProperty = (property) => !unsafeObjectProperties.has(property);

/** utils.ts L405-412 */
export const setSafeObjectProperty = (target, property, value) => {
	if (isSafeObjectProperty(property)) {
		target[property] = value;
	}
};

/** utils.ts L415-466 */
export const isDomainAllowed = (urlString, options) => {
	if (!options.allowedDomains || options.allowedDomains.trim() === '') {
		return true; // If no restrictions are set, allow all domains
	}

	try {
		const url = new URL(urlString);

		// Normalize hostname: lowercase and remove trailing dot
		const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

		// Reject empty hostnames
		if (!hostname) {
			return false;
		}

		const allowedDomainsList = options.allowedDomains
			.split(',')
			.map((domain) => domain.trim().toLowerCase().replace(/\.$/, ''))
			.filter(Boolean);

		for (const allowedDomain of allowedDomainsList) {
			// Handle wildcard domains (*.example.com)
			if (allowedDomain.startsWith('*.')) {
				const domainSuffix = allowedDomain.substring(2);
				// Ensure the suffix itself is valid
				if (!domainSuffix) continue;

				// Wildcard matches only subdomains, not the base domain itself
				// *.example.com matches sub.example.com but NOT example.com
				if (hostname.endsWith('.' + domainSuffix)) {
					return true;
				}
			}
			// Exact match
			else if (hostname === allowedDomain) {
				return true;
			}
		}

		return false;
	} catch (error) {
		// If URL parsing fails, deny access to be safe
		return false;
	}
};

/** utils.ts L468-475 */
const COMMUNITY_PACKAGE_NAME_REGEX = /^(?!@n8n\/)(@[\w.-]+\/)?n8n-nodes-(?!base\b)\b\w+/g;

/** utils.ts L469-475 */
export const isCommunityPackageName = (packageName) => {
	COMMUNITY_PACKAGE_NAME_REGEX.lastIndex = 0;
	// Community packages names start with <@username/>n8n-nodes- not followed by word 'base'
	const nameMatch = COMMUNITY_PACKAGE_NAME_REGEX.exec(packageName);

	return !!nameMatch;
};

/** utils.ts L496-511 */
export const sanitizeFilename = (fileName) => {
	// Normalize to forward slashes first to handle Windows paths on Unix
	const normalized = fileName.replace(/\\/g, '/');

	// Extract just the filename, stripping all directory components
	let sanitized = basename(normalized);

	// Remove null bytes which could be used for null byte injection attacks
	sanitized = sanitized.replace(/\0/g, '');

	// If the result is empty or just dots, use a default name
	if (!sanitized || /^\.+$/.test(sanitized)) {
		sanitized = 'untitled';
	}

	return sanitized;
};

/**
 * Timer seam (DELTA-06): `sleep`/`sleepWithAbort` use the global timer functions by default — the
 * reference's own behaviour — and the seam exists so tests can drive time deterministically.
 * `setUtilsTimerFns(null)` restores the defaults.
 */
const DEFAULT_TIMER_FNS = {
	setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
	clearTimeout: (id) => globalThis.clearTimeout(id),
};

let timerFns = DEFAULT_TIMER_FNS;

export function setUtilsTimerFns(fns) {
	timerFns = fns ? { ...DEFAULT_TIMER_FNS, ...fns } : DEFAULT_TIMER_FNS;
}

/** utils.ts L239-241 — resolves after `ms`, no abort support (`sleepWithAbort` has that). */
export const sleep = async (ms) =>
	await new Promise((resolve) => {
		timerFns.setTimeout(resolve, ms);
	});

/**
 * utils.ts L243-259 — resolves after `ms`, or rejects with `ManualExecutionCancelledError('')`
 * when the signal aborts (already-aborted signals reject immediately, without starting a timer).
 *
 * Pinned quirks: the abort listener is registered with `{ once: true }` and is **never removed** on
 * a normal resolve, so a signal that is aborted *after* the sleep resolved has no listener left to
 * fire (the timer already won); and `clearTimeout` is called only on the abort path.
 */
export const sleepWithAbort = async (ms, abortSignal) =>
	await new Promise((resolve, reject) => {
		if (abortSignal?.aborted) {
			reject(new ManualExecutionCancelledError('')); // utils.ts L244
			return;
		}

		const timeout = timerFns.setTimeout(resolve, ms);

		const abortHandler = () => {
			timerFns.clearTimeout(timeout);
			reject(new ManualExecutionCancelledError('')); // utils.ts L252
		};

		abortSignal?.addEventListener('abort', abortHandler, { once: true });
	});

/**
 * utils.ts L316-326 — folds `displayOptions` into every property's own `displayOptions`.
 *
 * The merge target is a fresh `{}` per property and the property objects are copied shallowly
 * (`{ ...nodeProperty }`), so the caller's `properties` array is never mutated — but non-plain
 * objects inside a display option are attached **by reference** (lodash behaviour, see
 * `lodash-lite.merge`), and a property without `displayOptions` gains the caller's options as-is.
 */
export function updateDisplayOptions(displayOptions, properties) {
	return properties.map((nodeProperty) => {
		return {
			...nodeProperty,
			displayOptions: merge({}, nodeProperty.displayOptions, displayOptions),
		};
	});
}
