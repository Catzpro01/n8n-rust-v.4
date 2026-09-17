/**
 * 1:1 port of n8n db package: utils/get-final-test-result.ts
 *
 * Returns the final result of the test run based on the test case executions.
 * The final result is the most severe status among all test case executions' statuses.
 */
export function getTestRunFinalResult(testCaseExecutions) {
	// Priority of statuses: error > warning > success
	const severityMap = {
		error: 3,
		warning: 2,
		success: 1,
	};

	let finalResult = 'success';

	for (const testCaseExecution of testCaseExecutions) {
		if (['error', 'warning'].includes(testCaseExecution.status)) {
			if (
				testCaseExecution.status in severityMap &&
				severityMap[testCaseExecution.status] > severityMap[finalResult]
			) {
				finalResult = testCaseExecution.status;
			}
		}
	}

	return finalResult;
}
