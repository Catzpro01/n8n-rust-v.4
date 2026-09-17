/**
 * POOL-004 · Suite 05 — @n8n/db utils/build-workflows-by-nodes-query.ts
 * Byte-exact SQL + parameter objects. Expected strings below were lifted verbatim
 * from the reference source (tab indentation preserved via \t escapes);
 * sha256 pins live in manifest/source-pins.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildWorkflowsByNodesQuery } from '../src/utils/build-workflows-by-nodes-query.mjs';

const EXPECTED_POSTGRESDB = `EXISTS (
\t\t\t\t\tSELECT 1
\t\t\t\t\tFROM jsonb_array_elements(workflow.nodes::jsonb) AS node
\t\t\t\t\tWHERE node->>'type' = ANY(:nodeTypes)
\t\t\t\t)`;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

test('postgresdb: byte-exact whereClause + nodeTypes-only parameters', () => {
	const { whereClause, parameters } = buildWorkflowsByNodesQuery(['a', 'b'], 'postgresdb');
	assert.equal(whereClause, EXPECTED_POSTGRESDB);
	assert.equal(sha256(whereClause), '54776ba945cfc1996faeb383f1da201a17b4d346c02972638774cc3a32487181');
	assert.deepEqual(parameters, { nodeTypes: ['a', 'b'] });
});

test('sqlite: per-type EXISTS OR-chain, parameters numbered in input order', () => {
	const types = ['n8n-nodes-base.start', 'n8n-nodes-base.set'];
	const { whereClause, parameters } = buildWorkflowsByNodesQuery(types, 'sqlite');
	assert.equal(
		whereClause,
		"(EXISTS (SELECT 1 FROM json_each(workflow.nodes) WHERE json_extract(json_each.value, '$.type') = :nodeType0) OR EXISTS (SELECT 1 FROM json_each(workflow.nodes) WHERE json_extract(json_each.value, '$.type') = :nodeType1))",
	);
	assert.equal(sha256(whereClause), '8c045d700933c25ebd36531c1d08a761e07b721f28982b4901794c9bffa622bf');
	assert.deepEqual(parameters, {
		nodeTypes: types,
		nodeType0: 'n8n-nodes-base.start',
		nodeType1: 'n8n-nodes-base.set',
	});
});

test('sqlite edge: empty node list yields () with no extra parameters', () => {
	const { whereClause, parameters } = buildWorkflowsByNodesQuery([], 'sqlite');
	assert.equal(whereClause, '()');
	assert.deepEqual(parameters, { nodeTypes: [] });
});

test('sqlite edge: single type has no OR', () => {
	const { whereClause } = buildWorkflowsByNodesQuery(['only.one'], 'sqlite');
	assert.equal(
		whereClause,
		"(EXISTS (SELECT 1 FROM json_each(workflow.nodes) WHERE json_extract(json_each.value, '$.type') = :nodeType0))",
	);
});

test('unsupported dialect throws the reference error message', () => {
	assert.throws(() => buildWorkflowsByNodesQuery(['a'], 'mysql'), /^Error: Unsupported database type$/);
});

test('source and port carry the same SQL literal bytes (sha256 cross-check vs source file region)', () => {
	// The postgresdb literal in the reference source spans 4 tab-indented lines inside the template.
	const src = readFileSync(
		new URL('../../../reference/n8n/packages/@n8n/db/src/utils/build-workflows-by-nodes-query.ts', import.meta.url),
		'utf8',
	);
	const literal = src.match(/`EXISTS \([\s\S]*?\)`/)[0].slice(1, -1); // unwrap the backticks
	assert.equal(literal, EXPECTED_POSTGRESDB);
});
