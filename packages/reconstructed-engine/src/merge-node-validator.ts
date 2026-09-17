// Merge Node Validator — Verifikasi Validasi Alur Kerja Multi-cabang & Merge Node
// 1:1 dari n8n-workflow src/workflow-validation.ts & graph-utils

export interface MergeValidationResult {
  valid: boolean;
  issues: string[];
  branchCount: number;
}

export class MergeNodeValidator {
  static validateMultiBranchMerge(
    nodeName: string,
    connections: Record<string, any>,
    allNodes: string[],
  ): MergeValidationResult {
    const issues: string[] = [];
    const byDest = this.invertConnections(connections);
    const parents = byDest[nodeName]?.main || [];
    let branchCount = 0;

    for (const slot of parents) {
      if (slot && slot.length > 0) branchCount += slot.length;
    }

    if (branchCount < 2) {
      issues.push(`Merge node ${nodeName} expects >=2 inputs, got ${branchCount}`);
    }

    // Validasi path kontinu dari root ke merge
    const hasPath = this.hasContinuousPath(connections, allNodes, nodeName);

    if (!hasPath && branchCount > 0) {
      issues.push(`No continuous path to merge node ${nodeName}`);
    }

    return {
      valid: issues.length === 0,
      issues,
      branchCount,
    };
  }

  private static invertConnections(connections: Record<string, any>): Record<string, any> {
    const byDest: Record<string, any> = {};
    for (const [src, typeMap] of Object.entries(connections)) {
      for (const [type, slots] of Object.entries(typeMap as any)) {
        (slots as any[]).forEach((slot, outIdx) => {
          if (!slot) return;
          for (const conn of slot) {
            if (!conn) continue;
            if (!byDest[conn.node]) byDest[conn.node] = {};
            if (!byDest[conn.node][conn.type]) byDest[conn.node][conn.type] = [];
            while (byDest[conn.node][conn.type].length <= conn.index) {
              byDest[conn.node][conn.type].push([]);
            }
            byDest[conn.node][conn.type][conn.index].push({ node: src, type, index: outIdx });
          }
        });
      }
    }
    return byDest;
  }

  private static hasContinuousPath(connections: Record<string, any>, allNodes: string[], target: string): boolean {
    // BFS sederhana dari root nodes
    const byDest = this.invertConnections(connections);
    const roots = allNodes.filter((n) => !byDest[n] || !byDest[n].main || byDest[n].main.every((s: any) => !s || s.length === 0));
    const visited = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === target) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const out = connections[cur]?.main || [];
      for (const slot of out) {
        if (!slot) continue;
        for (const conn of slot) {
          if (conn && !visited.has(conn.node)) queue.push(conn.node);
        }
      }
    }
    return false;
  }
}
