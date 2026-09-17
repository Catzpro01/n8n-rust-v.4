// Unicode UTF-8 Sanitizer for Multi-Alphabet Payload (Cyrillic, Hanzi, Arabic, Javanese)
export function sanitizeUtf8String(raw: string): string {
  try {
    return Buffer.from(raw, 'utf-8').toString('utf-8');
  } catch {
    return raw;
  }
}

export function safeJsonSerialize(data: unknown): string {
  return JSON.stringify(data, (_, value) => {
    if (typeof value === 'string') {
      return sanitizeUtf8String(value);
    }
    return value;
  });
}
