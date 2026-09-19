/**
 * Sanitizer output pada level Edge.
 * Memastikan respons API tidak membocorkan format credentials (JWT, PAT, secret tokens).
 */
export class EdgeSanitizer {
  private static readonly REDACTION_PATTERNS = [
    /ghp_[a-zA-Z0-9]{36,}/g, // GitHub Personal Access Token
    /github_pat_[a-zA-Z0-9_]{50,}/g, // Fine-grained PAT
    /eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}/g, // JWTs
    /bot[0-9]+:[a-zA-Z0-9_\-]{30,}/g, // Telegram bot token format
    /https?:\/\/[^:]+:[^@]+@/g // Basic auth in URLs
  ];

  static sanitize(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      let res = data;
      for (const pattern of this.REDACTION_PATTERNS) {
        res = res.replace(pattern, '[REDACTED_SECRET]');
      }
      return res;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    if (typeof data === 'object') {
      const sanitizedObj: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        // Redact key values yang sensitif secara nama
        const lowerKey = k.toLowerCase();
        if (
          lowerKey.includes('token') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password') ||
          lowerKey.includes('apikey')
        ) {
          sanitizedObj[k] = '[REDACTED_SECRET]';
        } else {
          sanitizedObj[k] = this.sanitize(v);
        }
      }
      return sanitizedObj;
    }

    return data;
  }
}
