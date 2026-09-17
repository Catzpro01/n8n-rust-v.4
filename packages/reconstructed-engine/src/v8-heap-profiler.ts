// V8 Heap & Memory Garbage Collection Profiler
export function getMemoryUsageMb(): { heapUsedMb: number; heapTotalMb: number; rssMb: number } {
  const mem = process.memoryUsage ? process.memoryUsage() : { heapUsed: 0, heapTotal: 0, rss: 0 };
  return {
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    rssMb: Math.round(mem.rss / (1024 * 1024))
  };
}
