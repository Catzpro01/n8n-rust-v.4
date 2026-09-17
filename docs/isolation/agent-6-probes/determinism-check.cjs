// Determinism recipe for agent-6-probes: mask environment-dependent observations, then compare.
const ENV_PATHS = [
  'PIPE-12.12D_sandbox.process_version',
  'PIPE-12.12D_sandbox.process_sandbox',
  'PIPE-12.12D_sandbox.json_stringify_process',
  'PIPE-12.12D_sandbox.process_keys_expression',
  'PIPE-13.13D_extra.luxon_default_zone',
  'fixture.now',
];
const get = (o,p) => p.split('.').reduce((a,k)=>a?.[k], o);
const setv = (o,p,v) => { const ks=p.split('.'); const last=ks.pop(); const t=ks.reduce((a,k)=>a[k], o); if(t) t[last]=v; };
const mask = (x) => {
  for (const p of ENV_PATHS) setv(x, p, '<env-dependent>');
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, kk] of Object.entries(v)) {
        if (['pid','ppid','version','now','generatedAt','release','startTime','endTime','finishedTime','executionTime','startedAt'].includes(k)) { o[k] = '<env>'; continue; }
        o[k] = walk(kk);
      }
      return o;
    }
    if (typeof v === 'string') return v.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}/g, '<ts>').replace(/\d{13}/g, '<epoch>');
    return v;
  };
  return walk(x);
};
const a = mask(require(process.argv[2]));
const b = mask(require(process.argv[3]));
const same = JSON.stringify(a) === JSON.stringify(b);
console.log('DETERMINISM CHECK:', same ? 'MATCH (only environment-dependent fields differ)' : 'MISMATCH');
if (!same) {
  const pa = JSON.stringify(a), pb = JSON.stringify(b);
  let i = 0; while (pa[i] === pb[i]) i++;
  console.log('first diff at', i, '\nA:', pa.slice(i-120, i+120), '\nB:', pb.slice(i-120, i+120));
}
process.exit(same ? 0 : 1);
