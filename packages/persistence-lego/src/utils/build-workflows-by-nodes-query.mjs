/**
 * 1:1 port of n8n db package: utils/build-workflows-by-nodes-query.ts
 * (full file). The SQL template literals below are byte-identical to the reference,
 * including the tab indentation inside the postgresdb clause — byte parity is
 * machine-pinned in test/05-queries.test.mjs (sha256 of both whereClause strings).
 */

/**
 * Builds the WHERE clause and parameters for a query to find workflows by node types
 */
export function buildWorkflowsByNodesQuery(nodeTypes, dbType) {
	let whereClause;

	const parameters = { nodeTypes };

	switch (dbType) {
		case 'postgresdb':
			whereClause = `EXISTS (
					SELECT 1
					FROM jsonb_array_elements(workflow.nodes::jsonb) AS node
					WHERE node->>'type' = ANY(:nodeTypes)
				)`;
			break;
		case 'sqlite': {
			const conditions = nodeTypes
				.map(
					(_, i) =>
						`EXISTS (SELECT 1 FROM json_each(workflow.nodes) WHERE json_extract(json_each.value, '$.type') = :nodeType${i})`,
				)
				.join(' OR ');

			whereClause = `(${conditions})`;

			nodeTypes.forEach((nodeType, index) => {
				parameters[`nodeType${index}`] = nodeType;
			});
			break;
		}
		default:
			throw new Error('Unsupported database type');
	}

	return { whereClause, parameters };
}
