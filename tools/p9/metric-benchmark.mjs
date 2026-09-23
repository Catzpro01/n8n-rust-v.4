import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { METRIC_DEFINITIONS,createMetricGovernor } from '../../apps/n8n-lego/src/lego/metric-governor.mjs';
const N=100000;let checksum=0;
function run(name, mode) {
  const g=createMetricGovernor({maxSeries:METRIC_DEFINITIONS.length+2});
  const labels={component:'execution'};
  const fn=i=>mode==='OFF'?1:g.observe('execution.started',1,mode==='STANDARD'?labels:{executionId:'exec-'+i,component:'unbounded-'+i});
  for(let i=0;i<10000;i++)checksum+=fn(i);g.reset();global.gc?.();
  const before=process.memoryUsage(),cpu=process.cpuUsage(),batches=[],t=performance.now();
  for(let b=0;b<100;b++){const start=performance.now();for(let i=0;i<1000;i++)checksum+=fn(b*1000+i);batches.push(performance.now()-start);}
  const elapsedMs=performance.now()-t,cpuUs=process.cpuUsage(cpu),after=process.memoryUsage();global.gc?.();batches.sort((a,b)=>a-b);
  return {name,iterations:N,elapsedMs,opsPerSecond:N/elapsedMs*1000,batchMeanUs:{p50:batches[49],p95:batches[94],p99:batches[98]},cpuUs,heapDeltaBeforeGc:after.heapUsed-before.heapUsed,retainedHeapDeltaAfterGc:process.memoryUsage().heapUsed-before.heapUsed,rssDelta:after.rss-before.rss,governor:g.stats()};
}
console.log(JSON.stringify({node:process.version,platform:process.platform,cpu:cpus()[0]?.model,note:'Microbaseline, not workflow throughput. Batch-average percentiles, not per-event p95/p99. Heap deltas are not allocation counts. Shared-host/JIT/GC noise.',results:[run('OFF control','OFF'),run('standard aggregation','STANDARD'),run('100k unique IDs and unknown components','HIGH_CARDINALITY')],checksum},null,2));
