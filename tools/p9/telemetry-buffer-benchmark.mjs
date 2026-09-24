/** P9.6 buffer admission baseline, not end-to-end runtime performance. */
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { createTelemetryBuffer } from '../../apps/n8n-lego/src/lego/telemetry-buffer.mjs';
const buf = createTelemetryBuffer({ capacity: 4096 });
const p2 = Object.freeze({ priority: 'P2', payload: Object.freeze({ id: 1 }) });
const p4 = Object.freeze({ priority: 'P4', payload: Object.freeze({ id: 2 }) });
let checksum = 0;
function measure(name, run) {
  for (let i = 0; i < 10000; i++) checksum += run();
  global.gc?.();
  const before = process.memoryUsage(), cpu = process.cpuUsage(), times = [];
  const start = performance.now();
  for (let b = 0; b < 100; b++) {
    const t = performance.now();
    for (let i = 0; i < 1000; i++) checksum += run();
    times.push(performance.now() - t);
  }
  const elapsedMs = performance.now() - start, cpuUs = process.cpuUsage(cpu), after = process.memoryUsage();
  global.gc?.();
  times.sort((a, b) => a - b);
  return {
    name, iterations: 100000, elapsedMs, opsPerSecond: 100000 / elapsedMs * 1000,
    batchMeanUs: { p50: times[49], p95: times[94], p99: times[98] }, cpuUs,
    heapDeltaBeforeGc: after.heapUsed - before.heapUsed,
    retainedHeapDeltaAfterGc: process.memoryUsage().heapUsed - before.heapUsed,
    rssDelta: after.rss - before.rss,
  };
}
let n = 0;
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  note: '100 batches of 1000; batch-mean percentiles only; heap deltas not allocation counts; shared sandbox/GC/JIT noise; no sink or disk spill; drain refills buffer so offers stay on the admit path.',
  results: [
    measure('OFF control', () => 0),
    measure('offer under capacity (refill each batch via take)', () => {
      if (n++ % 4096 === 4095) buf.take(4096);
      return buf.offer(p2) === 'buffered' ? 1 : 0;
    }),
    measure('offer saturated shed path (P4 into full buffer)', () => {
      // Fill once, then every offer is a shed decision (deterministic, no growth).
      if (n++ === 0) { buf.take(); for (let i = 0; i < 4096; i++) buf.offer(p2); }
      return buf.offer(p4) === 'shed' ? 1 : 0;
    }),
  ],
  checksum,
}, null, 2));
