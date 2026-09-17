# TASK RESULT: TASK-416-phase3-credentials-lego

**LEGO:** Credentials  
**Task ID:** TASK-416-phase3-credentials-lego  
**Contract:** `contracts/credentials.contract.md`  
**Isolation blueprint:** `docs/isolation/credentials.md`  
**Package:** `packages/credentials-lego`  
**Status:** **VERIFIED**

---

## 1. Summary of Deliverables

Reconstructed pure JavaScript (Node.js ESM, zero dependencies) implementation of the Credentials LEGO 1:1 against n8n 2.9.4:

1. **Cipher** (`src/cipher.mjs`):
   - Implements OpenSSL/CryptoJS-compatible `EVP_BytesToKey` key derivation (MD5, 1 iteration, 8-byte salt) → 32-byte key + 16-byte IV.
   - Symmetric AES-256-CBC cipher with exact wire format: `base64("Salted__" + salt(8) + ciphertext)`.
   - Handles payloads < 16 bytes by returning `''`. Throws on bad decryption key or padding failure.
   - Non-deterministic encryption using random salts; verified against independent `evpBytesToKey` implementation.

2. **Credentials Model** (`src/credentials.mjs`, `src/errors.mjs`):
   - `Credentials` class managing `{ id, name, type, data }`.
   - `setData`: verifies object literal input, serializes to JSON, and encrypts.
   - `getData`: decrypts, parses JSON, and enforces exact frozen error messages:
     - `No data is set on this credentials.` (`CREDENTIAL_ERRORS.NO_DATA`)
     - `Credentials could not be decrypted. The likely reason is that a different "encryptionKey" was used to encrypt the data.` (`CREDENTIAL_ERRORS.DECRYPTION_FAILED`)
     - `Decrypted credentials data is not valid JSON.` (`CREDENTIAL_ERRORS.INVALID_JSON`)
   - `updateData`: decrypts existing data, merges partial update, deletes requested keys, re-encrypts.
   - `getDataToSave`: returns database-compatible encrypted entity object.

3. **Redaction & Unredaction** (`src/redaction.mjs`, `src/constants.mjs`):
   - Sentinel constants:
     - `CREDENTIAL_BLANKING_VALUE`: `'__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6'`
     - `CREDENTIAL_EMPTY_VALUE`: `'__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da'`
   - `redactCredentials`: scans properties for password fields (`type === 'string' && typeOptions.password === true`), `oauthTokenData`, and `csrfSecret`, replacing with `CREDENTIAL_BLANKING_VALUE`. Handles nested `fixedCollection` hierarchies.
   - `unredactCredentials`: merges updated payload with stored plaintext, restoring original secrets when blanking sentinels are echoed back.

4. **Overwrites & Defaults** (`src/overwrites.mjs`):
   - `applyCredentialOverwrites`: applies environment/static overwrites only when value is unset (`null`, `undefined`, or `''`).

5. **CredentialsHelper & Access Control** (`src/helper.mjs`):
   - Resolves credentials by ID first, then by name.
   - `validateCredentialType`: verifies node credential type against declared types and inheritance chain (`extends`).
   - `authenticate`: applies headers or HTTP basic auth for `httpHeaderAuth` and `httpBasicAuth`.

---

## 2. Verification Evidence

- `npm --prefix packages/credentials-lego test`: **22/22 PASS**
  - Includes 2 negative controls (wrong key derivation with SHA-256 fails; corrupt ciphertext rejected).
  - Parity cross-check against reference golden `tests/reference/agent-4/golden/credentials.golden.json`.
- `node tools/credentials-lego-gate.mjs`: **6/6 PASS**
  - C01: zero runtime dependencies (0 dependencies)
  - C02: source boundary import-closed (8 source files, relative and node: builtins only)
  - C03: credentials conformance suite (22 pass / 0 fail)
  - C04: reference tree pinned (15050 files, f8da35180669d798…)
  - C05: formal credentials contract present (7/7 core symbols contracted)
  - C06: reference golden parity check (golden constants & cases verified)
- `npm run verify:all`: **12/12 PASS** across monorepo suites and gates.
