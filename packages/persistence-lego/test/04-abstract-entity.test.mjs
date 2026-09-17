/**
 * POOL-004 · Suite 04 — @n8n/db entities/abstract-entity.ts (value layer)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	timestampSyntaxFor,
	jsonColumnTypeFor,
	datetimeColumnTypeFor,
	binaryColumnTypeFor,
	jsonColumnOptions,
	tsColumnOptionsFor,
	mixinStringId,
	mixinCreatedAt,
	mixinUpdatedAt,
	WithStringId,
	WithTimestamps,
	WithTimestampsAndStringId,
} from '../src/entities/abstract-entity.mjs';

test('dialect maps: both dialects exact', () => {
	assert.equal(timestampSyntaxFor('sqlite'), "STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')");
	assert.equal(timestampSyntaxFor('postgresdb'), 'CURRENT_TIMESTAMP(3)');

	assert.equal(jsonColumnTypeFor('sqlite'), 'simple-json');
	assert.equal(jsonColumnTypeFor('postgresdb'), 'json');

	assert.equal(datetimeColumnTypeFor('sqlite'), 'datetime');
	assert.equal(datetimeColumnTypeFor('postgresdb'), 'timestamptz');

	assert.equal(binaryColumnTypeFor('sqlite'), 'blob');
	assert.equal(binaryColumnTypeFor('postgresdb'), 'bytea');
});

test('column options spread order: explicit `type` in options is overridden by the dialect type', () => {
	// Reference: Column({ ...options, type: jsonColumnType }) — type key comes AFTER the spread.
	assert.deepEqual(jsonColumnOptions({ nullable: true, type: 'text' }, 'sqlite'), {
		nullable: true,
		type: 'simple-json',
	});
	assert.deepEqual(jsonColumnOptions(undefined, 'postgresdb'), { type: 'json' });
});

test('tsColumnOptions: { precision: 3, default: () => timestampSyntax, type: datetimeColumnType }', () => {
	for (const dbType of ['sqlite', 'postgresdb']) {
		const opts = tsColumnOptionsFor(dbType);
		assert.equal(opts.precision, 3);
		assert.equal(opts.type, datetimeColumnTypeFor(dbType));
		assert.equal(opts.default(), timestampSyntaxFor(dbType));
	}
});

test('generateId hook: assigns nanoid only when id is falsy (reference @BeforeInsert)', () => {
	class Row extends mixinStringId() {}

	const fresh = new Row();
	assert.equal(fresh.id, undefined);
	fresh.generateId();
	assert.match(fresh.id, /^[0-9A-Za-z]{16}$/);

	for (const preset of ['keep-me', 'NON-empty']) {
		const kept = new Row();
		kept.id = preset;
		kept.generateId();
		assert.equal(kept.id, preset);
	}

	const empty = new Row();
	empty.id = ''; // falsy -> regenerated, exactly like the reference guard
	empty.generateId();
	assert.match(empty.id, /^[0-9A-Za-z]{16}$/);
});

test('setUpdateDate hook: replaces updatedAt with a fresh Date (reference @BeforeUpdate)', () => {
	class Row extends mixinUpdatedAt() {}
	const row = new Row();
	row.updatedAt = new Date(946684800000); // 2000-01-01
	row.setUpdateDate();
	assert.ok(row.updatedAt instanceof Date);
	assert.ok(row.updatedAt.getTime() > 946684800000);
});

test('mixin composition matches reference: WithTimestamps = CreatedAt(UpdatedAt(Base)); +StringId on top', () => {
	class Row extends WithTimestampsAndStringId {}
	const row = new Row();
	row.generateId();
	row.setUpdateDate();
	assert.match(row.id, /^[0-9A-Za-z]{16}$/);
	assert.ok(row.updatedAt instanceof Date);

	// WithStringId carries only the id hook (no setUpdateDate in prototype chain of mixinStringId alone)
	class IdOnly extends WithStringId {}
	assert.equal(typeof IdOnly.prototype.generateId, 'function');
	assert.equal(IdOnly.prototype.setUpdateDate, undefined);

	// WithTimestamps carries setUpdateDate but no generateId
	class TsOnly extends WithTimestamps {}
	assert.equal(typeof TsOnly.prototype.setUpdateDate, 'function');
	assert.equal(TsOnly.prototype.generateId, undefined);

	// WithUpdatedAt is mixin alone (createdAt marker class exists structurally)
	assert.equal(typeof mixinCreatedAt(), 'function');
});
