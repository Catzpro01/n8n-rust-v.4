import assert from 'node:assert/strict';
import test from 'node:test';
import { getNodeParametersIssues, getParameterIssues, mergeIssues, validateFieldType } from '../src/index.mjs';

const node = (parameters = {}, extra = {}) => ({ id: '1', name: 'Test', type: 'test', typeVersion: 1, position: [0, 0], parameters, ...extra });

test('required issues cover strings, options, multi-options, dateTime and resource locators', () => {
	for (const property of [
		{ name: 's', displayName: 'S', type: 'string', required: true },
		{ name: 'o', displayName: 'O', type: 'options', required: true },
		{ name: 'm', displayName: 'M', type: 'multiOptions', required: true },
		{ name: 'd', displayName: 'D', type: 'dateTime', required: true },
		{ name: 'r', displayName: 'R', type: 'resourceLocator', required: true },
	]) {
		const empty = property.type === 'multiOptions' ? [] : property.type === 'resourceLocator' ? { mode: 'id', value: '' } : '';
		assert.deepEqual(getParameterIssues(property, { [property.name]: empty }, '', node(), null), {
			parameters: { [property.name]: [`Parameter "${property.displayName}" is required.`] },
		});
	}
});

test('hidden required parameters do not produce issues', () => {
	const property = { name: 'secret', displayName: 'Secret', type: 'string', required: true, displayOptions: { show: { mode: ['show'] } } };
	assert.deepEqual(getParameterIssues(property, { mode: 'hide', secret: '' }, '', node(), null), {});
});

test('resource locator mode regex errors and expressions bypass validation', () => {
	const property = { name: 'id', displayName: 'ID', type: 'resourceLocator', modes: [{ name: 'id', validation: [{ type: 'regex', properties: { regex: '[0-9]+', errorMessage: 'digits only' } }] }] };
	assert.deepEqual(getParameterIssues(property, { id: { mode: 'id', value: 'abc' } }, '', node(), null), { parameters: { id: ['digits only'] } });
	assert.deepEqual(getParameterIssues(property, { id: { mode: 'id', value: '=expr' } }, '', node(), null), {});
});

test('fixedCollection enforces field counts and recursively checks required children', () => {
	const property = { name: 'fields', displayName: 'Fields', type: 'fixedCollection', typeOptions: { multipleValues: true, minRequiredFields: 2, maxAllowedFields: 3 }, options: [{ name: 'values', displayName: 'Values', values: [{ name: 'name', displayName: 'Name', type: 'string', required: true }] }] };
	assert.deepEqual(getParameterIssues(property, { fields: { values: [{ name: '' }] } }, '', node(), null), {
		parameters: { fields: ['At least 2 fields are required.'], name: ['Parameter "Name" is required.'] },
	});
});

test('resourceMapper validates required schema fields and declared types', () => {
	const property = { name: 'map', displayName: 'Map', type: 'resourceMapper', typeOptions: { resourceMapper: { mode: 'add', fieldWords: { singular: 'column' } } } };
	const value = { mappingMode: 'defineBelow', schema: [{ id: 'name', required: true, type: 'string' }, { id: 'age', type: 'number' }], value: { age: 'not-number' } };
	// REF-verified detail (differential N22): the mapper branch materialises an empty
	// `parameters[<name>]` array next to the per-field keys.
	assert.deepEqual(getParameterIssues(property, { map: value }, '', node(), null), {
		parameters: {
			map: [],
			'map.name': ['Column "name" is required'],
			'map.age': ["'age' expects a number but we got 'not-number'"],
		},
	});
});

test('validateType reports invalid values but accepts unresolved expressions', () => {
	const property = { name: 'count', displayName: 'Count', type: 'string', validateType: 'number' };
	assert.deepEqual(getParameterIssues(property, { count: 'nope' }, '', node(), null), { parameters: { count: ["'count' expects a number but we got 'nope'"] } });
	assert.deepEqual(getParameterIssues(property, { count: '=items.length' }, '', node(), null), {});
	assert.deepEqual(validateFieldType('choice', 'x', 'options', { valueOptions: [{ value: 'a' }] }), { valid: false, errorMessage: "'choice' expects one of the following values: [a] but we got 'x'" });
});

test('getNodeParametersIssues ignores disabled and pinned nodes and returns null when clean', () => {
	const properties = [{ name: 'x', displayName: 'X', type: 'string', required: true }];
	assert.equal(getNodeParametersIssues(properties, node({ x: '' }, { disabled: true }), null), null);
	assert.equal(getNodeParametersIssues(properties, node({ x: '' }), null, ['Test']), null);
	assert.equal(getNodeParametersIssues(properties, node({ x: 'ok' }), null), null);
	assert.deepEqual(getNodeParametersIssues(properties, node({ x: '' }), null), { parameters: { x: ['Parameter "X" is required.'] } });
});

test('mergeIssues combines execution, parameter, credential and unknown-type flags', () => {
	const destination = { parameters: { a: ['first'] } };
	mergeIssues(destination, { execution: true, parameters: { a: ['second'], b: ['third'] }, credentials: { c: ['missing'] }, typeUnknown: true });
	assert.deepEqual(destination, { execution: true, parameters: { a: ['first', 'second'], b: ['third'] }, credentials: { c: ['missing'] }, typeUnknown: true });
});
