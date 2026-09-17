import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Data encrypted by CryptoJS/n8n always starts with these bytes: 'Salted__' (0x53616c7465645f5f)
export const RANDOM_BYTES = Buffer.from('53616c7465645f5f', 'hex');

export class Cipher {
	constructor(options = {}) {
		this.encryptionKey = options.encryptionKey ?? '';
	}

	encrypt(data, customEncryptionKey) {
		const keyToUse = customEncryptionKey ?? this.encryptionKey;
		const salt = randomBytes(8);
		const [key, iv] = this.getKeyAndIv(salt, keyToUse);
		const cipher = createCipheriv('aes-256-cbc', key, iv);
		const payload = typeof data === 'string' ? data : JSON.stringify(data);
		const encrypted = cipher.update(payload, 'utf8');
		return Buffer.concat([RANDOM_BYTES, salt, encrypted, cipher.final()]).toString('base64');
	}

	decrypt(data, customEncryptionKey) {
		const input = Buffer.from(data, 'base64');
		if (input.length < 16) return '';
		const salt = input.subarray(8, 16);
		const [key, iv] = this.getKeyAndIv(salt, customEncryptionKey ?? this.encryptionKey);
		const contents = input.subarray(16);
		const decipher = createDecipheriv('aes-256-cbc', key, iv);
		return Buffer.concat([decipher.update(contents), decipher.final()]).toString('utf8');
	}

	getKeyAndIv(salt, customEncryptionKey) {
		const encryptionKey = customEncryptionKey ?? this.encryptionKey;
		const password = Buffer.concat([Buffer.from(encryptionKey, 'binary'), salt]);
		const hash1 = createHash('md5').update(password).digest();
		const hash2 = createHash('md5')
			.update(Buffer.concat([hash1, password]))
			.digest();
		const iv = createHash('md5')
			.update(Buffer.concat([hash2, password]))
			.digest();
		const key = Buffer.concat([hash1, hash2]);
		return [key, iv];
	}
}
