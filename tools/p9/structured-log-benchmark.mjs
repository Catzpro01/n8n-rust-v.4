/** P9.2 creation baseline, not end-to-end runtime performance. */
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { createTelemetryContext } from '../../apps/n8n-lego/src/lego/telemetry-envelope.mjs';
import { createStructuredLog } from '../../apps/n8n-lego/src/lego/structured-log.mjs';
const context = createTelemetryContext({ executionId:'exec-1', correlationId:'request-1' });
const normal = { timestamp:1720000000000, severity:'INFO', component:'execution', operation:'execute', outcome:'completed' };
const error = { ...normal, severity:'ERROR', outcome:'failed', errorCode:'execution.timeout', diagnosticRef:'diag-1', attributes:{attempt:2,durationMs:1000}, message:'deliberately omitted message' };
let checksum = 0;
function measure(name, spec) {
  const run = spec ? () => createStructuredLog(spec,context).redactionCount : () => 0;
  for(let i=0;i<10000;i++) checksum+=run();
  global.gc?.(); const before=process.memoryUsage(), cpu=process.cpuUsage(), times=[];
  const start=performance.now();
  for(let b=0;b<100;b++) { const t=performance.now(); for(let i=0;i<1000;i++) checksum+=run(); times.push(performance.now()-t); }
  const elapsedMs=performance.now()-start, cpuUs=process.cpuUsage(cpu), after=process.memoryUsage();
  global.gc?.(); times.sort((a,b)=>a-b);
  return { name, iterations:100000, elapsedMs, opsPerSecond:100000/elapsedMs*1000,
    batchMeanUs:{p50:times[49],p95:times[94],p99:times[98]}, cpuUs,
    heapDeltaBeforeGc:after.heapUsed-before.heapUsed,
    retainedHeapDeltaAfterGc:process.memoryUsage().heapUsed-before.heapUsed,
    rssDelta:after.rss-before.rss };
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,
  note:'100 batches of 1000; batch-mean percentiles only; heap deltas not allocation counts; shared sandbox/GC/JIT noise; no sink or retained queue.',
  results:[measure('OFF control',null),measure('normal structured log',normal),measure('classified error + redaction',error)], checksum},null,2));
