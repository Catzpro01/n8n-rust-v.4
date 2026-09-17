import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createPairedItemResolver,
	resolvePairedItemRef,
	splitErrorOutput,
	withErrorItemProvenance,
} from '../src/error-recovery-policy.ts';

const runDataOf = (nodes) => nodes;

test('resolvePairedItemRef: mengikuti aturan workflow-execute.ts L2517-L2523', () => {
	assert.deepEqual(resolvePairedItemRef({ json: {}, pairedItem: { item: 3 } }), { item: 3 });
	// array -> ambil elemen pertama
	assert.deepEqual(resolvePairedItemRef({ json: {}, pairedItem: [{ item: 1 }, { item: 2 }] }), {
		item: 1,
	});
	// angka / tidak ada -> undefined (item dilewatkan apa adanya, L2525-L2527)
	assert.equal(resolvePairedItemRef({ json: {}, pairedItem: 2 }), undefined);
	assert.equal(resolvePairedItemRef({ json: {} }), undefined);
});

test('createPairedItemResolver: satu lompatan — item asal ditemukan (L980-L986)', () => {
	const runData = runDataOf({
		Source: [{ data: { main: [[{ json: { id: 1 } }, { json: { id: 2 } }]] }, source: [] }],
	});
	const resolver = createPairedItemResolver(runData);
	const found = resolver('Source', { previousNode: 'Source', previousNodeOutput: 0 }, { item: 1 });
	assert.deepEqual(found, { json: { id: 2 } });
});

test('createPairedItemResolver: indeks di luar output -> null (non-strict) / melempar (strict)', () => {
	const runData = runDataOf({ Source: [{ data: { main: [[{ json: { id: 1 } }]] }, source: [] }] });
	assert.equal(
		createPairedItemResolver(runData)('Source', { previousNode: 'Source' }, { item: 9 }),
		null,
	);
	assert.throws(
		() => createPairedItemResolver(runData, { strict: true })('Source', { previousNode: 'Source' }, { item: 9 }),
		/Missing paired item/,
	);
});

test('createPairedItemResolver: multi-lompatan menelusuri rantai pairedItem (L988-L1034)', () => {
	const runData = runDataOf({
		A: [{ data: { main: [[{ json: { origin: 'A0' } }]] }, source: [] }],
		B: [
			{
				data: { main: [[{ json: { fromB: true }, pairedItem: { item: 0, input: 0 } }]] },
				source: [{ previousNode: 'A', previousNodeOutput: 0, previousNodeRun: 0 }],
			},
		],
	});
	const resolver = createPairedItemResolver(runData);
	// Tujuan: A — mulai dari output B, ikuti pairedItem B -> A
	const found = resolver(
		'A',
		{ previousNode: 'B', previousNodeOutput: 0, previousNodeRun: 0 },
		{ item: 0 },
	);
	assert.deepEqual(found, { json: { origin: 'A0' } });
});

test('createPairedItemResolver: output hilang -> null (L931-L945 "Missing output data")', () => {
	const runData = runDataOf({ Source: [{ data: { main: [] }, source: [] }] });
	assert.equal(
		createPairedItemResolver(runData)('Source', { previousNode: 'Source', previousNodeOutput: 2 }, { item: 0 }),
		null,
	);
});

test('withErrorItemProvenance: JSON item asal digabung ke item error (L2549-L2554)', () => {
	const resolver = createPairedItemResolver({
		Source: [{ data: { main: [[{ json: { id: 42, name: 'catz' } }]] }, source: [] }],
	});
	const errorItem = { json: { error: 'row failed' }, pairedItem: { item: 0, input: 0 } };
	const enriched = withErrorItemProvenance(errorItem, {
		resolver,
		source: { main: [{ previousNode: 'Source', previousNodeOutput: 0, previousNodeRun: 0 }] },
	});
	assert.deepEqual(enriched.json, { id: 42, name: 'catz', error: 'row failed' });
	assert.deepEqual(enriched.pairedItem, { item: 0, input: 0 });
});

test('withErrorItemProvenance: tanpa resolver / source / pairedItem -> item tidak berubah (L2525-L2527)', () => {
	const errorItem = { json: { error: 'row failed' }, pairedItem: { item: 0 } };
	const resolver = createPairedItemResolver({
		Source: [{ data: { main: [[{ json: { id: 1 } }]] }, source: [] }],
	});

	// tanpa opsi sama sekali
	assert.deepEqual(withErrorItemProvenance(errorItem), errorItem);
	// ada source tapi tanpa resolver
	assert.deepEqual(withErrorItemProvenance(errorItem, { source: { main: [{}] } }), errorItem);
	// ada resolver tapi item tanpa pairedItem
	const withoutPaired = { json: { error: 'x' } };
	assert.deepEqual(
		withErrorItemProvenance(withoutPaired, { resolver, source: { main: [{}] } }),
		withoutPaired,
	);
	// daftar source kosong
	assert.deepEqual(withErrorItemProvenance(errorItem, { resolver, source: { main: [] } }), errorItem);
	// resolver mengembalikan null (output tidak ada)
	assert.deepEqual(
		withErrorItemProvenance(errorItem, {
			resolver,
			source: { main: [{ previousNode: 'Unknown', previousNodeOutput: 0 }] },
		}),
		errorItem,
	);
});

test('splitErrorOutput: dengan provenance, item error di output "Error" bawa data asalnya', () => {
	const resolver = createPairedItemResolver({
		Source: [{ data: { main: [[{ json: { id: 7 } }]] }, source: [] }],
	});
	const { data, errorItems } = splitErrorOutput(
		[[{ json: { ok: 1 } }, { json: { error: 'boom' }, pairedItem: { item: 0 } }], []],
		2,
		{ resolver, source: { main: [{ previousNode: 'Source', previousNodeOutput: 0 }] } },
	);
	assert.deepEqual(data[0], [{ json: { ok: 1 } }]);
	assert.deepEqual(errorItems, [{ json: { id: 7, error: 'boom' }, pairedItem: { item: 0 } }]);
	assert.deepEqual(data[1], errorItems);
});

test('splitErrorOutput: tanpa opsi provenance -> periloku lama (item apa adanya)', () => {
	const { errorItems } = splitErrorOutput(
		[[{ json: { error: 'boom' }, pairedItem: { item: 0 } }], []],
		2,
	);
	assert.deepEqual(errorItems, [{ json: { error: 'boom' }, pairedItem: { item: 0 } }]);
});
