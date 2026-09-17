// Credentials Engine — 1:1 dari CredentialsService + CredentialsOverwrites (n8n 2.9.4)
// Owner: Agent 4

import { CredentialEncryptionGuard } from './credential-encryption-guard.ts';

export class CredentialsEngine {
  private credentials = new Map();
  private overwrites = new Map();

  setOverwrite(type, data) {
    this.overwrites.set(type, data);
  }

  async createCredential(type, name, data) {
    const sanitized = CredentialEncryptionGuard.sanitizeCredentialInput(data);
    if (!sanitized.sanitized) throw new Error(`Credential sanitization failed: ${sanitized.errors.join(', ')}`);
    const id = `cred_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    // Encrypt: in real n8n, AES-256 with encryptionKey
    const encrypted = { data: JSON.stringify(data), iv: 'mock-iv' };
    this.credentials.set(id, { id, type, name, data: encrypted, isManaged: false });
    return { id, type, name };
  }

  async getDecrypted(id, type) {
    const cred = this.credentials.get(id);
    if (!cred) throw new Error(`Credential with ID "${id}" does not exist for type "${type}"`);
    if (cred.type !== type) throw new Error(`Node does not have credential type "${type}"`);
    // Decrypt
    try {
      const decrypted = JSON.parse(cred.data.data);
      // Apply overwrites
      const overwrite = this.overwrites.get(type);
      return { ...decrypted, ...overwrite };
    } catch {
      throw new Error('Credentials could not be decrypted. The likely reason is that a different \"encryptionKey\" was used to encrypt the data.');
    }
  }

  redact(data) {
    const redacted = {};
    for (const [k,v] of Object.entries(data)) {
      redacted[k] = typeof v === 'string' && v.length > 0 ? '***' : v;
    }
    return redacted;
  }
}
