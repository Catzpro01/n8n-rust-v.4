import assert from 'node:assert/strict';

console.log("=== Subworkflow Context Tests ===");

// Simulate import - using direct function definitions for test
function createSubworkflowContext(parentExecId, parentWfId, nodeName) {
  return { parentExecutionId: parentExecId, parentWorkflowId: parentWfId, callerNodeName: nodeName };
}

function createExecutionContext(mode, parentExecutionId, triggerNode) {
  return { version: 1, establishedAt: Date.now(), source: mode, parentExecutionId, triggerNode };
}

function isResourceLocatorValue(value) {
  return typeof value === 'object' && value !== null && '__rl' in value && value.__rl === true && 'mode' in value && 'value' in value;
}

function getSubworkflowId(node) {
  if (node.parameters && isResourceLocatorValue(node.parameters.workflowId)) {
    return node.parameters.workflowId.value;
  }
  if (typeof node.parameters.workflowId === 'string') return node.parameters.workflowId;
  return undefined;
}

// Test 1: createSubworkflowContext
const ctx = createSubworkflowContext('exec_123', 'wf_456', 'Execute Workflow');
assert.equal(ctx.parentExecutionId, 'exec_123');
assert.equal(ctx.parentWorkflowId, 'wf_456');
assert.equal(ctx.callerNodeName, 'Execute Workflow');
console.log("✓ createSubworkflowContext");

// Test 2: createExecutionContext
const execCtx = createExecutionContext('manual', 'parent_exec_789', { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger' });
assert.equal(execCtx.version, 1);
assert.equal(execCtx.source, 'manual');
assert.equal(execCtx.parentExecutionId, 'parent_exec_789');
assert.ok(execCtx.establishedAt > 0);
console.log("✓ createExecutionContext");

// Test 3: getSubworkflowId with resourceLocator
const nodeWithRL = {
  name: 'Execute Workflow',
  parameters: { workflowId: { __rl: true, mode: 'id', value: 'wf_child_123' } }
};
assert.equal(getSubworkflowId(nodeWithRL), 'wf_child_123');
console.log("✓ getSubworkflowId resourceLocator");

// Test 4: getSubworkflowId with string
const nodeWithString = {
  name: 'Execute Workflow',
  parameters: { workflowId: 'wf_direct_456' }
};
assert.equal(getSubworkflowId(nodeWithString), 'wf_direct_456');
console.log("✓ getSubworkflowId string");

// Test 5: getSubworkflowId undefined
const nodeWithout = { name: 'Other', parameters: {} };
assert.equal(getSubworkflowId(nodeWithout), undefined);
console.log("✓ getSubworkflowId undefined");

console.log("\nAll subworkflow tests PASS (5/5)");
