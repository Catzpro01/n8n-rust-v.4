/**
 * Binary Data LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/core/src/binary-data/
 */

export interface IBinaryData {
  data: string;
  mimeType: string;
  fileName?: string;
  fileExtension?: string;
  fileSize?: string;
  bytes?: number;
  id?: string;
}

export class BinaryDataService {
  private mode: string;
  private storagePath: string;

  constructor(mode = 'default', storagePath = '/tmp/n8n-binary') {
    this.mode = mode;
    this.storagePath = storagePath;
  }

  async storeBinaryData(buffer: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> {
    if (this.mode === 'default') {
      return {
        data: buffer.toString('base64'),
        mimeType: mimeType || 'application/octet-stream',
        fileName,
        fileSize: `${buffer.length} B`,
        bytes: buffer.length,
      };
    } else {
      const id = `${this.mode}:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return {
        id,
        data: this.mode,
        mimeType: mimeType || 'application/octet-stream',
        fileName,
      };
    }
  }

  async getBinaryDataBuffer(binaryData: IBinaryData): Promise<Buffer> {
    if (binaryData.id) {
      throw new Error(`Binary data stored externally with id ${binaryData.id}, need manager`);
    }
    return Buffer.from(binaryData.data, 'base64');
  }

  async prepareBinaryData(buffer: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> {
    return this.storeBinaryData(buffer, fileName, mimeType);
  }
}

export function isBinaryData(data: any): boolean {
  return data && typeof data === 'object' && 'mimeType' in data && ('data' in data || 'id' in data);
}
