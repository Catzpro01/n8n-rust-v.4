/**
 * Differential harness — ENGINE side. Emits JSON answers for tests/differential/cases.json
 * using the real n8n 2.9.4 runtime. Prints nothing but the result map.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RIG = process.env.EXPR_RIG ?? '/tmp/expr-rig';
if (!existsSync(join(RIG, 'node_modules/n8n-workflow'))) {
  console.log(JSON.stringify({ _skip: 'engine not installed' }));
  process.exit(0);
}
const require_ = createRequire(join(RIG, 'x.js'));
const { Workflow } = require_('n8n-workflow/dist/cjs/index.js');
const ROOT = process.argv[2] ?? '.';
const spec = JSON.parse(readFileSync(join(ROOT, 'tests/differential/cases.json'), 'utf8'));

const nodeTypes = {
  getByName: () => undefined,
  getByNameAndVersion: () => ({ description: { properties: [], name: 't', version: 1,
    defaults: {}, inputs: ['main'], outputs: ['main'] } }),
  getKnownTypes: () => ({}),
};

const out = {};
for (const c of spec.cases) {
  const nodes = c.nodes.map(([n, d]) => {
    const o = { id: n, name: n, type: 't', typeVersion: 1, position: [0, 0], parameters: {} };
    if (d !== null) o.disabled = d;
    return o;
  });
  const wf = new Workflow({ id: c.id, name: c.id, nodes, connections: c.connections,
    active: false, nodeTypes });
  const depth = c.depth ?? -1;
  const filter = c.filter ?? 'main';
  let v;
  try {
    if (c.op === 'getStartNode') {
      const s = wf.getStartNode(c.dest ?? undefined);
      v = s ? s.name : null;
    } else if (c.op === 'getChildNodes') {
      v = [...wf.getChildNodes(c.dest, filter, depth)].sort();
    } else if (c.op === 'getParentNodes') {
      v = [...wf.getParentNodes(c.dest, filter, depth)].sort();
    } else v = { error: 'unknown op' };
  } catch (e) { v = { error: e.constructor?.name ?? 'Error' }; }
  out[c.id] = v;
}
console.log(JSON.stringify(out, null, 1));
