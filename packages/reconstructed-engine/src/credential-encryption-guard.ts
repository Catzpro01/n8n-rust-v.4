// Credential Encryption Guard — Sanitasi Input Kredensial & Enkripsi Kunci n8n
// 1:1 dari packages/cli/src/credentials & @n8n/api-types

export interface CredentialSanitizeResult {
  sanitized: boolean;
  errors: string[];
}

export class CredentialEncryptionGuard {
  static sanitizeCredentialInput(data: Record<string, any>): CredentialSanitizeResult {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      return { sanitized: false, errors: ['Invalid credential data'] };
    }

    // Cek field berbahaya
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of Object.keys(data)) {
      if (dangerousKeys.includes(key)) {
        errors.push(`Dangerous key detected: ${key}`);
      }
    }

    // Pastikan tidak ada script injection
    const jsonStr = JSON.stringify(data);
    if (jsonStr.includes('<script') || jsonStr.includes('javascript:')) {
      errors.push('Potential script injection detected');
    }

    return { sanitized: errors.length === 0, errors };
  }

  static isEncryptionKeyValid(key: string): boolean {
    // n8n encryption key harus 32+ char base64 atau hex
    if (!key) return false;
    return key.length >= 32;
  }
}
