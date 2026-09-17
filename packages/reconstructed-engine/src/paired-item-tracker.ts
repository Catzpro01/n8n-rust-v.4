// PairedItem Flow Tracker for Multi-Item Nodes
export interface PairedItemReference {
  item: number;
  input?: number;
}

export function tracePairedItem(sourceIndex: number, targetIndex: number): PairedItemReference {
  return { item: sourceIndex, input: 0 };
}
