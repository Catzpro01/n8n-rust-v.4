// tools/certification/src/redact.mjs — secret-shaped content detection + redaction.
//
// The certification tool must never persist secret-shaped data. Both the
// environment fingerprint (command metadata) and any captured output summary
// are passed through here before being written.

// Each pattern consumes the ENTIRE value after a secret key (`.` does not
// match newlines, so redaction is per-line) — this prevents a trailing token
// from surviving when it sits after a known secret keyword.
const PATTERNS = [
  {
    src: String.raw`\b(authorization)\s*[:=]\s*.+`,
    flags: 'gi',
    replace: '$1=REDACTED',
  },
  {
    src: String.raw`\b(bearer)\s+.+`,
    flags: 'gi',
    replace: '$1 REDACTED',
  },
  {
    src: String.raw`\b(x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|cookie|credential|session[_-]?id|private[_-]?key)\s*[:=]\s*.+`,
    flags: 'gi',
    replace: '$1=REDACTED',
  },
];

/** True when `text` contains a secret-shaped fragment. */
export function hasSecretShaped(text) {
  if (typeof text !== 'string') return false;
  return PATTERNS.some(({ src, flags }) => new RegExp(src, flags).test(text));
}

/** Redact secret-shaped fragments in `text`; non-strings pass through untouched. */
export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { src, flags, replace } of PATTERNS) {
    out = out.replace(new RegExp(src, flags), replace);
  }
  return out;
}
