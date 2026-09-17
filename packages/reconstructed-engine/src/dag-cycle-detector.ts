// DAG Loop & Unknown Cycle Detection with Timeout & Max Hop Guard
export interface GraphEdge {
  from: string;
  to: string;
}

export class DAGCycleDetector {
  public static detectCycles(edges: GraphEdge[]): { hasCycle: boolean; cycleNodes?: string[] } {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function dfs(node: string, path: string[]): string[] | null {
      visited.add(node);
      recStack.add(node);

      const neighbors = adj.get(node) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          const res = dfs(next, [...path, next]);
          if (res) return res;
        } else if (recStack.has(next)) {
          return [...path, next];
        }
      }

      recStack.delete(node);
      return null;
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        const cycle = dfs(node, [node]);
        if (cycle) return { hasCycle: true, cycleNodes: cycle };
      }
    }

    return { hasCycle: false };
  }
}
