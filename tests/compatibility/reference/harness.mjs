#!/usr/bin/env node
/**
 * Reference harness — n8n workflow graph functions (ORIGINAL behavior).
 *
 * PROVENANCE
 *  - `getConnectedNodes`, `getChildNodes`, `getParentNodes`,
 *    `mapConnectionsByDestination` are VERBATIM ports (type annotations
 *    stripped) of:
 *      reference/n8n/packages/workflow/src/common/get-connected-nodes.ts
 *      reference/n8n/packages/workflow/src/common/get-child-nodes.ts
 *      reference/n8n/packages/workflow/src/common/get-parent-nodes.ts
 *      reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts
 *    (n8n v2.9.4, commit b6dc2787c45677a29a9612cd27eb911302961a83)
 *  - `detectCycles` / `findCycle` / `getStartNodes` are SPEC-DEFINED pure
 *    functions (docs/isolation/workflow_spec.md §3 items 5-6). The original
 *    n8n does not detect cycles at load time; these implement the contract
 *    invariant with a fixed deterministic algorithm (same algorithm is
 *    implemented in the Rust crate).
 *
 * USAGE
 *  node harness.mjs <fixture.json>
 *
 * OUTPUT
 *  One line per fixture query:  <query>\t<canonical-json-result>
 *
 * CANONICAL FORM
 *  JSON with object keys sorted lexicographically at every level, compact
 *  separators, standard JSON escaping. The Rust side emits the identical
 *  canonical form so `diff` is a strict, order-sensitive comparison.
 *
 * FIXTURE CONVENTION (determinism)
 *  - Top-level connection node names and per-node connection type keys are
 *    listed in lexicographic (alphabetical) order in the fixture JSON. The
 *    original JS iterates those keys in object insertion order; the Rust
 *    port iterates BTreeMap keys (lexicographic). The convention makes both
 *    iteration orders identical, so outputs are directly comparable.
 *  - Input/output index keys are integer-like; JS always iterates them in
 *    ascending numeric order, matching the Rust Vec index order.
 *  - Node names and type strings must not contain ':' (query separator).
 */

import { readFileSync } from 'node:fs';

// From reference/n8n/packages/workflow/src/interfaces.ts (const object, not enum)
const NodeConnectionTypes = {
  AiAgent: 'ai_agent',
  AiChain: 'ai_chain',
  AiDocument: 'ai_document',
  AiEmbedding: 'ai_embedding',
  AiLanguageModel: 'ai_languageModel',
  AiMemory: 'ai_memory',
  AiOutputParser: 'ai_outputParser',
  AiRetriever: 'ai_retriever',
  AiReranker: 'ai_reranker',
  AiTextSplitter: 'ai_textSplitter',
  AiTool: 'ai_tool',
  AiVectorStore: 'ai_vectorStore',
  Main: 'main',
};

/* ────────────────────────────────────────────────────────────────────────────
 * VERBATIM from reference/n8n/packages/workflow/src/common/get-connected-nodes.ts
 * (only `import type` lines and TS type annotations removed)
 * ──────────────────────────────────────────────────────────────────────────── */
export function getConnectedNodes(
  connections,
  nodeName,
  connectionType = NodeConnectionTypes.Main,
  depth = -1,
  checkedNodesIncoming,
) {
  const newDepth = depth === -1 ? depth : depth - 1;
  if (depth === 0) {
    // Reached max depth
    return [];
  }

  if (!connections.hasOwnProperty(nodeName)) {
    // Node does not have incoming connections
    return [];
  }

  let types;
  if (connectionType === 'ALL') {
    types = Object.keys(connections[nodeName]);
  } else if (connectionType === 'ALL_NON_MAIN') {
    types = Object.keys(connections[nodeName]).filter(
      (type) => type !== 'main',
    );
  } else {
    types = [connectionType];
  }

  let addNodes;
  let nodeIndex;
  let i;
  let parentNodeName;
  const returnNodes = [];

  types.forEach((type) => {
    if (!connections[nodeName].hasOwnProperty(type)) {
      // Node does not have incoming connections of given type
      return;
    }

    const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];

    if (checkedNodes.includes(nodeName)) {
      // Node got checked already before
      return;
    }

    checkedNodes.push(nodeName);

    connections[nodeName][type].forEach((connectionsByIndex) => {
      connectionsByIndex?.forEach((connection) => {
        if (checkedNodes.includes(connection.node)) {
          // Node got checked already before
          return;
        }

        returnNodes.unshift(connection.node);

        addNodes = getConnectedNodes(
          connections,
          connection.node,
          connectionType,
          newDepth,
          checkedNodes,
        );

        for (i = addNodes.length; i--; i > 0) {
          // Because nodes can have multiple parents it is possible that
          // parts of the tree is parent of both and to not add nodes
          // twice check first if they already got added before.
          parentNodeName = addNodes[i];
          nodeIndex = returnNodes.indexOf(parentNodeName);

          if (nodeIndex !== -1) {
            // Node got found before so remove it from current location
            // that node-order stays correct
            returnNodes.splice(nodeIndex, 1);
          }

          returnNodes.unshift(parentNodeName);
        }
      });
    });
  });

  return returnNodes;
}

/* ────────────────────────────────────────────────────────────────────────────
 * VERBATIM from reference/n8n/packages/workflow/src/common/get-child-nodes.ts
 * ──────────────────────────────────────────────────────────────────────────── */
export function getChildNodes(
  connectionsBySourceNode,
  nodeName,
  type = NodeConnectionTypes.Main,
  depth = -1,
) {
  return getConnectedNodes(connectionsBySourceNode, nodeName, type, depth);
}

/* ────────────────────────────────────────────────────────────────────────────
 * VERBATIM from reference/n8n/packages/workflow/src/common/get-parent-nodes.ts
 * ──────────────────────────────────────────────────────────────────────────── */
export function getParentNodes(
  connectionsByDestinationNode,
  nodeName,
  type = NodeConnectionTypes.Main,
  depth = -1,
) {
  return getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth);
}

/* ────────────────────────────────────────────────────────────────────────────
 * VERBATIM from
 * reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts
 * ──────────────────────────────────────────────────────────────────────────── */
export function mapConnectionsByDestination(connections) {
  const returnConnection = {};

  let connectionInfo;
  let maxIndex;
  for (const sourceNode in connections) {
    if (!connections.hasOwnProperty(sourceNode)) {
      continue;
    }

    for (const type of Object.keys(connections[sourceNode])) {
      if (!connections[sourceNode].hasOwnProperty(type)) {
        continue;
      }

      for (const inputIndex in connections[sourceNode][type]) {
        if (!connections[sourceNode][type].hasOwnProperty(inputIndex)) {
          continue;
        }

        for (connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
          if (!returnConnection.hasOwnProperty(connectionInfo.node)) {
            returnConnection[connectionInfo.node] = {};
          }
          if (!returnConnection[connectionInfo.node].hasOwnProperty(connectionInfo.type)) {
            returnConnection[connectionInfo.node][connectionInfo.type] = [];
          }

          maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
          for (let j = maxIndex; j < connectionInfo.index; j++) {
            returnConnection[connectionInfo.node][connectionInfo.type].push([]);
          }

          returnConnection[connectionInfo.node][connectionInfo.type][connectionInfo.index]?.push({
            node: sourceNode,
            type,
            index: parseInt(inputIndex, 10),
          });
        }
      }
    }
  }

  return returnConnection;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SPEC-DEFINED pure functions (workflow_spec.md §3).
 * Fixed deterministic algorithm — the Rust crate implements the exact same
 * steps so differential comparison is meaningful.
 * ──────────────────────────────────────────────────────────────────────────── */

function edgesOf(connections, scope) {
  // scope: 'main' | 'all'
  const nodes = new Set(Object.keys(connections));
  const adj = new Map(); // node -> sorted list of destination node names
  for (const source of Object.keys(connections)) {
    const byType = connections[source];
    for (const type of Object.keys(byType)) {
      if (scope === 'main' && type !== 'main') continue;
      const slots = byType[type];
      if (!Array.isArray(slots)) continue;
      slots.forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((conn) => {
          if (conn && typeof conn.node === 'string') {
            nodes.add(conn.node);
            if (!adj.has(source)) adj.set(source, []);
            adj.get(source).push(conn.node);
          }
        });
      });
    }
  }
  for (const [k, v] of adj) v.sort();
  return { nodeNames: [...nodes].sort(), adj };
}

export function findCycle(connections, scope) {
  const { nodeNames, adj } = edgesOf(connections, scope);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const n of nodeNames) color.set(n, WHITE);
  const stack = [];
  let found = null;

  const visit = (v) => {
    color.set(v, GRAY);
    stack.push(v);
    const neigh = (adj.get(v) ?? []);
    for (const u of neigh) {
      const c = color.get(u);
      if (found) return true;
      if (c === GRAY) {
        const i = stack.indexOf(u);
        found = stack.slice(i);
        return true;
      }
      if (c === WHITE) {
        if (visit(u)) return true;
      }
    }
    stack.pop();
    color.set(v, BLACK);
    return false;
  };

  for (const n of nodeNames) {
    if (color.get(n) === WHITE) {
      if (visit(n)) return found;
    }
  }
  return null;
}

export function detectCycles(connections, scope) {
  return findCycle(connections, scope) !== null;
}

export function getStartNodes(nodeNames, byDestination) {
  // Pure definition: a node is a start node iff it has NO incoming MAIN
  // connection. (Trigger/poll classification is LEGO 'node' territory.)
  const out = [];
  for (const name of [...nodeNames].sort()) {
    const byType = byDestination[name];
    if (!byType) {
      out.push(name);
      continue;
    }
    const slots = byType['main'];
    const hasIncoming =
      Array.isArray(slots) &&
      slots.some((s) => Array.isArray(s) && s.length > 0);
    if (!hasIncoming) out.push(name);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Canonical JSON
 * ──────────────────────────────────────────────────────────────────────────── */
export function canonicalize(value) {
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
      return o;
    }
    return v;
  }
  return JSON.stringify(sortKeys(value));
}

/**
 * Projection of an INode to the pure-model fields (both runtimes emit this
 * exact object): disabled, name, position, type, typeVersion.
 */
function projectNode(n) {
  return {
    disabled: n.disabled === true,
    name: n.name,
    position: n.position,
    type: n.type,
    typeVersion: n.typeVersion,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Query engine (mirrored 1:1 in the Rust crate, src/compat_engine.rs)
 * ──────────────────────────────────────────────────────────────────────────── */
function runQuery(q, ctx) {
  const parts = q.split(':');
  switch (parts[0]) {
    case 'mapByDestination':
      return canonicalize(mapConnectionsByDestination(ctx.bySource));

    case 'getChild':
      return canonicalize(
        getChildNodes(
          ctx.bySource,
          parts[1],
          parts[2] ?? 'main',
          parts[3] !== undefined ? parseInt(parts[3], 10) : -1,
        ),
      );

    case 'getParent':
      return canonicalize(
        getParentNodes(
          ctx.byDestination,
          parts[1],
          parts[2] ?? 'main',
          parts[3] !== undefined ? parseInt(parts[3], 10) : -1,
        ),
      );

    case 'getConnected':
      return canonicalize(
        getConnectedNodes(
          ctx.bySource,
          parts[1],
          parts[2] ?? 'main',
          parts[3] !== undefined ? parseInt(parts[3], 10) : -1,
        ),
      );

    case 'getNode': {
      const n = Object.prototype.hasOwnProperty.call(ctx.nodes, parts[1])
        ? ctx.nodes[parts[1]]
        : null;
      return n ? canonicalize(projectNode(n)) : 'null';
    }

    case 'getAllNodes':
      return canonicalize(ctx.nodeNames);

    case 'detectCycles':
      return canonicalize(detectCycles(ctx.bySource, parts[1] ?? 'main'));

    case 'findCycle':
      return canonicalize(findCycle(ctx.bySource, parts[1] ?? 'main'));

    case 'getStartNodes':
      return canonicalize(getStartNodes(ctx.nodeNames, ctx.byDestination));

    default:
      throw new Error(`unknown query: ${q}`);
  }
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node harness.mjs <fixture.json>');
    process.exit(2);
  }
  const fx = JSON.parse(readFileSync(file, 'utf8'));

  const nodes = {};
  for (const n of fx.nodes ?? []) nodes[n.name] = n;
  const bySource = fx.connections ?? {};
  const byDestination = mapConnectionsByDestination(bySource);

  const ctx = {
    nodes,
    bySource,
    byDestination,
    nodeNames: Object.keys(nodes).sort(),
  };

  const lines = (fx.queries ?? []).map((q) => `${q}\t${runQuery(q, ctx)}`);
  process.stdout.write(lines.join('\n') + '\n');
}

main();
