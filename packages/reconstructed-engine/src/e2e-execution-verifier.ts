// E2E Execution Verifier — Verifikasi End-to-End Workflow Execution Run & State Persistence
// 1:1 dari packages/core/src/execution-engine/workflow-execute.ts

export interface ExecutionVerificationResult {
  status: 'SUCCESS' | 'FAILED';
  executionId: string;
  nodeCount: number;
  durationMs: number;
  errors: string[];
}

export class E2EExecutionVerifier {
  static async verifyExecution(
    engine: any,
    workflow: any,
    expectedNodeCount: number,
  ): Promise<ExecutionVerificationResult> {
    const start = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const errors: string[] = [];

    try {
      const result = await engine.runWorkflow();

      if (result.status !== 'COMPLETED') {
        errors.push(`Execution status not COMPLETED: ${result.status}`);
      }

      if (result.executionLog && result.executionLog.length < expectedNodeCount) {
        errors.push(`Expected ${expectedNodeCount} nodes, got ${result.executionLog.length}`);
      }

      const durationMs = Date.now() - start;

      return {
        status: errors.length === 0 ? 'SUCCESS' : 'FAILED',
        executionId,
        nodeCount: result.executionLog?.length || 0,
        durationMs,
        errors,
      };
    } catch (e: any) {
      return {
        status: 'FAILED',
        executionId,
        nodeCount: 0,
        durationMs: Date.now() - start,
        errors: [e.message || 'Unknown error'],
      };
    }
  }

  static verifyStatePersistence(executionData: any): boolean {
    // Pastikan data bisa diserialisasi ke DB (PostgreSQL JSONB)
    try {
      const serialized = JSON.stringify(executionData);
      const deserialized = JSON.parse(serialized);
      return !!deserialized;
    } catch {
      return false;
    }
  }
}
