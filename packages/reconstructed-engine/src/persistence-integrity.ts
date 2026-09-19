// State & Persistence Data Integrity Checker
export interface ExecutionSnapshot {
  executionId: string;
  workflowId: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt?: string;
  dataHash: string;
}

export function verifySnapshotIntegrity(snapshot: ExecutionSnapshot): boolean {
  return Boolean(snapshot.executionId && snapshot.workflowId && snapshot.status && snapshot.dataHash);
}
