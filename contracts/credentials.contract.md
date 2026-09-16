# LEGO Contract: Credentials

Reference: n8n 2.9.4. Status: **VERIFIED** (Agent 4, Phase 2 — contract backed by reference tests + live 11/11 smoke).
Analysis: `docs/isolation/credentials.md`. Golden: `tests/reference/agent-4/golden/credentials.golden.json` (dummy credential, no real secrets).

## 1. Purpose
Store credential payloads encrypted at rest, decrypt them **only** at the moment a node (or OAuth flow) needs them, redact secrets at the API boundary, and enforce which node type may use which credential type. The encryption key never leaves `InstanceSettings`.

## 2. Inputs
| Input | Type | Producer |
|---|---|---|
| Create/update | `CredentialRequest.Create { name (3..128), type, data: ICredentialDataDecryptedObject, projectId? }` | API (`/rest/credentials`) |
| Redacted round-trip | `data` containing `CREDENTIAL_BLANKING_VALUE` / `CREDENTIAL_EMPTY_VALUE` markers | Editor via API |
| Lookup for execution | `getCredentials(nodeCredentials: INodeCredentialsDetails { id, name }, type, mode, executeData?, expressionResolveValues?)` | Node execution context (Execution, CROSS-BOUNDARY) |
| Credential type description | `ICredentialType { name, extends?, properties, authenticate?, test?, genericAuth? }` | `LoadNodesAndCredentials` (SHARED) |
| Encryption key | `N8N_ENCRYPTION_KEY` or `~/.n8n/config` `encryptionKey` | InstanceSettings (EXTERNAL) |
| Expression-resolvable properties | `={{ … }}` values resolved with workflow data at use time | Expression (SHARED) |

## 3. Outputs
| Output | Consumer |
|---|---|
| `credentials_entity.data` = `base64("Salted__" ‖ salt(8) ‖ aes-256-cbc(ct))` | Persistence (table owned here) |
| `ICredentialDataDecryptedObject` (in-memory, per call) | node `helpers.request*`/`authenticate` (Execution) |
| API entity **without** `data` by default; with `?includeData=true` → password-typed fields replaced by `CREDENTIAL_BLANKING_VALUE`, plain fields returned, OAuth token data stripped | API |
| `CredentialDataError` / `CredentialNotFoundError` / `NodeOperationError` | Execution / API |
| Test result `{ status:'OK' \| 'Error', message }` from `ICredentialType.test` / `authenticate` | API (`POST /rest/credentials/test`) |

## 4. Responsibilities
- **Cipher** (`core/src/encryption/cipher.ts`): OpenSSL `EVP_BytesToKey` (MD5, 1 iteration, 8-byte salt) → 32-byte key + 16-byte IV; `aes-256-cbc`; encrypt `JSON.stringify(data)`; decrypt returns `''` if input < 16 bytes; throws on wrong key/padding.
- **Credentials class** (`core/src/credentials.ts`): `setData` (encrypt), `getData` (decrypt+parse; `NO_DATA`/`DECRYPTION_FAILED`/`INVALID_JSON` errors), `updateData`, `getDataToSave`.
- **CredentialsHelper** (`cli/src/credentials-helper.ts`): resolve `{id,name}` → entity (id first, then legacy name lookup), decrypt, apply `applyDefaultsAndOverwrites` (credential defaults + `CredentialsOverwrites`), resolve expressions, then `authenticate` (generic auth / `preAuthentication`), OAuth refresh handled in `oauth2-credential.controller` / helpers.
- **Access rule at execution:** in production mode a node may use only credentials shared with the workflow's project (`credentialsFinderService.findCredentialForUser` / `permissionChecker`); manual executions additionally check the executing user.
- **Type rule:** node's declared `credentials[]` must include the credential `type` (or one it `extends`) else `NodeOperationError('Node does not have credential type "X"')`.
- **Redaction** (`CredentialsService.redact/unredact`): blank passwords → `CREDENTIAL_BLANKING_VALUE`; empty objects → `CREDENTIAL_EMPTY_VALUE`; on update, blanked keys are restored from the stored plaintext before re-encrypting; `oauthTokenData` never returned.
- **Write path:** `createEncryptedData` → `save` in a transaction with `shared_credentials(owner project, role 'credential:owner')`.

## 5. Non-responsibilities
- Does not perform HTTP requests (→ node helpers/Execution); it only mutates request options in `authenticate`.
- Does not own users/projects/roles — uses `shared_credentials` join for access.
- Does not manage the encryption key lifecycle beyond reading it (InstanceSettings creates/validates it; mismatched env vs file → startup abort).
- Does not persist plaintext anywhere (logs, events, `workflowData` snapshots contain only `{id,name}` references).
- Does not run credential tests inside the execution loop (`POST /rest/credentials/test` runs them in the main process via `CredentialsTester`).

## 6. Dependencies (verified)
| Module | Class |
|---|---|
| `core/src/encryption/cipher.ts`, `core/src/credentials.ts`, `core/src/errors/credential-data.error.ts` | INTERNAL |
| `cli/src/credentials/*` (`credentials.controller.ts`, `credentials.service.ts`, `credentials.service.ee.ts`, `credentials-finder.service.ts`, `credentials-tester.service.ts`), `cli/src/credentials-helper.ts`, `cli/src/credentials-overwrites.ts` | INTERNAL |
| `@n8n/db` `CredentialsEntity`, `SharedCredentials`, `CredentialsRepository`, `SharedCredentialsRepository` | INTERNAL semantics / Persistence infra |
| `InstanceSettings.encryptionKey` | EXTERNAL (config) |
| `node:crypto` | EXTERNAL |
| `n8n-workflow` `ICredentialType`, `ICredentialDataDecryptedObject`, `ICredentialsHelper` abstract class, `INodeCredentialsDetails`, `NodeOperationError` | SHARED |
| `LoadNodesAndCredentials`, `CredentialTypes` | SHARED (registry) |
| Callers: `NodeExecutionContext._getCredentials` (Execution), `WebhookHelpers` (webhook node auth), OAuth controllers (API), `ExternalSecretsManager` (`$secrets`), `SourceControl` export | CROSS-BOUNDARY |

## 7. Error behavior
| Case | Behaviour (verified) |
|---|---|
| `GET /rest/credentials/:id` unknown | 404 `{code:404,message:'Credential with ID "does-not-exist" could not be found.'}` |
| `POST /rest/credentials` unknown `type` | 500 `{code:0,message:'Unrecognized credential type: noSuchCredentialType'}` (thrown from `CredentialTypes.getByName`, not a 400 — compatibility quirk) |
| `POST` with `name` shorter than 3 | **accepted** (200) in 2.9.4 REST (DTO min-length only enforced on the public API) — do not "fix" without a boundary reason |
| Node uses credential of undeclared type | `NodeOperationError: Node does not have credential type "X"` |
| Credential id not found at execution | `CredentialNotFoundError` → node error `Credential with ID "…" does not exist for type "…"` |
| Node has no credential selected but requires one | `NodeOperationError: Node does not have any credentials set for "X"` |
| Wrong encryption key | `CredentialDataError: Credentials could not be decrypted. The likely reason is that a different "encryptionKey" was used to encrypt the data.` |
| Decrypted text not JSON | `CredentialDataError: Decrypted credentials data is not valid JSON.` |
| No data set | `CredentialDataError: No data is set on this credentials.` |
| Production execution using credential not shared with workflow project | `WorkflowOperationError: Node has no access to credential` (permission checker, before run) |

## 8. Lifecycle
```
create  → validate type exists → Credentials.setData(plain) [encrypt] → tx save entity + shared_credentials → response has ciphertext `data` (create only)
read    → GET /:id (no data) | GET /:id?includeData=true (decrypt → redact → return)
update  → unredact(blanked keys ← stored plaintext) → re-encrypt (new salt) → save; response without `data`
use     → node getCredentials → CredentialsHelper.getDecrypted → defaults/overwrites → expressions → authenticate(requestOptions)
delete  → DELETE /:id → { data: true }
```

## 9. Data ownership
- **Owns:** `credentials_entity` (`id` nanoid16, `name`, `type`, `data` ciphertext, `isManaged`, `isGlobal`, `isResolvable`, `resolvableAllowFallback`, `resolverId`), `shared_credentials`, `CredentialsOverwrites` (env `CREDENTIALS_OVERWRITE_DATA`, memory).
- **Never owns:** the key material; user/project tables; OAuth callback routing (API), though it writes `oauthTokenData` into `data`.

## 10. External interfaces
- REST: `GET/POST /rest/credentials`, `GET/PATCH/DELETE /rest/credentials/:id`, `POST /rest/credentials/test`, `GET /rest/credentials/new` (name suggestion), `PUT /rest/credentials/:id/share`, `PUT /rest/credentials/:id/transfer`.
- Public API: `/api/v1/credentials` (create/delete/schema/transfer).
- OAuth: `/rest/oauth1-credential/*`, `/rest/oauth2-credential/*` (callback writes `oauthTokenData`).
- Programmatic: `ICredentialsHelper` (`getDecrypted`, `authenticate`, `preAuthentication`, `updateCredentials`, `getCredentialsProperties`).

## 11. Compatibility requirements
- Wire format of `data` must remain `Salted__`+salt+AES-256-CBC with EVP_BytesToKey(MD5) so existing databases decrypt (CryptoJS compatible).
- Marker constants exactly: `__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6`, `__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da`.
- `data` is absent from list/get/update responses; present (ciphertext) on create response — keep as observed.
- Error strings above; the 500 on unknown type is existing behaviour.
- Test fixtures must never contain real secrets: use dummy values and a throw-away key (see `tests/reference/agent-4/credentials`).
