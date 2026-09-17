/**
 * Execution Data LEGO — binary data representation.
 *
 * 1:1 reconstruction of the *pure* part of the n8n 2.9.4 binary path:
 *   packages/workflow/src/utils.ts:261-270                 (fileTypeFromMimeType)
 *   packages/core/src/binary-data/utils.ts:7-10            (isStoredMode)
 *   packages/core/src/binary-data/binary-data.service.ts:234-236 (createBinaryDataId)
 *   packages/core/src/binary-data/binary-data.service.ts:70-126  (store / copyBinaryFile)
 *   packages/core/src/.../binary-helper-functions.ts:256-341     (prepareBinaryData)
 *
 * BOUNDARY (deliberately NOT reconstructed — needs a live BinaryDataService,
 * a filesystem/S3 manager or an HTTP response stream):
 *   - `FileType.fromBuffer()` content sniffing (binary-helper-functions.ts:294)
 *   - `IncomingMessage` handling (`contentDisposition`, `responseUrl`)  :265-278
 *   - the filesystem-v2 / s3 / database managers themselves
 * Everything above the manager call is reconstructed byte-for-byte.
 */

import path from 'node:path';

import { BINARY_ENCODING, BINARY_MODE_DEFAULT, STORED_MODES } from './constants.mjs';
import { prettyBytes } from './pretty-bytes.mjs';

/**
 * Pinned subset of `mime-types.lookup()` (n8n: binary-helper-functions.ts:285).
 * The complete table is a data dependency, not behaviour — the port may swap in
 * the real `mime-types` package without changing any rule below.
 */
const MIME_BY_EXTENSION = {
	txt: 'text/plain',
	csv: 'text/csv',
	html: 'text/html',
	htm: 'text/html',
	json: 'application/json',
	xml: 'application/xml',
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	mp4: 'video/mp4',
	js: 'application/javascript',
	zip: 'application/zip',
};

/**
 * Pinned subset of `mime-types.extension()` (n8n: binary-helper-functions.ts:308).
 */
const EXTENSION_BY_MIME = {
	'text/plain': 'txt',
	'text/csv': 'csv',
	'text/html': 'html',
	'application/json': 'json',
	'application/xml': 'xml',
	'application/pdf': 'pdf',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'audio/mpeg': 'mp3',
	'audio/wav': 'wav',
	'video/mp4': 'mp4',
	'application/javascript': 'js',
	'application/zip': 'zip',
};

export function defaultMimeLookup(filePath) {
	const ext = path.extname(filePath).slice(1).toLowerCase();
	return MIME_BY_EXTENSION[ext];
}

export function defaultExtensionFor(mimeType) {
	return EXTENSION_BY_MIME[mimeType.split(';')[0].trim()];
}

/**
 * `packages/workflow/src/utils.ts:261-270` — verbatim.
 * ORDER MATTERS: `application/json` is tested before the generic `application/*`
 * fallbacks, and `text/` is tested before `application/pdf`, so
 * `text/plain` -> 'text' while `application/pdf` -> 'pdf'.
 */
export function fileTypeFromMimeType(mimeType) {
	if (mimeType.startsWith('application/json')) return 'json';
	if (mimeType.startsWith('text/html')) return 'html';
	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType.startsWith('audio/')) return 'audio';
	if (mimeType.startsWith('video/')) return 'video';
	if (mimeType.startsWith('text/') || mimeType.startsWith('application/javascript')) return 'text';
	if (mimeType.startsWith('application/pdf')) return 'pdf';
	return undefined;
}

/**
 * `packages/core/src/binary-data/utils.ts:7-10` — verbatim.
 */
export function isStoredMode(mode) {
	return STORED_MODES.includes(mode);
}

/**
 * `packages/core/src/binary-data/binary-data.service.ts:234-236` — verbatim.
 */
export function createBinaryDataId(mode, fileId) {
	return `${mode}:${fileId}`;
}

/**
 * The metadata half of `prepareBinaryData`
 * (`packages/core/src/.../binary-helper-functions.ts:263-341`), reconstructed
 * 1:1 minus the async content sniffing (see the BOUNDARY note above).
 *
 * FROZEN QUIRK (B-01): when no mime type can be determined n8n falls back to
 * `'text/plain'` — never to `undefined`.
 * FROZEN QUIRK (B-02): `filePath` always wins over the mime-derived extension,
 * because the `filePath` block runs *after* `returnData` is built and
 * overwrites `fileExtension` (only when the parsed extension is non-empty).
 * FROZEN QUIRK (B-03): `directory` is only set for a *relative* path — an
 * absolute path has `filePathParts.dir !== ''` and therefore also qualifies,
 * while a bare filename (dir === '') leaves `directory` undefined.
 */
export function prepareBinaryDataMetadata({
	filePath,
	mimeType,
	fullUrl,
	mimeLookup = defaultMimeLookup,
	extensionFor = defaultExtensionFor,
} = {}) {
	if (!mimeType) {
		if (filePath) {
			const mimeTypeLookup = mimeLookup(filePath);
			if (mimeTypeLookup) {
				mimeType = mimeTypeLookup;
			}
		}
		if (!mimeType) {
			// Fall back to text
			mimeType = 'text/plain';
		}
	}

	let fileExtension;
	if (mimeType) {
		fileExtension = extensionFor(mimeType) || undefined;
	}

	/** @type {import('./index.mjs').IBinaryData} */
	const returnData = {
		mimeType,
		fileType: fileTypeFromMimeType(mimeType),
		fileExtension,
		data: '',
	};

	if (filePath) {
		const filePathParts = path.parse(filePath);

		if (fullUrl) {
			returnData.directory = fullUrl;
		} else if (filePathParts.dir !== '') {
			returnData.directory = filePathParts.dir;
		}

		returnData.fileName = filePathParts.base;

		// Remove the dot
		const ext = filePathParts.ext.slice(1);
		if (ext) {
			returnData.fileExtension = ext;
		}
	}

	return returnData;
}

/**
 * `binary-data.service.ts:104-110` — the `default` (in-memory) branch of
 * `store()`: no manager, so the payload is base64-encoded inline and the size
 * metadata is computed locally.
 */
export function storeBinaryDataInMemory(binaryData, buffer) {
	return {
		...binaryData,
		data: buffer.toString(BINARY_ENCODING),
		fileSize: prettyBytes(buffer.length),
		bytes: buffer.length,
	};
}

/**
 * `binary-data.service.ts:111-126` — the stored-mode branch of `store()` /
 * `copyBinaryFile()`: the payload is dropped from memory (`data` becomes the
 * mode name) and an `id` is minted.
 */
export function storeBinaryDataExternally(binaryData, { mode, fileId, fileSize }) {
	return {
		...binaryData,
		id: createBinaryDataId(mode, fileId),
		fileSize: prettyBytes(fileSize),
		bytes: fileSize,
		data: mode, // clear binary data from memory
	};
}

/**
 * Convenience: pick the branch from the configured mode, exactly as
 * `BinaryDataService.store()` does via `this.managers[this.mode]`.
 */
export function storeBinaryData(binaryData, bufferOrSize, { mode = BINARY_MODE_DEFAULT, fileId } = {}) {
	if (isStoredMode(mode)) {
		if (!fileId) {
			throw new Error('stored binary modes require a fileId');
		}
		const fileSize = typeof bufferOrSize === 'number' ? bufferOrSize : bufferOrSize.length;
		return storeBinaryDataExternally(binaryData, { mode, fileId, fileSize });
	}
	if (typeof bufferOrSize === 'number') {
		throw new Error('the in-memory binary mode requires a Buffer, not a size');
	}
	return storeBinaryDataInMemory(binaryData, bufferOrSize);
}

/**
 * Inverse of `storeBinaryDataInMemory` for the default mode
 * (`BinaryDataService.getAsBuffer()` without a manager).
 */
export function getBinaryDataBuffer(binaryData) {
	if (binaryData.id) {
		throw new Error(
			`binary data with id "${binaryData.id}" is stored externally; resolution requires BinaryDataService`,
		);
	}
	return Buffer.from(binaryData.data ?? '', BINARY_ENCODING);
}

/**
 * Contract invariant I10, as an executable check.
 *
 *   default mode    -> `data` is base64, `bytes`/`fileSize`/`fileType`/
 *                      `fileExtension` are set, `id` is ABSENT
 *   stored mode     -> `id = "<mode>:<fileId>"`, `data === "<mode>"`,
 *                      size metadata still present
 */
export function checkBinaryRepresentation(binaryData, mode = BINARY_MODE_DEFAULT) {
	const errors = [];

	if (isStoredMode(mode)) {
		if (binaryData?.data !== mode) {
			errors.push(`stored mode: data must equal the mode name ("${mode}")`);
		}
		if (typeof binaryData?.id !== 'string' || !binaryData.id.startsWith(`${mode}:`)) {
			errors.push(`stored mode: id must be of the form "<mode>:<fileId>" (mode "${mode}")`);
		}
	} else {
		if (binaryData?.id !== undefined) {
			errors.push('default mode: id must be absent');
		}
		if (typeof binaryData?.data !== 'string') {
			errors.push('default mode: data must be a base64 string');
		}
	}

	if (typeof binaryData?.fileSize !== 'string' || binaryData.fileSize === '') {
		errors.push('fileSize must be a non-empty human readable string (prettyBytes)');
	}
	if (typeof binaryData?.bytes !== 'number') {
		errors.push('bytes must be the raw payload length as a number');
	}

	return { ok: errors.length === 0, errors };
}
