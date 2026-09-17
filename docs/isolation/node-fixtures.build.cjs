#!/usr/bin/env node
/**
 * node-fixtures.build.cjs — generator + drift checker for docs/isolation/node-fixtures.json
 *
 * Derives the golden expectations of the six frozen node-model ports (contract §11)
 * by EXECUTING the pinned reference package (reference/n8n/packages/workflow/dist/cjs,
 * n8n@2.9.4 / n8n-workflow@2.9.1) — never by hand computation.
 *
 * Usage:
 *   node docs/isolation/node-fixtures.build.cjs           # regenerate fixtures (writes file)
 *   node docs/isolation/node-fixtures.build.cjs --check   # re-derive and diff; exit 1 on drift
 *
 * Exit codes:
 *   0 ok · 1 fixture-file drift (--check) · 2 reference build missing / export missing
 *   3 REFERENCE DRIFT vs docs/isolation/node-golden-cases.md — regression rule: STOP,
 *     investigate, document. Do NOT silently regenerate.
 *
 * Boundary note: this script is part of the docs/isolation/node* evidence set owned by
 * agent-2. It only reads the reference dist and writes docs/isolation/node-fixtures.json.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// ISSUE-011 discipline: the pinned reference tree must stay build-output-free. The dist
// is therefore resolved from (1) explicit env override, (2) an in-tree build (verification
// environments that build in place and clean before the integrity check), or
// (3) the agent-local relocated copy /tmp/n8n-workflow-dist (this sandbox).
const DIST = [
  process.env.NODE_FIXTURES_DIST,
  path.join(REPO_ROOT, "reference/n8n/packages/workflow/dist/cjs"),
  "/tmp/n8n-workflow-dist/cjs",
].find((candidate) => candidate && fs.existsSync(path.join(candidate, "node-helpers.js")));
const OUT = path.join(__dirname, "node-fixtures.json");

function ref(name) {
  const file = path.join(DIST, name);
  if (!fs.existsSync(file)) {
    console.error(`reference module not found: ${file}`);
    console.error("build the pinned workflow package first: pnpm --filter n8n-workflow build,");
    console.error("or set NODE_FIXTURES_DIST (see docs/isolation/node-golden-cases.md → Reproduction)");
    process.exit(2);
  }
  return require(file);
}

const helpers = ref("node-helpers.js");
const filterParameter = ref("node-parameters/filter-parameter.js");
const { renameFormFields } = ref("node-parameters/rename-node-utils.js");
const { applyAccessPatterns, hasDotNotationBannedChar } = ref("node-reference-parser-utils.js");
const { resolveRelativePath } = ref("node-parameters/path-utils.js");
const { assertParamIsString, assertParamIsNumber } = ref("node-parameters/parameter-type-validation.js");
const { VersionedNodeType } = ref("versioned-node-type.js");

for (const [label, fn] of Object.entries({
  getNodeParameters: helpers.getNodeParameters,
  getConnectionTypes: helpers.getConnectionTypes,
  getNodeOutputs: helpers.getNodeOutputs,
  getNodeInputs: helpers.getNodeInputs,
  getVersionedNodeType: helpers.getVersionedNodeType,
  displayParameter: helpers.displayParameter,
  mergeNodeProperties: helpers.mergeNodeProperties,
  makeNodeName: helpers.makeNodeName,
  makeDescription: helpers.makeDescription,
  isDefaultNodeName: helpers.isDefaultNodeName,
  isTriggerNode: helpers.isTriggerNode,
  getNodeParametersIssues: helpers.getNodeParametersIssues,
  executeFilterCondition: filterParameter.executeFilterCondition,
  executeFilter: filterParameter.executeFilter,
  validateFilterParameter: filterParameter.validateFilterParameter,
  FilterError: filterParameter.FilterError,
  renameFormFields,
  applyAccessPatterns,
  hasDotNotationBannedChar,
  resolveRelativePath,
  assertParamIsString,
  assertParamIsNumber,
  VersionedNodeType,
})) {
  if (typeof fn !== "function") {
    console.error(`reference export changed: ${label} is ${typeof fn}, expected function`);
    process.exit(2);
  }
}

const THROWING_WORKFLOW = Object.freeze({
  expression: { getSimpleParameterValue() { throw new Error("dynamic evaluator unavailable"); } },
});

function warnCaptured(fn) {
  const captured = [];
  const orig = console.warn;
  console.warn = (...args) => captured.push(args.map(String).join(" "));
  try {
    return { result: fn(), warns: captured };
  } finally {
    console.warn = orig;
  }
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canon(value[k])]),
    );
  }
  return value;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/* ---------------- GC-1 applyAccessPatterns (contract §11 P-NODE-REFERENCE) --------- */

const applyAccessPatternsCases = [
  { expression: "$('Old Node').item.json.a + \"x\"", previousName: "Old Node", newName: "New Node" },
  { expression: "const x = $node[\"Old Node\"].json.b", previousName: "Old Node", newName: "New Node" },
  { expression: "no reference here", previousName: "Old Node", newName: "New Node" },
].map((c) => ({ ...c, expect: applyAccessPatterns(c.expression, c.previousName, c.newName) }));

/* ---------------- GC-2 getConnectionTypes (contract §11) -------------------------- */

const getConnectionTypesCases = [
  {
    input: ["main", { type: "main", category: "error", displayName: "Error" }, { type: "ai_tool" }],
  },
].map((c) => ({ ...c, expect: helpers.getConnectionTypes(c.input) }));

/* ---------------- GC-3 renameFormFields (contract §11 P-NODE-RENAME) ---------------- */

const renamePattern = { pattern: "Old Node", replacement: "New Node" };
const renameBefore = {
  parameters: {
    formFields: {
      values: [
        { fieldType: "html", html: "Hello $('Old Node').item" },
        { fieldType: "text", label: "Name" },
        { fieldType: "html" },
      ],
    },
  },
};
const renameRun = (() => {
  const node = JSON.parse(JSON.stringify(renameBefore));
  const returned = renameFormFields(node, (s) => s.replaceAll(renamePattern.pattern, renamePattern.replacement));
  return { after: node, returned: returned === undefined ? null : returned };
})();
const renameFormFieldsCases = [{ before: renameBefore, rename: renamePattern, ...renameRun }];

/* ---------------- GC-4 getNodeOutputs (contract §11 P-NODE-MODEL) ------------------- */

function outputCase(name, node, outputs) {
  const description = { outputs: JSON.parse(JSON.stringify(outputs)) };
  const snapshot = JSON.stringify(description);
  const { result, warns } = warnCaptured(() => helpers.getNodeOutputs(THROWING_WORKFLOW, node, description));
  return {
    name,
    node,
    outputs,
    expect: result,
    descriptionUnchangedAfterCall: JSON.stringify(description) === snapshot,
    warned: warns.length > 0,
  };
}
const getNodeOutputsCases = [
  outputCase("static-main-no-onerror", { name: "Outputs Static" }, ["main"]),
  outputCase("single-main-continue-error-output", { name: "Outputs Single Err", onError: "continueErrorOutput" }, ["main"]),
  outputCase("multi-main-continue-error-output", { name: "Outputs Multi Err", onError: "continueErrorOutput" }, ["main", "main"]),
  outputCase("single-main-config-continue-error-output", { name: "Outputs Config Err", onError: "continueErrorOutput" }, [{ type: "main", displayName: "Out" }]),
];

/* ---------------- GC-5 getNodeInputs (contract §11 P-NODE-MODEL) -------------------- */

function inputCase(name, inputs) {
  const { result, warns } = warnCaptured(() =>
    helpers.getNodeInputs(THROWING_WORKFLOW, { name }, { inputs: JSON.parse(JSON.stringify(inputs)) }),
  );
  return { name, inputs, expect: result, warned: warns.length > 0 };
}
const getNodeInputsCases = [
  inputCase("static-with-config-object", ["main", { type: "ai_tool", required: true }]),
  inputCase("dynamic-expression-evaluator-throws", "={{ ['main'] }}"),
];

/* ---------------- GC-6 getNodeParameters (contract §11 P-NODE-MODEL) ---------------- */

const parameterProperties = [
  {
    displayName: "Mode",
    name: "mode",
    type: "options",
    options: [
      { name: "Simple", value: "simple" },
      { name: "Advanced", value: "advanced" },
    ],
    default: "simple",
    description: "",
  },
  {
    displayName: "Advanced Option",
    name: "advOpt",
    type: "string",
    default: "fallback",
    description: "",
    displayOptions: { show: { mode: ["advanced"] } },
  },
  { displayName: "Always Shown", name: "always", type: "string", default: "", description: "" },
];

function parameterCase(name, values, returnDefaults, returnNoneDisplayed) {
  const result = helpers.getNodeParameters(
    JSON.parse(JSON.stringify(parameterProperties)),
    JSON.parse(JSON.stringify(values)),
    returnDefaults,
    returnNoneDisplayed,
    null,
    null,
  );
  return { name, values, returnDefaults, returnNoneDisplayed, expect: result };
}
const typedButHidden = { mode: "simple", advOpt: "typed-but-hidden", always: "={{ 1+1 }}" };
const getNodeParametersCases = [
  parameterCase("defaults-only", {}, true, false),
  parameterCase("hidden-value-dropped-expression-preserved", typedButHidden, true, false),
  parameterCase("return-none-displayed-keeps-hidden", typedButHidden, true, true),
];

/* ---------------- GC-7 versionedNodeType (no-fallback semantics) ------------------- */

const v1 = { description: { displayName: "Versioned A", name: "versionedA", version: 1 } };
const v2 = { description: { displayName: "Versioned A", name: "versionedA", version: 2 } };
const versioned = new VersionedNodeType({ 1: v1, 2: v2 }, {});
const versionedSummary = (nodeType) =>
  nodeType === undefined ? null : { descriptionVersion: nodeType.description.version };
const plainNodeType = { description: { version: 1 } };
const versionedNodeTypeCases = [
  { op: "currentVersion", descriptionHasDefaultVersion: false, expect: versioned.currentVersion },
  { op: "getNodeType", version: null, expect: versionedSummary(versioned.getNodeType()) },
  { op: "getNodeType", version: 1, expect: versionedSummary(versioned.getNodeType(1)) },
  { op: "getNodeType", version: 9, expect: versionedSummary(versioned.getNodeType(9)) },
  {
    op: "getVersionedNodeTypePassthrough",
    expectIdentity: helpers.getVersionedNodeType(plainNodeType) === plainNodeType,
  },
];

/* ---------------- Wave 2: extended pure-function coverage (readiness doc §1.2) ------ */

/** Full description skeletons so fixtures double as G-3-conformant description samples. */
const descWebhook = {
  name: "webhookNode", displayName: "Webhook", group: ["trigger"], version: 1,
  defaults: { name: "My Webhook" }, description: "Webhook desc", skipNameGeneration: true,
  properties: [], inputs: [], outputs: ["main"],
};
const descChat = {
  name: "chatNode", displayName: "Chat Node", group: ["transform"], version: 1,
  defaults: { name: "Chat Node" }, description: "Chat node desc",
  properties: [{ name: "operation", displayName: "Operation", type: "options", default: "send",
    options: [{ name: "Send", value: "send", action: "Send Message" }],
    displayOptions: { show: { resource: ["chat"] } } }],
  inputs: ["main"], outputs: ["main"],
};
const descChatMalformedOption = {
  ...descChat,
  properties: [{ name: "operation", displayName: "Operation", type: "options", default: "send",
    options: [{ value: "send", action: "Send Message" }], // no `name` -> isINodePropertyOptions guard fails
    displayOptions: { show: { resource: ["chat"] } } }],
};
const descItem = {
  name: "itemNode", displayName: "Item Node", group: ["transform"], version: 1,
  defaults: { name: "Item Node" }, description: "Item node desc",
  properties: [{ name: "operation", displayName: "Operation", type: "options", default: "get",
    options: [{ name: "Get", value: "get" }],
    displayOptions: { show: { resource: ["item"] } } }],
  inputs: ["main"], outputs: ["main"],
};
const descFallback = {
  name: "fallbackNode", displayName: "FB", group: ["transform"], version: 1,
  defaults: { name: "Fallback Name" }, description: "Fallback description.",
  properties: [], inputs: ["main"], outputs: ["main"],
};

const resolveRelativePathCases = [
  { fullPath: "parameters.a.b.c", candidate: "&d", expect: resolveRelativePath("parameters.a.b.c", "&d") },
  { fullPath: "parameters.a.b[0].c", candidate: "&d", expect: resolveRelativePath("parameters.a.b[0].c", "&d") },
  { fullPath: "parameters.a.b.c", candidate: "d", expect: resolveRelativePath("parameters.a.b.c", "d") },
  { fullPath: "parameters.a", candidate: "&d", expect: resolveRelativePath("parameters.a", "&d") },
];

const hasDotNotationBannedCharCases = [
  "normalNode", "NormalNode1", "Node A", "with.dot", "1digit", "a-b", "under_score",
].map((input) => ({ input, expect: hasDotNotationBannedChar(input) }));

const mergeAppend = (() => {
  const main = [{ name: "a", default: 1 }];
  const add = [{ name: "b", default: 2 }];
  const after = JSON.parse(JSON.stringify(main)); helpers.mergeNodeProperties(after, JSON.parse(JSON.stringify(add)));
  return { name: "append-new-property", main, add, after };
})();
const mergeReplace = (() => {
  const main = [{ name: "a", default: 1 }, { name: "b", default: 2 }];
  const add = [{ name: "a", default: 99, v: "x" }];
  const after = JSON.parse(JSON.stringify(main)); helpers.mergeNodeProperties(after, JSON.parse(JSON.stringify(add)));
  return { name: "replace-same-name-in-place", main, add, after };
})();
const mergeSkip = (() => {
  const main = [{ name: "a", default: 1 }];
  const add = [{ name: "skip", doNotInherit: true, default: 7 }];
  const after = JSON.parse(JSON.stringify(main)); helpers.mergeNodeProperties(after, JSON.parse(JSON.stringify(add)));
  return { name: "do-not-inherit-skipped", main, add, after };
})();
const mergeNodePropertiesCases = [mergeAppend, mergeReplace, mergeSkip];

const makeNodeNameCases = [
  { name: "skip-name-generation", parameters: {}, description: descWebhook, expect: helpers.makeNodeName({}, descWebhook) },
  { name: "operation-action", parameters: { resource: "chat", operation: "send" }, description: descChat, expect: helpers.makeNodeName({ resource: "chat", operation: "send" }, descChat) },
  { name: "operation-no-action", parameters: { resource: "item", operation: "get" }, description: descItem, expect: helpers.makeNodeName({ resource: "item", operation: "get" }, descItem) },
  { name: "fallback-defaults-name", parameters: {}, description: descFallback, expect: helpers.makeNodeName({}, descFallback) },
  { name: "malformed-option-guard-fallback", parameters: { resource: "chat", operation: "send" }, description: descChatMalformedOption, expect: helpers.makeNodeName({ resource: "chat", operation: "send" }, descChatMalformedOption) },
];

const makeDescriptionCases = [
  { name: "operation-action", parameters: { resource: "chat", operation: "send" }, description: descChat, expect: helpers.makeDescription({ resource: "chat", operation: "send" }, descChat) },
  { name: "operation-no-action", parameters: { resource: "item", operation: "get" }, description: descItem, expect: helpers.makeDescription({ resource: "item", operation: "get" }, descItem) },
  { name: "fallback", parameters: {}, description: descFallback, expect: helpers.makeDescription({}, descFallback) },
];

const isDefaultNodeNameCases = ["My Webhook", "My Webhook1", "My Webhook X", "Other"]
  .map((name) => ({ name, expect: helpers.isDefaultNodeName(name, descWebhook, {}) }));

const isTriggerNodeCases = [
  { group: ["trigger"], expect: helpers.isTriggerNode({ group: ["trigger"] }) },
  { group: ["input"], expect: helpers.isTriggerNode({ group: ["input"] }) },
  { group: ["trigger", "output"], expect: helpers.isTriggerNode({ group: ["trigger", "output"] }) },
];

const displayParameterCases = [
  { name: "no-display-options", values: {}, property: { name: "x", type: "string", default: "" } },
  { name: "show-match", values: { mode: "advanced" }, property: { name: "y", displayOptions: { show: { mode: ["advanced"] } } } },
  { name: "show-mismatch", values: { mode: "simple" }, property: { name: "y", displayOptions: { show: { mode: ["advanced"] } } } },
  { name: "show-multi-key-and", values: { mode: "advanced", other: 2 }, property: { name: "y", displayOptions: { show: { mode: ["advanced"], other: [1] } } } },
  { name: "hide-match", values: { mode: "advanced" }, property: { name: "y", displayOptions: { hide: { mode: ["advanced"] } } } },
  { name: "hide-mismatch", values: { mode: "simple" }, property: { name: "y", displayOptions: { hide: { mode: ["advanced"] } } } },
].map((c) => ({ ...c, expect: helpers.displayParameter(c.values, c.property, null, null) }));

function assertCase(assertFn, name, parameterName, value) {
  try {
    assertFn(parameterName, value, {});
    return { name, fn: assertFn === assertParamIsString ? "string" : "number", parameterName, value, ok: true, message: null };
  } catch (error) {
    return { name, fn: assertFn === assertParamIsString ? "string" : "number", parameterName, value, ok: false, message: error.message };
  }
}
const assertParamIsTypeCases = [
  assertCase(assertParamIsString, "value-is-string", "param", "ok-str"),
  assertCase(assertParamIsString, "value-is-not-string", "pAnum", 42),
  assertCase(assertParamIsNumber, "value-is-not-number", "pX", "nope"),
];

/* ---------------- Wave 3: parameter-issues deep dive + filter-parameter suite ------- */

/** getNodeParametersIssues (WG-10): verbatim INode matters (disabled/pinned early-exit). */
const issuesProps = [
  { displayName: "Required Field", name: "req", type: "string", default: "", required: true },
];
const issuesPropsHidden = [
  { displayName: "Mode", name: "mode", type: "options",
    options: [{ name: "A", value: "a" }, { name: "B", value: "b" }], default: "a" },
  { displayName: "Required Field", name: "req", type: "string", default: "", required: true,
    displayOptions: { show: { mode: ["b"] } } },
];
const nodeBase = { id: "w10", name: "W10 Node", type: "noop", typeVersion: 1, position: [0, 0] };
function issuesCase(name, properties, parameters, extra = {}) {
  const { _pins = null, ...nodeExtra } = extra;
  const node = { ...nodeBase, parameters, ...nodeExtra };
  return {
    name,
    properties,
    node,
    pinDataNodeNames: _pins,
    expect: helpers.getNodeParametersIssues(properties, node, null, _pins ?? undefined),
  };
}
const getNodeParametersIssuesCases = [
  issuesCase("required-empty", issuesProps, { req: "" }),
  issuesCase("required-filled", issuesProps, { req: "filled" }),
  issuesCase("disabled-node-skipped", issuesProps, { req: "" }, { disabled: true }),
  issuesCase("pinned-node-skipped", issuesProps, { req: "" }, { _pins: ["W10 Node"] }),
  issuesCase("hidden-required-skipped", issuesPropsHidden, { mode: "a" }),
  issuesCase("shown-required-flagged", issuesPropsHidden, { mode: "b" }),
];

/** filter-parameter suite (WG-11..WG-13). Condition/options shapes per interfaces.ts:3298-3323. */
const filterOptionsDefault = { caseSensitive: false };
const fCond = (id, leftValue, operator, rightValue) => ({ id, leftValue, operator, rightValue });
function fCondCase(name, leftValue, operator, rightValue, options = null) {
  const resolved = options ?? filterOptionsDefault;
  const condition = fCond(name, leftValue, operator, rightValue);
  return {
    name, condition, options: resolved,
    expect: filterParameter.executeFilterCondition(condition, resolved),
  };
}
const executeFilterConditionCases = [
  fCondCase("string-equals-ci-default", "Hello", { type: "string", operation: "equals" }, "hello"),
  fCondCase("string-equals-case-sensitive", "Hello", { type: "string", operation: "equals" }, "hello",
    { caseSensitive: true }),
  fCondCase("string-contains-ci", "the quick brown fox", { type: "string", operation: "contains" }, "QUICK"),
  fCondCase("number-gt", 42, { type: "number", operation: "gt" }, 10),
  fCondCase("number-equals-mismatch", 42, { type: "number", operation: "equals" }, 41),
  fCondCase("boolean-true", true, { type: "boolean", operation: "true" }, null),
  fCondCase("string-not-empty-single-value", "x", { type: "string", operation: "notEmpty", singleValue: true }, ""),
  fCondCase("dateTime-equals", "2026-09-17T12:00:00Z", { type: "dateTime", operation: "equals" }, "2026-09-17T12:00:00Z"),
  fCondCase("unknown-operator-returns-false", "x", { type: "string", operation: "not-an-op" }, "y"),
];

function fThrowCase(name, leftValue, operator, rightValue) {
  const condition = fCond(name, leftValue, operator, rightValue);
  let thrown = null;
  try {
    filterParameter.executeFilterCondition(condition, filterOptionsDefault);
  } catch (error) {
    thrown = { errorClass: error.constructor.name, message: error.message };
  }
  return { name, condition, thrown };
}
const executeFilterConditionThrowCases = [
  fThrowCase("bad-date-conversion", "not-a-date", { type: "dateTime", operation: "equals" }, "2026-09-17"),
  fThrowCase("bad-number-conversion", "XYZ", { type: "number", operation: "equals" }, "5"),
];

const filterProperty = { displayName: "Filter", name: "filter", type: "filter", default: {}, required: false };
const validateFilterParameterCases = [
  {
    name: "well-formed-filter", property: filterProperty,
    filter: { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v1", "Hello", { type: "string", operation: "equals" }, "hello")] },
    expect: filterParameter.validateFilterParameter(filterProperty, { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v1", "Hello", { type: "string", operation: "equals" }, "hello")] }),
  },
  {
    name: "null-left-lenient", property: filterProperty,
    filter: { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v2", null, { type: "string", operation: "equals" }, "x")] },
    expect: filterParameter.validateFilterParameter(filterProperty, { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v2", null, { type: "string", operation: "equals" }, "x")] }),
  },
  {
    name: "string-right-on-number-op-lenient", property: filterProperty,
    filter: { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v3", 5, { type: "number", operation: "gt" }, "abc")] },
    expect: filterParameter.validateFilterParameter(filterProperty, { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v3", 5, { type: "number", operation: "gt" }, "abc")] }),
  },
  {
    name: "unknown-operator-lenient", property: filterProperty,
    filter: { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v4", "x", { type: "string", operation: "not-an-op" }, "y")] },
    expect: filterParameter.validateFilterParameter(filterProperty, { options: filterOptionsDefault, combinator: "and",
      conditions: [fCond("v4", "x", { type: "string", operation: "not-an-op" }, "y")] }),
  },
];

function fFilter(combinator, conditions) {
  return { options: filterOptionsDefault, combinator, conditions };
}
const executeFilterCases = [
  {
    name: "and-both-pass",
    filter: fFilter("and", [fCond("e1", "A", { type: "string", operation: "equals" }, "a"),
      fCond("e2", 5, { type: "number", operation: "gt" }, 3)]),
    expect: filterParameter.executeFilter(fFilter("and", [fCond("e1", "A", { type: "string", operation: "equals" }, "a"),
      fCond("e2", 5, { type: "number", operation: "gt" }, 3)])),
  },
  {
    name: "and-one-fails",
    filter: fFilter("and", [fCond("e3", "A", { type: "string", operation: "equals" }, "zzz"),
      fCond("e4", 5, { type: "number", operation: "gt" }, 3)]),
    expect: filterParameter.executeFilter(fFilter("and", [fCond("e3", "A", { type: "string", operation: "equals" }, "zzz"),
      fCond("e4", 5, { type: "number", operation: "gt" }, 3)])),
  },
  {
    name: "or-one-passes",
    filter: fFilter("or", [fCond("e5", "A", { type: "string", operation: "equals" }, "zzz"),
      fCond("e6", 5, { type: "number", operation: "gt" }, 3)]),
    expect: filterParameter.executeFilter(fFilter("or", [fCond("e5", "A", { type: "string", operation: "equals" }, "zzz"),
      fCond("e6", 5, { type: "number", operation: "gt" }, 3)])),
  },
];

/* ---------------- Wave 4: filter operator matrix sweep (verbatim switch lanes) ------ */
/* Enumerated from src/node-parameters/filter-parameter.ts:238-405. Non-negotiables:
   - regex/notRegex are EXEMPT from ignoreCase lowercasing (CI applies to plain strings only)
   - `exists`/`notExists` handled pre-switch (any type lane)
   - rightType ?: operator.type governs rightValue parsing (missing rightType on array
     ops throws 'can't be converted to an array')
   - dateTime null-guard returns false (no throw) after empty/notEmpty */

function mCase(name, leftValue, operator, rightValue) {
  const condition = { id: `w4-${name}`, leftValue, operator, rightValue };
  return {
    name, condition, options: filterOptionsDefault,
    expect: filterParameter.executeFilterCondition(condition, filterOptionsDefault),
  };
}
const filterOperatorMatrixCases = [
  mCase("string-notEquals", "alpha", { type: "string", operation: "notEquals" }, "beta"),
  mCase("string-notContains", "the quick fox", { type: "string", operation: "notContains" }, "brown"),
  mCase("string-startsWith-ci", "workflow engine", { type: "string", operation: "startsWith" }, "WORK"),
  mCase("string-endsWith-ci", "workflow engine", { type: "string", operation: "endsWith" }, "ENGINE"),
  mCase("string-regex-i-flag-exempt-from-ci", "the Quick fox", { type: "string", operation: "regex" }, "/^the quick/i"),
  mCase("string-null-coerces-empty", null, { type: "string", operation: "equals" }, "x"),
  mCase("number-lt", 3, { type: "number", operation: "lt" }, 10),
  mCase("number-gte-boundary", 10, { type: "number", operation: "gte" }, 10),
  mCase("number-lte-boundary-fail", 10, { type: "number", operation: "lte" }, 9),
  mCase("number-gt-boundary-fail", 10, { type: "number", operation: "gt" }, 10),
  mCase("dateTime-after", "2026-09-17", { type: "dateTime", operation: "after" }, "2026-09-16"),
  mCase("dateTime-before-mismatch", "2026-09-17", { type: "dateTime", operation: "before" }, "2026-09-16"),
  mCase("dateTime-afterOrEquals-equal", "2026-09-17T00:00:00Z", { type: "dateTime", operation: "afterOrEquals" }, "2026-09-17T00:00:00Z"),
  mCase("dateTime-null-guard-false", null, { type: "dateTime", operation: "after" }, "2026-09-16"),
  mCase("boolean-false-op", false, { type: "boolean", operation: "false" }, null),
  mCase("boolean-equals", true, { type: "boolean", operation: "equals" }, true),
  mCase("boolean-notEquals-fail", true, { type: "boolean", operation: "notEquals" }, true),
  mCase("array-contains-ci-string-rightType", ["Alpha", "BETA"], { type: "array", rightType: "string", operation: "contains" }, "alpha"),
  mCase("array-contains-ci-any-rightType", ["Alpha", "BETA"], { type: "array", rightType: "any", operation: "contains" }, "alpha"),
  mCase("array-lengthEquals", [1, 2, 3], { type: "array", rightType: "number", operation: "lengthEquals" }, 3),
  mCase("array-lengthGt-fail", [1], { type: "array", rightType: "number", operation: "lengthGt" }, 2),
  mCase("array-empty", [], { type: "array", operation: "empty" }, null),
  mCase("object-empty", {}, { type: "object", operation: "empty" }, null),
  mCase("object-notEmpty", { a: 1 }, { type: "object", operation: "notEmpty" }, null),
  mCase("any-exists", "x", { type: "any", operation: "exists" }, null),
  mCase("any-notExists-null", null, { type: "any", operation: "notExists" }, null),
];
const filterOperatorMatrixThrowCases = [
  (() => {
    const condition = { id: "w4-missing-rightType", leftValue: ["alpha"],
      operator: { type: "array", operation: "contains" }, rightValue: "alpha" };
    let thrown = null;
    try {
      filterParameter.executeFilterCondition(condition, filterOptionsDefault);
    } catch (error) {
      thrown = { errorClass: error.constructor.name, message: error.message };
    }
    return { name: "array-contains-missing-rightType", condition, thrown };
  })(),
];

/* ---------------- Wave 5: getNodeParameters nested shapes (collection/fixedCollection) */
/* Verified asymmetry: plain `collection` passes provided keys WITHOUT inner-default fill;
   fixedCollection FILLS inner defaults inside populated members; empty containers stay {}. */

const nestedCollectionProps = [
  { displayName: "Collection", name: "coll", type: "collection", default: {}, options: [
    { displayName: "Inner Text", name: "inner", type: "string", default: "inner-default" },
    { displayName: "Inner Num", name: "num", type: "number", default: 7 },
  ] },
];
const nestedFixedProps = [
  { displayName: "Fixed", name: "fixed", type: "fixedCollection", default: {}, options: [
    { name: "opts", displayName: "Opts", values: [
      { displayName: "Inner", name: "in", type: "string", default: "dflt" },
    ] },
  ] },
];
const nestedFixedMultiProps = [
  { displayName: "Fixed", name: "fixed", type: "fixedCollection",
    typeOptions: { multipleValues: true }, default: {}, options: [
    { name: "opts", displayName: "Opts", values: [
      { displayName: "Inner", name: "in", type: "string", default: "dflt" },
      { displayName: "Inner2", name: "other", type: "number", default: 9 },
    ] },
  ] },
];
const nestedHiddenProps = [
  { displayName: "Mode", name: "mode", type: "options",
    options: [{ name: "A", value: "a" }, { name: "B", value: "b" }], default: "a" },
  { displayName: "Collection", name: "coll", type: "collection", default: {},
    displayOptions: { show: { mode: ["b"] } }, options: [
    { displayName: "Inner", name: "inner", type: "string", default: "x" },
  ] },
];
function nestedCase(name, properties, values) {
  return {
    name,
    properties,
    values,
    returnDefaults: true,
    returnNoneDisplayed: false,
    expect: helpers.getNodeParameters(
      JSON.parse(JSON.stringify(properties)), JSON.parse(JSON.stringify(values)), true, false, null, null),
  };
}
const getNodeParametersNestedCases = [
  nestedCase("collection-empty-defaults-materialize-container", nestedCollectionProps, {}),
  nestedCase("collection-provided-no-inner-fill", nestedCollectionProps, { coll: { inner: "override" } }),
  nestedCase("fixed-single-empty", nestedFixedProps, {}),
  nestedCase("fixed-single-provided-verbatim", nestedFixedProps, { fixed: { opts: { in: "x" } } }),
  nestedCase("fixed-multi-one-member-verbatim", nestedFixedMultiProps, { fixed: { opts: [{ in: "one", other: 3 }] } }),
  nestedCase("fixed-multi-empty", nestedFixedMultiProps, {}),
  nestedCase("fixed-multi-partial-member-inner-fill", nestedFixedMultiProps, { fixed: { opts: [{ in: "one" }] } }),
  nestedCase("hidden-collection-dropped", nestedHiddenProps, { mode: "a", coll: { inner: "typed" } }),
  nestedCase("shown-collection-verbatim", nestedHiddenProps, { mode: "b", coll: { inner: "typed" } }),
];

/* ---------------- Regression tripwire: results must equal the VERIFIED goldens ------ */
/* (docs/isolation/node-golden-cases.md — values frozen by VERIFIED-BY-EXECUTION)      */

const trip = [];
const assertGolden = (label, actual, expected) => {
  if (!same(actual, expected)) trip.push(label);
};
assertGolden("GC-1#0", applyAccessPatternsCases[0].expect, "$('New Node').item.json.a + \"x\"");
assertGolden("GC-1#1", applyAccessPatternsCases[1].expect, "const x = $node[\"New Node\"].json.b");
assertGolden("GC-1#2", applyAccessPatternsCases[2].expect, "no reference here");
assertGolden("GC-2#0", getConnectionTypesCases[0].expect, ["main", "main", "ai_tool"]);
assertGolden("GC-3 html[0]", renameFormFieldsCases[0].after.parameters.formFields.values[0].html, "Hello $('New Node').item");
assertGolden("GC-3 text-entry untouched", renameFormFieldsCases[0].after.parameters.formFields.values[1], { fieldType: "text", label: "Name" });
assertGolden("GC-4 single+continueErrorOutput", getNodeOutputsCases[1].expect, [
  { type: "main", displayName: "Success" },
  { category: "error", type: "main", displayName: "Error" },
]);
assertGolden("GC-4 multi+continueErrorOutput", getNodeOutputsCases[2].expect, [
  "main", "main", { category: "error", type: "main", displayName: "Error" },
]);
assertGolden("GC-4 deep-copy guard", [1, 2, 3].every((i) => getNodeOutputsCases[i].descriptionUnchangedAfterCall), true);
assertGolden("GC-5 static", getNodeInputsCases[0].expect, ["main", { type: "ai_tool", required: true }]);
assertGolden("GC-5 dynamic", [getNodeInputsCases[1].expect, getNodeInputsCases[1].warned], [[], true]);
assertGolden("GC-6 defaults", getNodeParametersCases[0].expect, { mode: "simple", always: "" });
assertGolden("GC-6 hidden dropped", getNodeParametersCases[1].expect, { mode: "simple", always: "={{ 1+1 }}" });
assertGolden("GC-6 none-displayed", getNodeParametersCases[2].expect, { ...typedButHidden });
assertGolden("GC-7 current", versionedNodeTypeCases[0].expect, 2);
assertGolden("GC-7 no-arg", versionedNodeTypeCases[1].expect, { descriptionVersion: 2 });
assertGolden("GC-7 v1", versionedNodeTypeCases[2].expect, { descriptionVersion: 1 });
assertGolden("GC-7 v9 no-fallback", versionedNodeTypeCases[3].expect, null);
assertGolden("GC-7 passthrough", versionedNodeTypeCases[4].expectIdentity, true);
assertGolden("W2 rrm", resolveRelativePathCases.map((c) => c.expect), ["a.b.d", "a.b[0].d", "d", "d"]);
assertGolden("W2 banned", hasDotNotationBannedCharCases.map((c) => c.expect), [false, false, true, true, true, true, true]);
assertGolden("W2 merge-append", mergeAppend.after, [{ name: "a", default: 1 }, { name: "b", default: 2 }]);
assertGolden("W2 merge-replace", mergeReplace.after, [{ name: "a", default: 99, v: "x" }, { name: "b", default: 2 }]);
assertGolden("W2 merge-skip", mergeSkip.after, [{ name: "a", default: 1 }]);
assertGolden("W2 mnn", makeNodeNameCases.map((c) => c.expect), ["My Webhook", "Send Message", "Get item", "Fallback Name", "Send chat"]);
assertGolden("W2 mdesc", makeDescriptionCases.map((c) => c.expect), ["Send Message in Chat Node", "get item in Item Node", "Fallback description."]);
assertGolden("W2 idn", isDefaultNodeNameCases.map((c) => c.expect), [true, true, false, false]);
assertGolden("W2 trigger", isTriggerNodeCases.map((c) => c.expect), [true, false, true]);
assertGolden("W2 dp", displayParameterCases.map((c) => c.expect), [true, true, false, false, false, true]);
assertGolden("W2 assert-ok", assertParamIsTypeCases[0].ok, true);
assertGolden("W2 assert-str-msg", assertParamIsTypeCases[1].message, 'Parameter "pAnum" is not string');
assertGolden("W2 assert-num-msg", assertParamIsTypeCases[2].message, 'Parameter "pX" is not number');
assertGolden("W10 flags", getNodeParametersIssuesCases.map((c) => c.expect !== null),
  [true, false, false, false, false, true]);
assertGolden("W10 exact-message", getNodeParametersIssuesCases[0].expect.parameters.req,
  ['Parameter "Required Field" is required.']);
assertGolden("W10 shown-exact-message", getNodeParametersIssuesCases[5].expect.parameters.req,
  ['Parameter "Required Field" is required.']);
assertGolden("W11 verdicts", executeFilterConditionCases.map((c) => c.expect),
  [true, false, true, true, false, true, true, true, false]);
assertGolden("W11 throw-class", executeFilterConditionThrowCases.map((c) => c.thrown?.errorClass),
  ["FilterError", "FilterError"]);
assertGolden("W11 throw-messages", executeFilterConditionThrowCases.map((c) => c.thrown?.message), [
  "Conversion error: the string 'not-a-date' can't be converted to a dateTime [condition 0, item 0]",
  "Conversion error: the string 'XYZ' can't be converted to a number [condition 0, item 0]",
]);
assertGolden("W12 all-lenient", validateFilterParameterCases.map((c) => Object.keys(c.expect).length),
  [0, 0, 0, 0]);
assertGolden("W13 verdicts", executeFilterCases.map((c) => c.expect), [true, false, true]);
assertGolden("W14 matrix-verdicts", filterOperatorMatrixCases.map((c) => c.expect), [
  true, true, true, true, true, false,        // string lane
  true, true, false, false,                   // number lane
  true, false, true, false,                   // dateTime lane
  true, true, false,                          // boolean lane
  true, true, true, false, true,              // array lane
  true, true,                                 // object lane
  true, true,                                 // any-exists lane
]);
assertGolden("W14 throw", [
  filterOperatorMatrixThrowCases[0].thrown?.errorClass,
  filterOperatorMatrixThrowCases[0].thrown?.message,
], ["FilterError", "Conversion error: the string 'alpha' can't be converted to an array [condition 0, item 0]"]);
assertGolden("W15 nested-results", getNodeParametersNestedCases.map((c) => c.expect), [
  { coll: {} },
  { coll: { inner: "override" } },
  { fixed: {} },
  { fixed: { opts: { in: "x" } } },
  { fixed: { opts: [{ in: "one", other: 3 }] } },
  { fixed: {} },
  { fixed: { opts: [{ in: "one", other: 9 }] } },
  { mode: "a" },
  { mode: "b", coll: { inner: "typed" } },
]);

if (trip.length) {
  console.error("REFERENCE DRIFT vs docs/isolation/node-golden-cases.md:");
  for (const label of trip) console.error(`  - ${label}`);
  console.error("regression rule: STOP, INVESTIGATE, DOCUMENT — do not silently regenerate.");
  process.exit(3);
}

/* ---------------- Serde conformance samples (brief G-1..G-4; synthetic, not goldens) --- */

const serdeConformance = {
  note: "Synthetic conformance samples for crates/n8n-node-model serde shapes (node-rust-brief.md §1 G-1..G-4). Equality rule: deserialize -> serialize must be an exact JSON round-trip. Real node instances are read by the harness from tests/reference/0*/workflow.json, not embedded here.",
  descriptions: {
    G1_version_scalar: {
      displayName: "Version Scalar", name: "versionScalar", group: ["transform"], version: 1.2,
      defaults: { name: "Version Scalar" }, description: "scalar version arm", properties: [], inputs: ["main"], outputs: ["main"],
    },
    G1_version_array: {
      displayName: "Version Array", name: "versionArray", group: ["input"], version: [3, 3.4, 4],
      defaults: { name: "Version Array" }, description: "array version arm (multi-version node serialization)", properties: [], inputs: ["main"], outputs: ["main"],
    },
    G2_io_expression: {
      displayName: "IO Expression", name: "ioExpression", group: ["transform"], version: 1,
      defaults: { name: "IO Expression" }, description: "expression-string IO arm", properties: [],
      inputs: '={{ ["main"] }}', outputs: '={{ ["main", { "type": "ai_tool" }] }}',
    },
    G2_io_error_config: {
      displayName: "IO Error Config", name: "ioErrorConfig", group: ["transform"], version: 1,
      defaults: { name: "IO Error Config" }, description: "config-object IO arm incl. error category",
      properties: [], inputs: [{ type: "main" }, { type: "ai_memory", required: true }],
      outputs: [{ type: "main", displayName: "Success" }, { category: "error", type: "main", displayName: "Error", filter: { excludedNodes: ["NoOp"] }, maxConnections: 1 }],
    },
    G3_required_fields: {
      displayName: "Required Fields", name: "requiredFields", group: ["input", "transform"], version: 1,
      defaults: { name: "Required Fields", color: "#772244" },
      description: "group/defaults/properties required by INodeTypeDescription",
      properties: [{ displayName: "P", name: "p", type: "string", default: "" }],
      inputs: ["main"], outputs: ["main"],
    },
  },
  nodes: {
    G4_rich_optionals: {
      id: "g4-rich", name: "Rich Node", type: "n8n-nodes-base.noOp", typeVersion: 1.2,
      position: [0, 0],
      parameters: { plain: "value", expr: "={{ 1+1 }}" },
      disabled: false, notes: "n1", notesInFlow: true,
      credentials: { httpBasicAuth: { id: "1", name: "cred" } },
      onError: "continueRegularOutput", retryOnFail: true, maxTries: 3, waitBetweenTries: 1000,
      alwaysOutputData: true, executeOnce: true, continueOnFail: false,
      webhookId: "w1", extendsCredential: "x", rewireOutputLogTo: "main",
      forceCustomOperation: { resource: "r", operation: "o" },
    },
    G4_minimal: {
      id: "g4-min", name: "Minimal Node", type: "n8n-nodes-base.noOp", typeVersion: 1,
      position: [64, 256], parameters: {},
    },
  },
};

/* ---------------- Serialize / write / check ---------------------------------------- */

const fixtures = {
  meta: {
    source: "n8n-workflow@2.9.1 dist/cjs (repo tag n8n@2.9.4)",
    goldenDocument: "docs/isolation/node-golden-cases.md (GC-1..GC-7 + wave-2, VERIFIED-BY-EXECUTION)",
    generator: "node docs/isolation/node-fixtures.build.cjs  (drift check: --check)",
    comparisonRule: "deep JSON equality after per-key sort; byte-stable file by construction",
    coverage: {
      frozenPorts: "GC-1..GC-7 (19 cases)",
      wave2PureHelpers: [
        `resolveRelativePath:${resolveRelativePathCases.length}`,
        `hasDotNotationBannedChar:${hasDotNotationBannedCharCases.length}`,
        `mergeNodeProperties:${mergeNodePropertiesCases.length}`,
        `makeNodeName:${makeNodeNameCases.length}`,
        `makeDescription:${makeDescriptionCases.length}`,
        `isDefaultNodeName:${isDefaultNodeNameCases.length}`,
        `isTriggerNode:${isTriggerNodeCases.length}`,
        `displayParameter:${displayParameterCases.length}`,
        `assertParamIsType:${assertParamIsTypeCases.length}`,
      ].join(", "),
      wave3IssuesAndFilters: [
        `getNodeParametersIssues:${getNodeParametersIssuesCases.length}`,
        `executeFilterCondition:${executeFilterConditionCases.length}+${executeFilterConditionThrowCases.length}t`,
        `validateFilterParameter:${validateFilterParameterCases.length}`,
        `executeFilter:${executeFilterCases.length}`,
      ].join(", "),
      wave4OperatorMatrix: [
        `filterOperatorMatrix:${filterOperatorMatrixCases.length}+${filterOperatorMatrixThrowCases.length}t`,
      ].join(", "),
      wave5NestedParameters: [
        `getNodeParametersNested:${getNodeParametersNestedCases.length}`,
      ].join(", "),
    },
  },
  applyAccessPatterns: { cases: applyAccessPatternsCases },
  getConnectionTypes: { cases: getConnectionTypesCases },
  renameFormFields: { cases: renameFormFieldsCases },
  getNodeOutputs: { cases: getNodeOutputsCases },
  getNodeInputs: { cases: getNodeInputsCases },
  getNodeParameters: { cases: getNodeParametersCases, properties: parameterProperties },
  versionedNodeType: { cases: versionedNodeTypeCases },
  resolveRelativePath: { cases: resolveRelativePathCases },
  hasDotNotationBannedChar: { cases: hasDotNotationBannedCharCases },
  mergeNodeProperties: { cases: mergeNodePropertiesCases },
  makeNodeName: { cases: makeNodeNameCases },
  makeDescription: { cases: makeDescriptionCases },
  isDefaultNodeName: { cases: isDefaultNodeNameCases },
  isTriggerNode: { cases: isTriggerNodeCases },
  displayParameter: { cases: displayParameterCases },
  assertParamIsType: { cases: assertParamIsTypeCases },
  getNodeParametersIssues: { cases: getNodeParametersIssuesCases },
  executeFilterCondition: {
    optionsDefault: filterOptionsDefault,
    cases: executeFilterConditionCases,
    throwCases: executeFilterConditionThrowCases,
  },
  validateFilterParameter: { cases: validateFilterParameterCases },
  executeFilter: { cases: executeFilterCases },
  filterOperatorMatrix: {
    optionsDefault: filterOptionsDefault,
    cases: filterOperatorMatrixCases,
    throwCases: filterOperatorMatrixThrowCases,
    lanes: "string(6) number(4) dateTime(4) boolean(3) array(5) object(2) any-exists(2) — verbatim switch enumeration from src/node-parameters/filter-parameter.ts:238-405",
  },
  getNodeParametersNested: { cases: getNodeParametersNestedCases },
  serdeConformance,
};

const text = `${JSON.stringify(fixtures, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (existing !== text) {
    console.error("fixture drift: docs/isolation/node-fixtures.json is stale — run the generator and review the diff");
    process.exit(1);
  }
  console.log("node-fixtures.json is up to date (byte-identical re-derivation)");
  process.exit(0);
}

fs.writeFileSync(OUT, text);
console.log(`wrote ${OUT} (${text.length} bytes)`);
