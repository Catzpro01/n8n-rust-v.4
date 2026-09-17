const ok = (result) => ({ ok: true, result });
const fail = (message) => ({ ok: false, error: new Error(message) });

const firstItem = (taskData, checkAllMainOutputs) => {
  const outputs = taskData?.data?.main;
  if (!Array.isArray(outputs)) return undefined;
  for (const branch of outputs) {
    if (Array.isArray(branch) && branch.length > 0) return branch[0];
    if (!checkAllMainOutputs) break;
  }
  return undefined;
};

const firstDataBranch = (taskData, checkAllMainOutputs) => {
  const outputs = taskData?.data?.main;
  if (!Array.isArray(outputs)) return [];
  for (const branch of outputs) {
    if (Array.isArray(branch) && branch.length > 0) return branch;
    if (!checkAllMainOutputs) break;
  }
  return [];
};

const getPath = (value, path) => {
  if (path === undefined) return value;
  const parts = String(path).replace(/\[(['"]?)([^\]'".]+)\1\]/g, '.$2').split('.').filter(Boolean);
  return parts.reduce((current, key) => current == null ? undefined : current[key], value);
};

/** Reference onReceived body precedence. */
export function extractWebhookOnReceivedResponse(responseData, webhookResultData) {
  if (responseData === 'noData') return undefined;
  if (responseData) return responseData;
  if (webhookResultData?.webhookResponse !== undefined) return webhookResultData.webhookResponse;
  return { message: 'Workflow was started' };
}

/**
 * Reference lastNode response extraction behind explicit expression and binary-storage values.
 * Returns the n8n Result shape instead of throwing expected user-data errors.
 */
export async function extractWebhookLastNodeResponse({
  responseDataType,
  taskData,
  checkAllMainOutputs = false,
  responsePropertyName,
  responseContentType,
  responseBinaryPropertyName,
  getBinaryStream,
}) {
  if (responseDataType === 'noData') return ok({ type: 'static', body: undefined, contentType: undefined });

  if (responseDataType === 'firstEntryJson') {
    const item = firstItem(taskData, checkAllMainOutputs);
    if (!item) return fail('No item to return was found');
    return ok({ type: 'static', body: getPath(item.json, responsePropertyName), contentType: responseContentType });
  }

  if (responseDataType === 'firstEntryBinary') {
    const item = firstItem(taskData, checkAllMainOutputs);
    if (!item) return fail('No item was found to return');
    if (item.binary === undefined) return fail('No binary data was found to return');
    if (responseBinaryPropertyName === undefined) return fail("No 'responseBinaryPropertyName' is set");
    if (typeof responseBinaryPropertyName !== 'string') return fail("'responseBinaryPropertyName' is not a string");
    const binary = item.binary[responseBinaryPropertyName];
    if (binary === undefined) return fail(`The binary property '${responseBinaryPropertyName}' which should be returned does not exist`);
    if (binary.id) {
      if (!getBinaryStream) throw new Error('A binary stream port is required for persisted webhook response data');
      return ok({ type: 'stream', stream: await getBinaryStream(binary.id), contentType: binary.mimeType });
    }
    return ok({ type: 'static', body: Buffer.from(binary.data, 'base64'), contentType: binary.mimeType });
  }

  return ok({ type: 'static', body: firstDataBranch(taskData, checkAllMainOutputs).map((entry) => entry.json), contentType: undefined });
}
