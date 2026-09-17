// AUTO-GENERATED from connection-routing-engine.ts — do not edit by hand.
// regenerate: node tools/connection-isolation-extract.mjs --emit-esm
// verify:     node tools/connection-isolation-gate.mjs   (C06 twin parity)
// Connection Routing Engine — 1:1 dari n8n 2.9.4 packages/workflow/src/common/* + graph/* + connections-diff
// Owner: Agent 3 — LEGO connection
// Zero Rust, pure JS/TS, frontend UI untouched
export const NodeConnectionTypes = {
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
/**
 * mapConnectionsByDestination — inversion source->dest, padded with []
 * 1:1 dari reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts (49 lines)
 */
export function mapConnectionsByDestination(connections) {
    const byDest = {};
    for (const [sourceName, typeMap] of Object.entries(connections)) {
        for (const [type, outputSlots] of Object.entries(typeMap)) {
            for (let outputIndex = 0; outputIndex < outputSlots.length; outputIndex++) {
                const slot = outputSlots[outputIndex];
                if (!slot)
                    continue;
                for (const conn of slot) {
                    if (!conn)
                        continue;
                    const destName = conn.node;
                    const destType = conn.type;
                    const destIndex = conn.index;
                    if (!byDest[destName])
                        byDest[destName] = {};
                    if (!byDest[destName][destType])
                        byDest[destName][destType] = [];
                    while (byDest[destName][destType].length <= destIndex) {
                        byDest[destName][destType].push([]);
                    }
                    if (!byDest[destName][destType][destIndex]) {
                        byDest[destName][destType][destIndex] = [];
                    }
                    byDest[destName][destType][destIndex].push({
                        node: sourceName,
                        type: type,
                        index: outputIndex,
                    });
                }
            }
        }
    }
    // Pad missing indexes
    for (const destMap of Object.values(byDest)) {
        for (const slots of Object.values(destMap)) {
            for (let i = 0; i < slots.length; i++) {
                if (!slots[i])
                    slots[i] = [];
            }
        }
    }
    return byDest;
}
/**
 * getConnectedNodes — traversal primitive, farthest-first, deduped, cycle-safe
 * 1:1 dari reference/n8n/packages/workflow/src/common/get-connected-nodes.ts (98 lines)
 */
export function getConnectedNodes(connections, nodeName, connectionType = NodeConnectionTypes.Main, depth = -1, checkedNodesIncoming) {
    const newDepth = depth === -1 ? depth : depth - 1;
    if (depth === 0)
        return [];
    if (!Object.prototype.hasOwnProperty.call(connections, nodeName))
        return [];
    let types;
    if (connectionType === 'ALL') {
        types = Object.keys(connections[nodeName]);
    }
    else if (connectionType === 'ALL_NON_MAIN') {
        types = Object.keys(connections[nodeName]).filter((t) => t !== 'main');
    }
    else {
        types = [connectionType];
    }
    const returnNodes = [];
    types.forEach((type) => {
        if (!Object.prototype.hasOwnProperty.call(connections[nodeName], type))
            return;
        const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];
        if (checkedNodes.includes(nodeName))
            return;
        checkedNodes.push(nodeName);
        connections[nodeName][type].forEach((connectionsByIndex) => {
            connectionsByIndex?.forEach((connection) => {
                if (checkedNodes.includes(connection.node))
                    return;
                returnNodes.unshift(connection.node);
                const addNodes = getConnectedNodes(connections, connection.node, connectionType, newDepth, checkedNodes);
                for (let i = addNodes.length - 1; i >= 0; i--) {
                    const parentNodeName = addNodes[i];
                    const nodeIndex = returnNodes.indexOf(parentNodeName);
                    if (nodeIndex !== -1)
                        returnNodes.splice(nodeIndex, 1);
                    returnNodes.unshift(parentNodeName);
                }
            });
        });
    });
    return returnNodes;
}
export function getChildNodes(connections, nodeName, type = NodeConnectionTypes.Main, depth = -1) {
    return getConnectedNodes(connections, nodeName, type, depth);
}
export function getParentNodes(connectionsByDestination, nodeName, type = NodeConnectionTypes.Main, depth = -1) {
    return getConnectedNodes(connectionsByDestination, nodeName, type, depth);
}
export function getNodeByName(nodes, name) {
    return nodes.find((n) => n.name === name);
}
/**
 * buildAdjacencyList — 1:1 dari graph/graph-utils.ts
 */
/* ------------------------------------------------------------------ *
 * Graph analysis — reference-exact port of `packages/workflow/src/graph/graph-utils.ts`
 * (n8n 2.9.4). The differential gate (`tools/connection-lego-gate.mjs`) executes every
 * function below against the pinned `n8n-workflow@2.9.1` artifact; the port deliberately
 * keeps the reference's helpers, iteration order and error payloads so the comparison is
 * byte-for-byte.
 * ------------------------------------------------------------------ */
function union(a, b) {
    const result = new Set();
    for (const x of a)
        result.add(x);
    for (const x of b)
        result.add(x);
    return result;
}
function intersection(a, b) {
    const result = new Set();
    for (const x of a)
        if (b.has(x))
            result.add(x);
    return result;
}
function difference(minuend, subtrahend) {
    const result = new Set(minuend.values());
    for (const x of subtrahend)
        result.delete(x);
    return result;
}
export function buildAdjacencyList(connections) {
    const result = new Map();
    const addOrCreate = (k, v) => result.set(k, union(result.get(k) ?? new Set(), new Set([v])));
    for (const sourceNode of Object.keys(connections)) {
        for (const type of Object.keys(connections[sourceNode])) {
            for (const sourceIndex of Object.keys(connections[sourceNode][type])) {
                for (const connectionIndex of Object.keys(connections[sourceNode][type][parseInt(sourceIndex, 10)] ?? [])) {
                    const connection = connections[sourceNode][type][parseInt(sourceIndex, 10)]?.[parseInt(connectionIndex, 10)];
                    if (connection)
                        addOrCreate(sourceNode, connection);
                }
            }
        }
    }
    return result;
}
/** Find all edges leading into the graph described in `graphIds`. */
export function getInputEdges(nodes, adjacency) {
    const result = [];
    for (const [from, tos] of adjacency.entries()) {
        if (nodes.has(from))
            continue;
        for (const to of tos)
            if (nodes.has(to.node))
                result.push([from, to]);
    }
    return result;
}
/** Find all edges leading out of the graph described in `graphIds`. */
export function getOutputEdges(nodes, adjacency) {
    const result = [];
    for (const [from, tos] of adjacency.entries()) {
        if (!nodes.has(from))
            continue;
        for (const to of tos)
            if (!nodes.has(to.node))
                result.push([from, to]);
    }
    return result;
}
export function getRootNodes(nodes, adjacency) {
    // Inner nodes are all nodes with an incoming edge from another node in the graph
    let innerNodes = new Set();
    for (const nodeId of nodes) {
        innerNodes = union(innerNodes, new Set([...(adjacency.get(nodeId) ?? [])]
            .filter((x) => x.type === 'main' && x.node !== nodeId)
            .map((x) => x.node)));
    }
    return difference(nodes, innerNodes);
}
export function getLeafNodes(nodes, adjacency) {
    const result = new Set();
    for (const nodeId of nodes) {
        if (intersection(new Set([...(adjacency.get(nodeId) ?? [])]
            .filter((x) => x.type === 'main' && x.node !== nodeId)
            .map((x) => x.node)), nodes).size === 0) {
            result.add(nodeId);
        }
    }
    return result;
}
export function hasPath(start, end, adjacency) {
    const seen = new Set();
    const paths = [start];
    while (true) {
        const next = paths.pop();
        if (next === end)
            return true;
        if (next === undefined)
            return false;
        seen.add(next);
        paths.push(...difference(new Set([...(adjacency.get(next) ?? [])].filter((x) => x.type === 'main').map((x) => x.node)), seen));
    }
}
export function parseExtractableSubgraphSelection(nodes, adjacency) {
    const errors = [];
    // 0-1 Input nodes
    const inputEdges = getInputEdges(nodes, adjacency);
    const inputNodes = new Set(inputEdges.filter((x) => x[1].type === 'main').map((x) => x[1].node));
    let rootNodes = getRootNodes(nodes, adjacency);
    if (rootNodes.size === 0 && inputNodes.size === 1)
        rootNodes = inputNodes;
    for (const inputNode of difference(inputNodes, rootNodes).values()) {
        errors.push({ errorCode: 'Input Edge To Non-Root Node', node: inputNode });
    }
    const rootInputNodes = intersection(rootNodes, inputNodes);
    if (rootInputNodes.size > 1) {
        errors.push({ errorCode: 'Multiple Input Nodes', nodes: rootInputNodes });
    }
    // 0-1 Output nodes
    const outputEdges = getOutputEdges(nodes, adjacency);
    const outputNodes = new Set(outputEdges.filter((x) => x[1].type === 'main').map((x) => x[0]));
    let leafNodes = getLeafNodes(nodes, adjacency);
    if (leafNodes.size === 0 && outputNodes.size === 1)
        leafNodes = outputNodes;
    for (const outputNode of difference(outputNodes, leafNodes).values()) {
        errors.push({ errorCode: 'Output Edge From Non-Leaf Node', node: outputNode });
    }
    const leafOutputNodes = intersection(leafNodes, outputNodes);
    if (leafOutputNodes.size > 1) {
        errors.push({ errorCode: 'Multiple Output Nodes', nodes: leafOutputNodes });
    }
    const start = rootInputNodes.values().next().value;
    const end = leafOutputNodes.values().next().value;
    if (start && end && !hasPath(start, end, adjacency)) {
        errors.push({ errorCode: 'No Continuous Path From Root To Leaf In Selection', start, end });
    }
    return errors.length > 0 ? errors : { start, end };
}
/**
 * compareConnections — 1:1 dari connections-diff.ts
 */
export function compareConnections(prev, next) {
    const added = {};
    const removed = {};
    const allNodeNames = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const nodeName of allNodeNames) {
        const prevNodeConnections = prev[nodeName] ?? {};
        const nextNodeConnections = next[nodeName] ?? {};
        const allInputNames = new Set([...Object.keys(prevNodeConnections), ...Object.keys(nextNodeConnections)]);
        for (const inputName of allInputNames) {
            const prevInputConnections = prevNodeConnections[inputName] ?? [];
            const nextInputConnections = nextNodeConnections[inputName] ?? [];
            const maxLength = Math.max(prevInputConnections.length, nextInputConnections.length);
            for (let sourceIndex = 0; sourceIndex < maxLength; sourceIndex++) {
                const prevConnections = prevInputConnections[sourceIndex] ?? [];
                const nextConnections = nextInputConnections[sourceIndex] ?? [];
                const prevMap = new Map(prevConnections.map((conn, idx) => [JSON.stringify(conn), { index: idx, connection: conn }]));
                const nextMap = new Map(nextConnections.map((conn, idx) => [JSON.stringify(conn), { index: idx, connection: conn }]));
                for (const [key, value] of nextMap) {
                    if (!prevMap.has(key)) {
                        if (!added[nodeName])
                            added[nodeName] = {};
                        if (!added[nodeName][inputName])
                            added[nodeName][inputName] = [];
                        added[nodeName][inputName].push({ sourceIndex, value });
                    }
                }
                for (const [key, value] of prevMap) {
                    if (!nextMap.has(key)) {
                        if (!removed[nodeName])
                            removed[nodeName] = {};
                        if (!removed[nodeName][inputName])
                            removed[nodeName][inputName] = [];
                        removed[nodeName][inputName].push({ sourceIndex, value });
                    }
                }
            }
        }
    }
    return { added, removed };
}
/**
 * Workflow wrapper methods — consumed, not owned (CD-04, Agent 1)
 * These are provided here for completeness and testing, but ownership stays with Workflow LEGO.
 * Pinned by tests/reference/connection fixtures 01-04.
 */
export function getNodeConnectionIndexes(connectionsByDestination, nodeName, parentNodeName, type = 'main', getNode) {
    if (getNode && getNode(parentNodeName) === null)
        return undefined;
    const visited = new Set();
    const queue = [nodeName];
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current))
            continue;
        visited.add(current);
        const typeConnections = connectionsByDestination[current]?.[type];
        if (!typeConnections)
            continue;
        for (let typedConnectionIdx = 0; typedConnectionIdx < typeConnections.length; typedConnectionIdx++) {
            const slot = typeConnections[typedConnectionIdx];
            if (!slot)
                continue;
            for (let destinationIndex = 0; destinationIndex < slot.length; destinationIndex++) {
                const connection = slot[destinationIndex];
                if (!connection)
                    continue;
                if (connection.node === parentNodeName) {
                    return { sourceIndex: connection.index, destinationIndex };
                }
                if (!visited.has(connection.node))
                    queue.push(connection.node);
            }
        }
    }
    return undefined;
}
export function getHighestNode(connectionsByDestination, nodes, nodeName, nodeConnectionIndex, checkedNodes) {
    let currentHighest = [];
    if (nodes[nodeName] && nodes[nodeName].disabled === false) {
        currentHighest.push(nodeName);
    }
    if (!connectionsByDestination[nodeName] || !connectionsByDestination[nodeName].main) {
        return currentHighest;
    }
    const checked = checkedNodes || [];
    if (checked.includes(nodeName))
        return currentHighest;
    checked.push(nodeName);
    const returnNodes = [];
    const mainConnections = connectionsByDestination[nodeName].main;
    for (let connectionIndex = 0; connectionIndex < mainConnections.length; connectionIndex++) {
        if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex)
            continue;
        const slot = mainConnections[connectionIndex];
        if (!slot)
            continue;
        for (const connection of slot) {
            if (!connection)
                continue;
            if (checked.includes(connection.node))
                continue;
            if (!nodes[connection.node])
                continue;
            let addNodes = getHighestNode(connectionsByDestination, nodes, connection.node, undefined, checked);
            if (addNodes.length === 0 && nodes[connection.node].disabled !== true) {
                addNodes = [connection.node];
            }
            for (const name of addNodes) {
                if (!returnNodes.includes(name))
                    returnNodes.push(name);
            }
        }
    }
    return returnNodes;
}
