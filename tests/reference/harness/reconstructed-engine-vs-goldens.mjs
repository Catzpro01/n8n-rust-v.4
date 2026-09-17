// ISSUE-033 evidence probe (agent-3). Drives packages/reconstructed-engine/runner.mjs with the
// pinned connection goldens. Read-only: does not modify the engine. Run: node <this file>
import { WorkflowExecutionEngine } from '../../../packages/reconstructed-engine/runner.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'connection');
const run = async (dir, start, label) => {
  const c = JSON.parse(fs.readFileSync(path.join(root, dir, 'case.json')));
  const e = new WorkflowExecutionEngine({ nodes: c.nodes, connections: c.connections });
  let steps = 0; const get = e.nodes.get.bind(e.nodes);
  e.nodes.get = (n) => { if (++steps > 200) throw new Error('RUNAWAY >200 node executions'); return get(n); };
  try {
    const r = await Promise.race([e.runWorkflow(start), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 2000))]);
    console.log(label, '->', r.executionLog.map((x) => x.node).join(','));
  } catch (err) { console.log(label, '-> THREW:', err.message.slice(0, 90)); }
};
await run('01-linear', null, '01 linear (no start given)');
await run('04-cycle', 'A', '04 cycle from A');
await run('09-two-node-cycle-start-highest', 'B', '09 A->B->A from B');
await run('10-error-output-sparse-slots', 'Trigger', '10 sparse slots from Trigger');
await run('03-connection-types', null, '03 ai types, no start');
