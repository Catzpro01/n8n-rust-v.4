import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CREDENTIAL_BLANKING_VALUE,
	CREDENTIAL_EMPTY_VALUE,
	redactCollectionOption,
	redactValues,
	unredact,
	unredactRestoreValues,
} from '../src/redaction.mjs';
import { HTTP_HEADER_AUTH_PROPERTIES } from './helpers/reference.mjs';

const pw = (name, extra = {}) => ({
	name,
	type: 'string',
	typeOptions: { password: true },
	...extra,
});

test('a password-typed property is replaced by the blanking value', () => {
	const data = { user: 'u', pass: 'hunter2' };
	const out = redactValues(data, [{ name: 'user', type: 'string' }, pw('pass')]);
	assert.equal(out.pass, CREDENTIAL_BLANKING_VALUE);
	assert.equal(out.user, 'u', 'a plain property is returned as stored');
});

test('R-05 an empty password becomes the EMPTY sentinel, not the blanking one', () => {
	const out = redactValues({ pass: '' }, [pw('pass')]);
	assert.equal(out.pass, CREDENTIAL_EMPTY_VALUE);
});

test('R-02 a key with no matching property is left completely untouched', () => {
	const out = redactValues({ unknown: 'secret', pass: 'x' }, [pw('pass')]);
	assert.equal(out.unknown, 'secret', 'redaction is property-driven, not data-driven');
	assert.equal(out.pass, CREDENTIAL_BLANKING_VALUE);
});

test('R-04 an expression value is left alone unless noDataExpression is set', () => {
	const expr = '={{ $vars.token }}';
	assert.equal(redactValues({ pass: expr }, [pw('pass')]).pass, expr);
	assert.equal(
		redactValues({ pass: expr }, [pw('pass', { noDataExpression: true })]).pass,
		CREDENTIAL_BLANKING_VALUE,
	);
});

test('R-04a a non-string value under a password property throws', () => {
	// `(data[dataKey]).startsWith('={{')` with no type guard.
	assert.throws(() => redactValues({ pass: 42 }, [pw('pass')]), TypeError);
	assert.throws(() => redactValues({ pass: null }, [pw('pass')]), TypeError);
});

test('R-01 oauthTokenData and csrfSecret are blanked with no property declared', () => {
	const out = redactValues({ oauthTokenData: { access_token: 't' }, csrfSecret: 's' }, []);
	assert.equal(out.oauthTokenData, CREDENTIAL_BLANKING_VALUE);
	assert.equal(out.csrfSecret, CREDENTIAL_BLANKING_VALUE);
});

test('R-01a …with the EMPTY sentinel when their stringification is empty', () => {
	const out = redactValues({ oauthTokenData: '', csrfSecret: [] }, []);
	assert.equal(out.oauthTokenData, CREDENTIAL_EMPTY_VALUE);
	assert.equal(out.csrfSecret, CREDENTIAL_EMPTY_VALUE, '[].toString() is ""');
});

test('R-01b …and a null value there throws, because toString is unguarded', () => {
	assert.throws(() => redactValues({ oauthTokenData: null }, []), TypeError);
});

test('R-06 the first property with a matching name wins', () => {
	const props = [pw('pass', { noDataExpression: true }), { name: 'pass', type: 'string' }];
	// The second (non-password) entry is shadowed, so the value is still blanked.
	assert.equal(redactValues({ pass: 'x' }, props).pass, CREDENTIAL_BLANKING_VALUE);
	const reversed = [{ name: 'pass', type: 'string' }, pw('pass')];
	assert.equal(redactValues({ pass: 'x' }, reversed).pass, 'x');
});

test('R-07 redactValues mutates in place and returns the same object', () => {
	const data = { pass: 'x' };
	const out = redactValues(data, [pw('pass')]);
	assert.equal(out, data);
	assert.equal(data.pass, CREDENTIAL_BLANKING_VALUE);
});

test('R-03 a fixedCollection is redacted recursively, and still password-checked', () => {
	const props = [
		{
			name: 'headers',
			type: 'fixedCollection',
			options: [
				{ name: 'values', values: [pw('secret')] },
				{ name: 'ignored', displayName: 'not a collection' },
			],
		},
	];
	const data = { headers: { values: [{ secret: 's', keep: 'k' }] } };
	redactValues(data, props);
	assert.equal(data.headers.values[0].secret, CREDENTIAL_BLANKING_VALUE);
	assert.equal(data.headers.values[0].keep, 'k');
});

test('R-08 redactCollectionOption handles the array shape and skips null', () => {
	const option = { name: 'values', values: [pw('secret')] };

	const withArray = { values: [{ secret: 's' }] };
	redactCollectionOption(withArray, option);
	assert.equal(withArray.values[0].secret, CREDENTIAL_BLANKING_VALUE);

	const withObject = { values: { secret: 's' } };
	redactCollectionOption(withObject, option);
	assert.equal(withObject.values.secret, CREDENTIAL_BLANKING_VALUE);

	const withNull = { values: null };
	redactCollectionOption(withNull, option);
	assert.equal(withNull.values, null, 'null is explicitly skipped');

	const missing = {};
	redactCollectionOption(missing, option);
	assert.deepEqual(missing, {}, 'a missing key is not created');
});

test('R-10 unredactRestoreValues restores sentinels, recursing into objects', () => {
	const merged = { pass: CREDENTIAL_BLANKING_VALUE, nested: { token: CREDENTIAL_EMPTY_VALUE } };
	unredactRestoreValues(merged, { pass: 'hunter2', nested: { token: '' } });
	assert.deepEqual(merged, { pass: 'hunter2', nested: { token: '' } });
});

test('R-10a a blanked key absent from the saved data becomes undefined', () => {
	const merged = { pass: CREDENTIAL_BLANKING_VALUE };
	unredactRestoreValues(merged, {});
	assert.equal(merged.pass, undefined);
	assert.equal('pass' in merged, true, 'the key survives, as undefined');
});

test('R-09 recursion walks arrays by index', () => {
	const merged = { list: [{ token: CREDENTIAL_BLANKING_VALUE }] };
	unredactRestoreValues(merged, { list: [{ token: 'live' }] });
	assert.deepEqual(merged, { list: [{ token: 'live' }] });
});

test('unredact returns a deep copy and leaves the redacted payload untouched', () => {
	const redacted = { nested: { pass: CREDENTIAL_BLANKING_VALUE } };
	const saved = { nested: { pass: 'hunter2' } };
	const out = unredact(redacted, saved);

	assert.deepEqual(out, { nested: { pass: 'hunter2' } });
	assert.equal(redacted.nested.pass, CREDENTIAL_BLANKING_VALUE, 'input is not mutated');
	assert.notEqual(out.nested, redacted.nested, 'deep copy, not shared reference');
});

test('golden shape: httpHeaderAuth leaves `name` and blanks `value`', () => {
	const data = { name: 'X-Dummy', value: 'super-secret' };
	const out = redactValues(data, HTTP_HEADER_AUTH_PROPERTIES);
	assert.equal(out.name, 'X-Dummy');
	assert.equal(out.value, CREDENTIAL_BLANKING_VALUE);
});
