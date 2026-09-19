# LEGO Contract: Binary Data

| Field | Value |
| :--- | :--- |
| Owner | Agent 3 — Binary Data Domain Engineer |
| LEGO | `binary-data` — Binary payload, buffer handling, storage modes |
| Status | Phase 3 — `IMPLEMENTED`, 10/10 workflow gates PASS, tsc 0 errors |
| Reference | n8n `2.9.4` — `reference/n8n/packages/core/src/binary-data/` |
| Isolation record | `docs/isolation/reconstructed-engine.md` |
| Rust | **NOT STARTED** |

## 1. Purpose
Own binary data handling: buffer to base64, storage modes (default, filesystem, s3), retrieval, preparation, validation.

## 2. Data Schema
```typescript
interface IBinaryData {
  data: string; // base64 payload OR storage mode name when id is set
  mimeType: string;
  fileName?: string;
  fileExtension?: string;
  fileSize?: string;
  fileType?: 'text' | 'json' | 'image' | 'audio' | 'video' | 'pdf' | 'html';
  directory?: string;
  bytes?: number;
  id?: string; // "<mode>:<fileId>" when stored externally
}
```

Constants: `BINARY_ENCODING = 'base64'`, `BINARY_IN_JSON_PROPERTY = '_files'`, `BINARY_MODE_SEPARATE = 'separate'`, `BINARY_MODE_COMBINED = 'combined'`.

## 3. Responsibilities
1. **Store**: `storeBinaryData(buffer, fileName?, mimeType?)` → `IBinaryData` (default mode base64, other modes id)
2. **Retrieve**: `getBinaryDataBuffer(binaryData)` → `Buffer`
3. **Prepare**: `prepareBinaryData(buffer, fileName?, mimeType?)` → `IBinaryData`
4. **Validation**: `isBinaryData(data)` type guard
5. **Modes**: default (in-memory base64), filesystem, s3 (external id)

## 4. Non-responsibilities
| Not owned | Owner |
| :--- | :--- |
| Execution data model (IRunData, ITaskData) | execution-data LEGO |
| Workflow execution loop | execution-engine LEGO |
| Persistence repository | persistence LEGO |
| HTTP handling | api/webhook LEGO |

## 5. Invariants
| Invariant | Enforced? | Evidence |
| :--- | :--- | :--- |
| `data` is base64 when `id` absent, mode name when `id` present | YES | binary-data.service.ts |
| `mimeType` always present | YES | storeBinaryData |
| `fileSize` human readable e.g. "7 B" | YES | default mode |
| `id` format "<mode>:<fileId>" | YES | filesystem/s3 modes |

## 6. Dependencies (ports consumed)
None — pure leaf, no external runtime deps except Node.js Buffer.

## 7. Tests
- `packages/binary-data-lego/` tsc 0 errors
- `test-enhanced.mjs` binary handling PASS
- `verify:fast` 10/10 PASS

## 8. Provenance
Reference: n8n 2.9.4 `packages/core/src/binary-data/`, reconstructed 1:1 in `packages/binary-data-lego/src/binary-data.ts`, integrated in `reconstructed-engine/src/binary/`.
