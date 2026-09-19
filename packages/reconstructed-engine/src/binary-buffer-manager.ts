// Binary Data Buffer Safe Allocator & Streaming Guard
export class BinaryBufferManager {
  private static readonly MAX_SAFE_SIZE = 50 * 1024 * 1024; // 50MB per chunk

  public static validateBufferAllocation(requestedSize: number): boolean {
    if (requestedSize > this.MAX_SAFE_SIZE) {
      throw new Error(`[Binary Guard] Alokasi buffer melebihi batas aman 50MB: ${requestedSize} bytes.`);
    }
    return true;
  }
}
