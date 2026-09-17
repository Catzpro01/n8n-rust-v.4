// Merge Node & Branching Validator
export function validateMergeNodeInputs(connectedInputs: number, mode: string): boolean {
  if (mode === 'combine' && connectedInputs < 2) {
    return false;
  }
  return true;
}
