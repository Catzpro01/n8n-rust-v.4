import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Data encrypted by CryptoJS always starts with these bytes: "Salted__"
const RANDOM_BYTES = Buffer.from('53616c7465645f5f', 'hex');

/**
 * 1:1 port of `packages/core/src/encryption/cipher.ts` (n8n 2.9.4).
 *
 * The only delta is dependency injection: upstream is a `@Service()` that pulls
 * `InstanceSettings` from the DI container, here the settings object is passed
 * to the constructor. The cryptography is byte-identical.
 *
 * C-01  The 8-byte OpenSSL header "Salted__" is prepended, so every ciphertext
 *       starts with the base64 prefix `U2FsdGVkX1` — the same prefix CryptoJS
 *       produces, which is what makes n8n credentials portable to old installs.
 * C-02  Key derivation is OpenSSL `EVP_BytesToKey` with **MD5 and a single
 *       iteration**: key = md5(pwd|salt) | md5(hash1|pwd|salt), iv =
 *       md5(hash2|pwd|salt). MD5 here is a compatibility requirement, not a
 *       choice.
 * C-03  The encryption key is read as **'binary' (latin1)** before being
 *       concatenated with the salt, so a non-ASCII key is truncated to one byte
 *       per code point rather than UTF-8 encoded.
 * C-04  `decrypt` returns the **empty string** for any input shorter than 16
 *       bytes instead of throwing — an unparseable blob silently becomes "".
 * C-05  A fresh `randomBytes(8)` salt per call, so encrypting the same payload
 *       twice never yields the same ciphertext.
 */
export class Cipher {
	constructor(instanceSettings) {
		this.instanceSettings = instanceSettings;
	}

	encrypt(data, customEncryptionKey) {
		const salt = randomBytes(8);
		const [key, iv] = getKeyAndIv(salt, customEncryptionKey, this.instanceSettings);
		const cipher = createCipheriv('aes-256-cbc', key, iv);
		const encrypted = cipher.update(typeof data === 'string' ? data : JSON.stringify(data));
		return Buffer.concat([RANDOM_BYTES, salt, encrypted, cipher.final()]).toString('base64');
	}

	decrypt(data, customEncryptionKey) {
		const input = Buffer.from(data, 'base64');
		if (input.length < 16) return '';
		const salt = input.subarray(8, 16);
		const [key, iv] = getKeyAndIv(salt, customEncryptionKey, this.instanceSettings);
		const contents = input.subarray(16);
		const decipher = createDecipheriv('aes-256-cbc', key, iv);
		return Buffer.concat([decipher.update(contents), decipher.final()]).toString('utf-8');
	}
}

/**
 * OpenSSL `EVP_BytesToKey` (MD5, 1 iteration) — see C-02 and C-03.
 * Exported so the parity suite can drive both this port and the reference with
 * an identical derivation.
 */
export function getKeyAndIv(salt, customEncryptionKey, instanceSettings) {
	const encryptionKey = customEncryptionKey ?? instanceSettings.encryptionKey;
	const password = Buffer.concat([Buffer.from(encryptionKey, 'binary'), salt]);
	const hash1 = createHash('md5').update(password).digest();
	const hash2 = createHash('md5').update(Buffer.concat([hash1, password])).digest();
	const iv = createHash('md5').update(Buffer.concat([hash2, password])).digest();
	const key = Buffer.concat([hash1, hash2]);
	return [key, iv];
}

/** The literal "Salted__" header, exported for tests and golden replay. */
export const OPENSSL_SALTED_HEADER = RANDOM_BYTES;
