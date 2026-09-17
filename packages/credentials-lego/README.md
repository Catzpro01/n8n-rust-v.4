# Credentials LEGO (`@lego/credentials`)

Phase-3 JavaScript ESM reconstruction of the n8n 2.9.4 credentials boundary.

## Responsibilities
- **Cipher**: OpenSSL/CryptoJS-compatible `EVP_BytesToKey` (MD5, 1 round, 8-byte salt) → 32-byte key + 16-byte IV with `aes-256-cbc`. Wire format is `base64("Salted__" + salt(8) + ciphertext)`.
- **Credentials Model**: `setData`, `getData`, `updateData`, and `getDataToSave` with exact frozen `ApplicationError` / `CredentialDataError` exceptions (`NO_DATA`, `DECRYPTION_FAILED`, `INVALID_JSON`).
- **Redaction & Unredaction**: Sentinel substitution (`CREDENTIAL_BLANKING_VALUE`, `CREDENTIAL_EMPTY_VALUE`) for password-typed properties, OAuth token data, and CSRF secrets. Unredact restores stored plaintext when blanked sentinel values are echoed back.
- **Overwrites & Defaults**: Fills missing/blank values from environment or configured overwrites.
- **Access & Type Enforcement**: Verifies node declared credential types with inheritance support (`validateCredentialType`).
- **Zero Runtime Dependencies**: Pure Node.js ESM using `node:crypto`.
