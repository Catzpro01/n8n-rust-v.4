import { BINARY_ENCODING } from './constants.mjs';

/**
 * Formats byte count to human-readable string (e.g. "7 B", "1.5 kB", "2.3 MB").
 */
export function formatFileSize(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'kB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	if (i === 0) return `${bytes} B`;
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Infers fileType from mimeType.
 */
export function fileTypeFromMimeType(mimeType) {
	if (!mimeType) return undefined;
	const [type, sub] = mimeType.toLowerCase().split('/');
	if (type === 'image') return 'image';
	if (type === 'audio') return 'audio';
	if (type === 'video') return 'video';
	if (sub === 'pdf') return 'pdf';
	if (sub === 'json') return 'json';
	if (sub === 'html') return 'html';
	if (type === 'text') return 'text';
	return undefined;
}

/**
 * Prepares in-memory binary data object (default mode).
 */
export function prepareBinaryData(bufferOrString, fileName, mimeType = 'text/plain') {
	const buf = Buffer.isBuffer(bufferOrString)
		? bufferOrString
		: Buffer.from(bufferOrString ?? '', 'utf8');

	const bytes = buf.length;
	const data = buf.toString(BINARY_ENCODING);
	const fileSize = formatFileSize(bytes);
	const fileType = fileTypeFromMimeType(mimeType);

	let fileExtension;
	if (fileName && fileName.includes('.')) {
		fileExtension = fileName.split('.').pop();
	}

	const binaryData = {
		mimeType,
		fileType,
		data,
		fileName,
		fileSize,
		bytes,
	};

	if (fileExtension) {
		binaryData.fileExtension = fileExtension;
	}

	return binaryData;
}
