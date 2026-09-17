/**
 * `@n8n-reconstructed/credentials-lego` (POOL-007)
 *
 * 1:1 reconstruction of the **pure** n8n 2.9.4 credential core:
 *
 *   cipher.mjs        Cipher              — OpenSSL "Salted__" envelope,
 *                                           EVP_BytesToKey(MD5, 1 iter),
 *                                           aes-256-cbc
 *   credentials.mjs   Credentials         — setData / getData / updateData /
 *                                           getDataToSave + error model
 *   redaction.mjs     redactValues, …     — blanking sentinels and restore
 *   support.mjs       isObjectLiteral,
 *                     jsonParse, deepCopy — SHARED helpers reproduced locally
 *
 * Zero runtime dependencies (node:crypto only). No Rust, per PROJECT_RULES
 * rule 1. `reference/n8n/**` is read-only and untouched.
 */

export { Cipher, getKeyAndIv, OPENSSL_SALTED_HEADER } from './cipher.mjs';
export {
	CREDENTIAL_ERRORS,
	CredentialDataError,
	Credentials,
	ICredentials,
	CIPHER_TOKEN,
} from './credentials.mjs';
export {
	CREDENTIAL_BLANKING_VALUE,
	CREDENTIAL_EMPTY_VALUE,
	redactCollectionOption,
	redactValues,
	unredact,
	unredactRestoreValues,
} from './redaction.mjs';
export {
	ApplicationError,
	deepCopy,
	isINodePropertyCollection,
	isObjectLiteral,
	jsonParse,
} from './support.mjs';
