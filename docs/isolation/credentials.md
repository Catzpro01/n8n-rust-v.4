# LEGO Isolation: Credentials

**Agent:** Agent 4 — Phase 2 LEGO Isolation
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Status:** VERIFIED (ANALYZED → ISOLATED → TESTED → VERIFIED; documentation + contract, no source change required; smoke 11/11 before and after, live verification passed — see `docs/isolation/agent-4-report.md`)

> Security rule for this LEGO: no real secret, key or credential appears in
> the repository, the docs, or the tests. Golden tests use a throw-away key
> that is generated inside the test and never persisted.

---

## 1. Correction to the anatomy

`docs/anatomy/13-credentials.md` says *"AES-256-GCM"*. **The source uses
AES-256-CBC with an OpenSSL/CryptoJS-compatible key derivation**
(`packages/core/src/encryption/cipher.ts`). Details in §3. Any Rust port that
implemented GCM would be unable to read existing databases.

---

## 2. Source inventory

```
packages/core/src/encryption/cipher.ts                     Cipher.encrypt / decrypt        (crypto primitive)
packages/core/src/credentials.ts                           Credentials<T> (setData/getData/getDataToSave), CredentialDataError
packages/core/src/constants.ts                             CREDENTIAL_ERRORS
packages/core/src/instance-settings/instance-settings.ts   encryptionKey source (env / ~/.n8n/config), mismatch check
packages/core/src/execution-engine/node-execution-context/node-execution-context.ts
                                                           _getCredentials(): node-side lookup rules + errors
packages/@n8n/db/src/entities/credentials-entity.ts        credentials_entity
packages/@n8n/db/src/entities/shared-credentials.ts        shared_credentials (project ownership)
packages/@n8n/db/src/repositories/credentials.repository.ts
packages/cli/src/credentials-helper.ts                     CredentialsHelper (ICredentialsHelper impl): getDecrypted, authenticate, defaults/overwrites, OAuth refresh
packages/cli/src/credentials/credentials.service.ts        API-side CRUD, redact/unredact, sharing, test
packages/cli/src/credentials/credentials.controller.ts     /rest/credentials
packages/cli/src/credentials-overwrites.ts                 CREDENTIALS_OVERWRITE_DATA
packages/cli/src/credential-types.ts                       CredentialTypes registry (ICredentialType descriptions)
packages/cli/src/errors/credential-not-found.error.ts
packages/workflow/src/interfaces.ts                        ICredentials (abstract), ICredentialsHelper (abstract), ICredentialDataDecryptedObject, INodeCredentialsDetails
packages/workflow/src/constants.ts                         CREDENTIAL_EMPTY_VALUE
packages/cli/src/constants.ts                              CREDENTIAL_BLANKING_VALUE
```

---

## 3. Encryption / decryption (verified)

`Cipher` (core/src/encryption/cipher.ts):

```
encrypt(data: string | object, customKey?):
   salt   = randomBytes(8)
   key,iv = getKeyAndIv(salt, customKey ?? instanceSettings.encryptionKey)
   ct     = aes-256-cbc(key, iv).update(JSON.stringify or string) + final
   return base64( "Salted__" (53616c7465645f5f) ‖ salt ‖ ct )

decrypt(data: base64, customKey?):
   input = base64decode(data); if length < 16 → return ''
   salt  = input[8..16]; contents = input[16..]
   key,iv = getKeyAndIv(salt, …)
   return utf8( aes-256-cbc-decrypt )       // throws on bad padding / wrong key

getKeyAndIv(salt, encryptionKey):            // OpenSSL EVP_BytesToKey, MD5, 1 iteration
   password = Buffer(encryptionKey,'binary') ‖ salt
   h1 = md5(password)
   h2 = md5(h1 ‖ password)
   iv = md5(h2 ‖ password)
   key = h1 ‖ h2                              // 32 bytes
```

This is exactly the CryptoJS `AES.encrypt(text, passphrase)` wire format, kept
for backward compatibility with pre-1.0 databases.

`Credentials<T>` (core/src/credentials.ts):

| Method | Behaviour |
| :--- | :--- |
| `setData(data)` | asserts object literal; `this.data = cipher.encrypt(data)` |
| `getData()` | `data === undefined` → `CredentialDataError(NO_DATA)`; decrypt failure → `CredentialDataError(DECRYPTION_FAILED)`; `jsonParse` failure → `CredentialDataError(INVALID_JSON)` |
| `updateData(toUpdate, toDelete)` | decrypt → merge → delete keys → re-encrypt |
| `getDataToSave()` | `{id, name, type, data}` (encrypted string) or `ApplicationError('No credentials were set to save.')` |

`CREDENTIAL_ERRORS` messages:

* `NO_DATA`: "No data is set on this credentials."
* `DECRYPTION_FAILED`: "Credentials could not be decrypted. The likely reason is that a different "encryptionKey" was used to encrypt the data."
* `INVALID_JSON`: "Decrypted credentials data is not valid JSON."

### Encryption configuration

`InstanceSettings.loadOrCreate()`:

* Key comes from `N8N_ENCRYPTION_KEY` (env) **or** `~/.n8n/config` JSON
  (`{"encryptionKey": "..."}`), generated with `randomBytes(24).toString('base64')`
  on first start if neither exists (workers must have the env var:
  `WorkerMissingEncryptionKey`).
* If both exist and differ → `ApplicationError('Mismatching encryption keys…')`
  and startup aborts.
* The settings file is written with mode `0600` and permissions are enforced/
  warned by `ensureSettingsFilePermissions()`.
* The key is never persisted in the database.

---

## 4. Storage

`credentials_entity`: `id` (nanoid 16), `name` (3..128), `type` (indexed),
`data: text` (the base64 ciphertext — never plaintext), `isManaged`,
`isGlobal`, `isResolvable`, `resolvableAllowFallback`, `resolverId`,
`createdAt/updatedAt`. Ownership via `shared_credentials(credentialsId, projectId, role)`.

`CredentialsEntity.toJSON()` strips `shared`. The API layer additionally
strips/redacts `data` (see §6).

Write path (`CredentialsService.createEncryptedData` → `save`):

```
new Credentials({id, name}, type).setData(plainData) → getDataToSave() → repository.save (transaction with SharedCredentials)
```

---

## 5. Lookup and usage boundary (execution side)

Node code never sees ciphertext or the key. Flow when a node calls
`this.getCredentials(type)`:

```
NodeExecutionContext._getCredentials(type)          core/…/node-execution-context.ts:286
  ├─ resolve nodeType; fullAccess = node.type ∈ {httpRequest, httpRequestTool, httpRequestAsTool}
  ├─ !fullAccess:
  │     nodeType.description.credentials undefined      → NodeOperationError `Node type "<t>" does not have any credentials defined`
  │     no description for `type`                       → NodeOperationError `Node type "<t>" does not have any credentials of type "<type>" defined`
  │     description hidden by displayOptions            → NodeOperationError 'Credentials not found'
  ├─ node.credentials?.[type] missing:
  │     required && !node.credentials                   → 'Node does not have any credentials set'
  │     required && !node.credentials[type]             → `Node does not have any credentials set for "<type>"`
  │     not required                                    → 'Node does not require credentials'
  │     fullAccess                                      → 'Credentials not found'
  └─ additionalData.credentialsHelper.getDecrypted(additionalData, {id,name}, type, mode, executeData, raw=false, exprValues)
        (cli CredentialsHelper)                          cli/src/credentials-helper.ts:344
        ├─ getCredentialsEntity: id missing → UnexpectedError('Found credential with no ID.')
        │                        repository.findOneByOrFail({id, type}); EntityNotFoundError → CredentialNotFoundError
        │                        message: `Credential with ID "<id>" does not exist for type "<type>".`
        ├─ new Credentials(...).getData()                → plaintext object (or CredentialDataError)
        ├─ dynamic credentials (EE) resolveIfNeeded(...) when executionContext.credentials set
        └─ applyDefaultsAndOverwrites(): credential-type defaults, CREDENTIALS_OVERWRITE_DATA,
             expression resolution inside credential values ($vars/$secrets), OAuth token refresh
```

The plaintext object lives only in the node's call stack; it is not stored in
`IRunExecutionData` and is not logged. `authenticate()` /
`preAuthentication()` in `CredentialsHelper` apply the credential type's
`authenticate` block to outgoing HTTP requests (headers/qs/body/auth).

Owner-of-call: `ICredentialsHelper` is an abstract class in `n8n-workflow`;
`additionalData.credentialsHelper` is injected by
`WorkflowExecuteAdditionalData.getBase()` (cli). This is the Credentials LEGO's
port into execution — nothing else in execution touches credentials.

---

## 6. API boundary (`/rest/credentials`) — redaction

`CredentialsService.decrypt(entity, includeRawData=false)`:

* decrypts; on `CredentialDataError` reports and returns `{}` (the UI shows
  an empty form rather than failing).
* `redact(data, entity)` replaces every property with `typeOptions.password`
  (and `oauthTokenData`, `csrfSecret`) by
  `CREDENTIAL_BLANKING_VALUE` (`__n8n_BLANK_VALUE_e5362baf-…`) when non-empty or
  `CREDENTIAL_EMPTY_VALUE` (`__n8n_EMPTY_VALUE_7b1af746-…`) when empty.
  Expression values (`={{ … }}`) are not redacted unless `noDataExpression`.
* `unredact(newData, savedData)` on update restores blanked values from the
  stored plaintext, so the client never round-trips real secrets.
* `GET /rest/credentials/:id?includeData=true` requires scope
  `credential:update`; otherwise `data` is omitted entirely.

Endpoints: `GET /`, `GET /for-workflow`, `GET /new`, `GET /:id`,
`POST /test`, `POST /`, `PATCH /:id`, `DELETE /:id`, `PUT /:id/share`,
`PUT /:id/transfer` (see `api.md`).

---

## 7. Dependency map

```
Credentials LEGO
   ├── node:crypto                                        EXTERNAL
   ├── InstanceSettings (key source, ~/.n8n/config)       core INTERNAL (filesystem config)
   ├── @n8n/db CredentialsRepository, SharedCredentials   PERSISTENCE (Agent 4)
   ├── CredentialTypes / NodeTypes (descriptions)         SHARED (Agent 2)
   ├── workflow.expression (values in credentials)         SHARED (Agent 3 – Expression)
   ├── ExternalSecretsProxy ($secrets)                     EE / external
   ├── DynamicCredentialsProxy (EE)                        EE
   ├── OAuth token refresh (HTTP to provider)              EXTERNAL
   └── ICredentialsHelper port ← NodeExecutionContext      CROSS-BOUNDARY (Execution/Node call in; Credentials never calls out to execution)
```

---

## 8. Boundary decision

Two boundaries, both already explicit in source:

1. **Crypto boundary** — `Cipher` + `Credentials<T>` in `n8n-core`. Pure,
   DI-injected, unit-tested (`core/src/encryption/__tests__/cipher.test.ts`,
   `core/test/credentials.test.ts`). This is what a Rust crate must
   reproduce bit-for-bit.
2. **Usage boundary** — `ICredentialsHelper.getDecrypted(...)` (abstract in
   `n8n-workflow`, implemented in cli). Execution and nodes only know this
   interface.

**No source change is made.** Contract in `contracts/credentials.contract.md`.

---

## 9. Reference tests

* Upstream: `cipher.test.ts`, `core/test/credentials.test.ts`,
  `cli/src/__tests__/credentials-helper.test.ts`,
  `cli/src/credentials/__tests__/credentials.service.test.ts`,
  `cli/test/integration/credentials/*.test.ts`.
* Agent 4 golden: `tests/reference/agent-4/credentials/credentials.test.ts`
  * encryption/decryption round-trip with the documented KDF (re-implemented
    in the test with node:crypto and compared against **n8n's own `Cipher`**
    from the installed 2.9.4 runtime),
  * decrypt with wrong key → `DECRYPTION_FAILED`,
  * `getData()` without data → `NO_DATA`, garbage ciphertext → `INVALID_JSON`,
  * missing credential → `CredentialNotFoundError` message,
  * node-side lookup error table,
  * redaction blanking values.
  All keys are generated in-test; nothing is written to disk.

---

## 10. Risks

* KDF is MD5-based EVP_BytesToKey; it is weak by modern standards but **must**
  be preserved for compatibility. Do not "upgrade" it in a port.
* `Buffer.from(encryptionKey, 'binary')` — non-ASCII keys are truncated to
  latin1 bytes. A Rust port must mimic this, not use UTF-8.
* `decrypt()` returns `''` (not an error) for inputs shorter than 16 bytes;
  `getData()` then fails with `INVALID_JSON`, not `DECRYPTION_FAILED`.
