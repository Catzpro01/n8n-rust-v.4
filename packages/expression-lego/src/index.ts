/**
 * @lego/expression — Expression LEGO (Phase 2 structural isolation)
 *
 * OWNERSHIP:
 *   owns         : expression.ts, workflow-data-proxy.ts, expression-sandboxing.ts,
 *                  expression-evaluator-proxy.ts, augment-object.ts,
 *                  workflow-data-proxy-helpers.ts, workflow-data-proxy-env-provider.ts,
 *                  expressions/**, extensions/**
 *   does NOT own : workflow.ts (graph API), node-helpers, execution-data factories
 *
 * This LEGO implements:
 * - Expression class with getParameterValue, resolveSimpleParameterValue, etc.
 * - WorkflowDataProxy with full $json, $binary, $input, $('X'), $node, $workflow semantics
 * - Sandbox with AST hooks rejecting __proto__, prototype, with, class extension
 * - Extension syntax and libraries (string, number, array, object, date extensions)
 * - augmentObject / augmentArray copy-on-write views
 *
 * Reference: n8n 2.9.4, n8n-workflow@2.9.1
 */

export { Expression, isExpression } from './expression';
export { WorkflowDataProxy } from './workflow-data-proxy';
export * from './expression-sandboxing';
export * from './expression-evaluator-proxy';
export * from './augment-object';
export * from './workflow-data-proxy-helpers';

// Extensions
export * from './extensions';

// Expressions
export * from './expressions';

export const LEGO_PROVENANCE = {
  lego: 'expression',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
