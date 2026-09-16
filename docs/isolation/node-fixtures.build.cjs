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
const DIST = path.join(REPO_ROOT, "reference/n8n/packages/workflow/dist/cjs");
const OUT = path.join(__dirname, "node-fixtures.json");

function ref(name) {
  const file = path.join(DIST, name);
  if (!fs.existsSync(file)) {
    console.error(`reference module not found: ${file}`);
    console.error("build the pinned workflow package first: pnpm --filter n8n-workflow build");
    process.exit(2);
  }
  return require(file);
}

const helpers = ref("node-helpers.js");
const { renameFormFields } = ref("node-parameters/rename-node-utils.js");
const { applyAccessPatterns } = ref("node-reference-parser-utils.js");
const { VersionedNodeType } = ref("versioned-node-type.js");

for (const [label, fn] of Object.entries({
  getNodeParameters: helpers.getNodeParameters,
  getConnectionTypes: helpers.getConnectionTypes,
  getNodeOutputs: helpers.getNodeOutputs,
  getNodeInputs: helpers.getNodeInputs,
  getVersionedNodeType: helpers.getVersionedNodeType,
  renameFormFields,
  applyAccessPatterns,
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
    goldenDocument: "docs/isolation/node-golden-cases.md (GC-1..GC-7, VERIFIED-BY-EXECUTION)",
    generator: "node docs/isolation/node-fixtures.build.cjs  (drift check: --check)",
    comparisonRule: "deep JSON equality after per-key sort; byte-stable file by construction",
  },
  applyAccessPatterns: { cases: applyAccessPatternsCases },
  getConnectionTypes: { cases: getConnectionTypesCases },
  renameFormFields: { cases: renameFormFieldsCases },
  getNodeOutputs: { cases: getNodeOutputsCases },
  getNodeInputs: { cases: getNodeInputsCases },
  getNodeParameters: { cases: getNodeParametersCases, properties: parameterProperties },
  versionedNodeType: { cases: versionedNodeTypeCases },
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
