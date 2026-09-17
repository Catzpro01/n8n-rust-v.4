import assert from 'node:assert/strict';
import test from 'node:test';

import {
	checkBinaryRepresentation,
	createBinaryDataId,
	fileTypeFromMimeType,
	getBinaryDataBuffer,
	isStoredMode,
	prepareBinaryDataMetadata,
	prettyBytes,
	storeBinaryData,
	storeBinaryDataExternally,
	storeBinaryDataInMemory,
} from '../src/index.mjs';

test('fileTypeFromMimeType follows the upstream precedence', () => {
	assert.equal(fileTypeFromMimeType('application/json'), 'json');
	assert.equal(fileTypeFromMimeType('application/json; charset=utf-8'), 'json');
	assert.equal(fileTypeFromMimeType('text/html'), 'html');
	assert.equal(fileTypeFromMimeType('image/jpeg'), 'image');
	assert.equal(fileTypeFromMimeType('audio/mpeg'), 'audio');
	assert.equal(fileTypeFromMimeType('video/mp4'), 'video');
	assert.equal(fileTypeFromMimeType('application/javascript'), 'text');
	assert.equal(fileTypeFromMimeType('text/plain'), 'text');
	assert.equal(fileTypeFromMimeType('application/pdf'), 'pdf');
	assert.equal(fileTypeFromMimeType('application/zip'), undefined);
});

test('isStoredMode covers exactly the four manager-backed modes', () => {
	for (const mode of ['filesystem', 'filesystem-v2', 's3', 'database']) {
		assert.equal(isStoredMode(mode), true, mode);
	}
	for (const mode of ['default', 'combined', '']) {
		assert.equal(isStoredMode(mode), false, mode);
	}
});

test('createBinaryDataId mints "<mode>:<fileId>"', () => {
	assert.equal(
		createBinaryDataId('filesystem-v2', 'workflows/1/executions/2/binary_data/abc'),
		'filesystem-v2:workflows/1/executions/2/binary_data/abc',
	);
});

test('B-01/B-02: metadata falls back to text/plain and filePath wins the extension', () => {
	const meta = prepareBinaryDataMetadata({ filePath: 'f0.txt' });
	assert.deepEqual(meta, {
		mimeType: 'text/plain',
		fileType: 'text',
		fileExtension: 'txt',
		data: '',
		fileName: 'f0.txt',
	});

	const unknown = prepareBinaryDataMetadata({ filePath: 'blob.unknownext' });
	assert.equal(unknown.mimeType, 'text/plain', 'B-01: never undefined');
	assert.equal(unknown.fileType, 'text');
	assert.equal(unknown.fileExtension, 'unknownext', 'B-02: filePath extension wins');
	assert.equal(unknown.fileName, 'blob.unknownext');
});

test('B-03: directory is only set when the parsed dir is non-empty', () => {
	assert.equal(prepareBinaryDataMetadata({ filePath: 'f0.txt' }).directory, undefined);
	assert.equal(prepareBinaryDataMetadata({ filePath: 'sub/f0.txt' }).directory, 'sub');
	assert.equal(
		prepareBinaryDataMetadata({ filePath: 'sub/f0.txt', fullUrl: 'https://x/y' }).directory,
		'https://x/y',
		'fullUrl beats the parsed dir',
	);
});

test('an explicit mimeType skips lookup and drives fileType/fileExtension', () => {
	const meta = prepareBinaryDataMetadata({ filePath: 'payload', mimeType: 'application/json' });
	assert.equal(meta.fileType, 'json');
	assert.equal(meta.fileExtension, 'json');
	assert.equal(meta.fileName, 'payload');
});

test('default (in-memory) mode: base64 payload, prettyBytes size, no id', () => {
	const meta = prepareBinaryDataMetadata({ filePath: 'f0.txt' });
	const stored = storeBinaryDataInMemory(meta, Buffer.from('hello 0'));
	assert.deepEqual(stored, {
		mimeType: 'text/plain',
		fileType: 'text',
		fileExtension: 'txt',
		data: 'aGVsbG8gMA==',
		fileName: 'f0.txt',
		fileSize: '7 B',
		bytes: 7,
	});
	assert.equal(stored.id, undefined, 'I10: no id in default mode');
	assert.deepEqual(checkBinaryRepresentation(stored, 'default'), { ok: true, errors: [] });
	assert.equal(getBinaryDataBuffer(stored).toString(), 'hello 0');
});

test('stored mode: id is minted and the payload is replaced by the mode name', () => {
	const meta = prepareBinaryDataMetadata({ filePath: 'f0.txt' });
	const stored = storeBinaryDataExternally(meta, {
		mode: 'filesystem-v2',
		fileId: 'workflows/1/executions/2/binary_data/abc',
		fileSize: 7,
	});
	assert.equal(stored.data, 'filesystem-v2', 'payload cleared from memory');
	assert.equal(stored.id, 'filesystem-v2:workflows/1/executions/2/binary_data/abc');
	assert.equal(stored.fileSize, '7 B');
	assert.equal(stored.bytes, 7);
	assert.deepEqual(checkBinaryRepresentation(stored, 'filesystem-v2'), { ok: true, errors: [] });

	assert.throws(() => getBinaryDataBuffer(stored), /stored externally/);
});

test('storeBinaryData dispatches on the mode, exactly like BinaryDataService.store', () => {
	const meta = prepareBinaryDataMetadata({ filePath: 'f0.txt' });
	const inline = storeBinaryData(meta, Buffer.from('hello 0'));
	assert.equal(inline.data, 'aGVsbG8gMA==');

	const external = storeBinaryData(meta, Buffer.from('hello 0'), {
		mode: 's3',
		fileId: 'bucket/key',
	});
	assert.equal(external.data, 's3');
	assert.equal(external.id, 's3:bucket/key');
});

test('checkBinaryRepresentation reports every violation', () => {
	const bad = checkBinaryRepresentation({ data: 'x' }, 'default');
	assert.equal(bad.ok, false);
	assert.deepEqual(bad.errors, [
		'fileSize must be a non-empty human readable string (prettyBytes)',
		'bytes must be the raw payload length as a number',
	]);

	const wrongMode = checkBinaryRepresentation(
		{ data: 'inline', bytes: 1, fileSize: '1 B' },
		'filesystem-v2',
	);
	assert.equal(wrongMode.ok, false);
	assert.equal(wrongMode.errors.length, 2);
});

test('prettyBytes matches the sizes n8n records for binary metadata', () => {
	assert.equal(prettyBytes(0), '0 B');
	assert.equal(prettyBytes(1), '1 B');
	assert.equal(prettyBytes(7), '7 B');
	assert.equal(prettyBytes(999), '999 B');
	assert.equal(prettyBytes(1000), '1 kB');
	assert.equal(prettyBytes(1234), '1.23 kB');
	assert.equal(prettyBytes(1024), '1.02 kB');
	assert.equal(prettyBytes(1_500_000), '1.5 MB');
	assert.equal(prettyBytes(-7), '-7 B');
	assert.equal(prettyBytes(0.4), '0.4 B');
	assert.throws(() => prettyBytes(Infinity), /Expected a finite number/);
});
