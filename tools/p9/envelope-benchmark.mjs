/** Reproducible P9.1 microbenchmark, not a workflow throughput claim. */
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { createTelemetryContext, createTelemetryRecord, serializeTelemetryRecord } from '../../apps/n8n-lego/src/lego/telemetry-envelope.mjs';
const context = createTelemetryContext({ workflowId: 'wf-1', executionId: 'exec-1', correlationId: 'req-1' });
const spec = { timestamp: 1720000000000, signalType: 'EVENT', component: 'execution', outcome: 'completed' };
let checksum = 0;
const iterations = 100000, batch = 1000;
function measure(name, fn) {
  for (let i = 0; i < 10000; i++) checksum += fn();
  global.gc?.();
  const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage(), timings = [];
  const start = performance.now();
  for (let i = 0; i < iterations; i += batch) {
    const t = performance.now();
    for (let j = 0; j < batch; j++) checksum += fn();
    timings.push((performance.now() - t) * 1000 / batch);
  }
  const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  global.gc?.();
  const memoryAfterGc = process.memoryUsage();
  timings.sort((a,b) => a-b);
  return { name, iterations, elapsedMs, opsPerSecond: iterations / elapsedMs * 1000,
    batchMeanUs: { p50: timings[49], p95: timings[94], p99: timings[98] }, cpuUs: cpu,
    heapDeltaBeforeGc: memoryAfter.heapUsed-memoryBefore.heapUsed,
    retainedHeapDeltaAfterGc: memoryAfterGc.heapUsed-memoryBefore.heapUsed,
    rssDelta: memoryAfter.rss-memoryBefore.rss };
}
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  gcExposed: !!global.gc, note: 'Batch-average latency, not per-event percentiles. Heap deltas are not allocation counts; GC/JIT and shared sandbox noise apply. No retained record queue.',
  results: [measure('OFF arithmetic control', () => spec.timestamp & 1),
    measure('minimal native record, shared context', () => createTelemetryRecord(spec, context).timestamp & 1),
    measure('cold context + record', () => createTelemetryRecord(spec, createTelemetryContext({ executionId:'exec-1' })).timestamp & 1),
    measure('slow-path record + codec', () => serializeTelemetryRecord(createTelemetryRecord(spec, context)).length)], checksum }, null, 2));
