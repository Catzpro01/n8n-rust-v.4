/**
 * Execution Data LEGO — public surface.
 *
 * A 1:1 reconstruction, in plain Node.js ESM, of the *pure* n8n 2.9.4
 * execution-data core: item envelopes, the four node-facing item helpers, the
 * paired-item / source-data rules, the `IRunExecutionData` factories + version
 * migration, and the binary-data representation rules.
 *
 * Contract: contracts/execution-data.contract.md (owner Agent 3, status TESTED)
 * Reference: n8n 2.9.4, upstream commit b6dc2787c45677a29a9612cd27eb911302961a83
 * Runtime reference: n8n-workflow@2.9.1 / n8n-core@2.9.1 (the n8n 2.9.4 dependency set)
 *
 * ZERO RUST — per PROJECT_RULES rule 1.
 *
 * @typedef {object} ISourceData
 * @property {string} previousNode
 * @property {number} [previousNodeOutput]
 * @property {number} [previousNodeRun]
 *
 * @typedef {object} IPairedItemData
 * @property {number} item
 * @property {number} [input]
 * @property {ISourceData} [sourceOverwrite]
 *
 * @typedef {object} IBinaryData
 * @property {string} data
 * @property {string} mimeType
 * @property {'text'|'json'|'image'|'audio'|'video'|'pdf'|'html'} [fileType]
 * @property {string} [fileName]
 * @property {string} [directory]
 * @property {string} [fileExtension]
 * @property {string} [fileSize]
 * @property {number} [bytes]
 * @property {string} [id]
 */

export * from './constants.mjs';
export * from './errors.mjs';
export * from './deep-copy.mjs';
export * from './pretty-bytes.mjs';
export * from './item-helpers.mjs';
export * from './paired-items.mjs';
export * from './run-execution-data.mjs';
export * from './binary.mjs';
