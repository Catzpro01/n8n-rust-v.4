const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i;
const XML_TYPE = /^(?:application|text)\/(?:[\w.+-]+\+)?xml(?:\s*;|$)/i;

const appendValue = (record, key, value) => {
  if (!(key in record)) record[key] = value;
  else if (Array.isArray(record[key])) record[key].push(value);
  else record[key] = [record[key], value];
};

export function normalizeFormData(values) {
  for (const key of Object.keys(values)) if (Array.isArray(values[key]) && values[key].length === 1) values[key] = values[key][0];
  return values;
}

export function getMultipartBoundary(contentType) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType));
  return match?.[1] ?? match?.[2];
}

const dispositionValue = (header, name) => {
  const match = new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`, 'i').exec(header);
  return match?.[1];
};

/** Binary-safe, dependency-free multipart parser with an injected file persistence port. */
export async function parseMultipartFormData(rawBody, contentType, { maxFileSize = Infinity, storeFile } = {}) {
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    const error = new Error('Multipart boundary is missing');
    error.statusCode = 400;
    throw error;
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const data = {};
  const files = {};
  let cursor = rawBody.indexOf(delimiter);
  if (cursor < 0) {
    const error = new Error('Invalid multipart request body');
    error.statusCode = 400;
    throw error;
  }
  while (cursor >= 0) {
    cursor += delimiter.length;
    if (rawBody.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (rawBody.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) cursor += 2;
    const headerEnd = rawBody.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) break;
    const headerText = rawBody.subarray(cursor, headerEnd).toString('latin1');
    const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    }));
    const next = rawBody.indexOf(delimiter, headerEnd + 4);
    if (next < 0) break;
    let contentEnd = next;
    if (rawBody.subarray(contentEnd - 2, contentEnd).equals(Buffer.from('\r\n'))) contentEnd -= 2;
    const content = rawBody.subarray(headerEnd + 4, contentEnd);
    const disposition = headers['content-disposition'] ?? '';
    const name = dispositionValue(disposition, 'name');
    const originalFilename = dispositionValue(disposition, 'filename');
    if (name && originalFilename !== undefined) {
      if (content.length <= maxFileSize) {
        const descriptor = { originalFilename, size: content.length, mimetype: headers['content-type'] ?? 'application/octet-stream', data: Buffer.from(content) };
        const stored = storeFile ? await storeFile({ ...descriptor, fieldName: name }) : descriptor;
        appendValue(files, name, stored ?? descriptor);
      }
    } else if (name) appendValue(data, name, content.toString('utf8'));
    cursor = next;
  }
  return { data: normalizeFormData(data), files: normalizeFormData(files) };
}

export async function parseWebhookBody(rawBody, contentType, options = {}) {
  const type = String(contentType ?? '');
  if (rawBody.length === 0) return { body: undefined, files: undefined };
  if (/^multipart\/form-data(?:\s*;|$)/i.test(type)) {
    const parsed = await parseMultipartFormData(rawBody, type, options);
    return { body: parsed, files: parsed.files };
  }
  if (JSON_TYPE.test(type)) {
    try { return { body: JSON.parse(rawBody.toString('utf8')), files: undefined }; }
    catch {
      const error = new Error('Invalid JSON in webhook request body');
      error.statusCode = 400;
      throw error;
    }
  }
  if (/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type)) {
    const body = {};
    for (const [key, value] of new URLSearchParams(rawBody.toString('utf8'))) appendValue(body, key, value);
    return { body, files: undefined };
  }
  if (/^text\//i.test(type) || XML_TYPE.test(type)) return { body: rawBody.toString('utf8'), files: undefined };
  return { body: rawBody, files: undefined };
}
