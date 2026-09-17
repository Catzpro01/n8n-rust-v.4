# Execution Data LEGO (`@lego/execution-data`)

Phase-3 JavaScript ESM reconstruction of the n8n 2.9.4 Execution Data boundary.

## Responsibilities
- **Item Shape & Envelope**: `INodeExecutionData` item envelope (`{ json, binary?, pairedItem?, error? }`).
- **Item Normalization Helpers**: `normalizeItems`, `returnJsonArray`, `copyInputItems`, and `constructExecutionMetaData`.
- **Paired-Item Assignment**: Exact 2.9.4 rules for `assignPairedItems`, input item pairing preparation (`prepareInputPairedItems`), and `alwaysOutputData` single-item synthesis (`applyAlwaysOutputData`).
- **Run Execution Data Factories**: `createRunExecutionData`, `createEmptyRunExecutionData`, `createErrorExecutionData`, and `migrateRunExecutionData` (v0 → v1).
- **Binary Data Preparation**: In-memory `prepareBinaryData` with base64 payload, `fileSize`, `fileType`, `bytes`, and `fileExtension`.
- **Zero Runtime Dependencies**: Pure Node.js ESM.
