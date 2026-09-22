/**
 * Operator console — a single self-contained HTML page (no CDN, no build step).
 *
 * Everything the page does goes through the public contract, so it doubles as a
 * live smoke test of the runtime: health, version, node catalogue, workflow CRUD,
 * stateless and stored runs, execution history.
 */
import type { RuntimeConfig } from '../config.ts';

export const SAMPLE_WORKFLOW = {
  name: 'Sample: trigger → edit fields → no-op',
  nodes: [
    { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    {
      name: 'Edit Fields',
      type: 'n8n-nodes-base.set',
      typeVersion: 1,
      position: [220, 0],
      parameters: { values: { string: [{ name: 'status', value: 'ok' }], number: [{ name: 'count', value: 42 }] } },
    },
    { name: 'Done', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [440, 0], parameters: {} },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Edit Fields', type: 'main', index: 0 }]] },
    'Edit Fields': { main: [[{ node: 'Done', type: 'main', index: 0 }]] },
  },
};

export function renderConsolePage(config: RuntimeConfig): string {
  const bootstrap = {
    version: config.version,
    env: config.env,
    locale: config.locale,
    authRequired: config.apiKey !== null,
    storage: config.storage,
    unknownNodePolicy: config.unknownNodePolicy,
    allowCodeEval: config.allowCodeEval,
    sample: SAMPLE_WORKFLOW,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>n8n-ts runtime console</title>
<style>
  :root { color-scheme: dark; --bg:#0d1117; --panel:#161b22; --line:#30363d; --fg:#e6edf3; --muted:#8b949e;
          --accent:#2f81f7; --ok:#3fb950; --warn:#d29922; --err:#f85149; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background:var(--bg); color:var(--fg); }
  header { display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:12px 16px; border-bottom:1px solid var(--line);
           background:var(--panel); position:sticky; top:0; z-index:5; }
  h1 { font-size:15px; margin:0; font-weight:600; }
  .badge { font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
  .badge.ok { color:var(--ok); border-color:var(--ok); }
  .badge.err { color:var(--err); border-color:var(--err); }
  main { display:grid; grid-template-columns: 1.1fr 0.7fr 1.2fr; gap:12px; padding:12px 16px 32px; align-items:start; }
  @media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
  section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
  section h2 { font-size:13px; margin:0 0 8px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  textarea { width:100%; min-height:340px; background:#0b0f14; color:var(--fg); border:1px solid var(--line);
             border-radius:8px; padding:10px; font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; resize:vertical; }
  input[type=text], input[type=password] { background:#0b0f14; color:var(--fg); border:1px solid var(--line);
             border-radius:8px; padding:6px 8px; width:100%; }
  button { background:#21262d; color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:6px 10px;
           cursor:pointer; font-size:13px; }
  button:hover { border-color:var(--accent); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.danger { color:var(--err); }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; align-items:center; }
  .list { list-style:none; margin:0; padding:0; max-height:300px; overflow:auto; }
  .list li { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:6px 8px;
             border:1px solid var(--line); border-radius:8px; margin-bottom:6px; }
  .list li span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  pre { background:#0b0f14; border:1px solid var(--line); border-radius:8px; padding:10px; overflow:auto;
        max-height:340px; font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin:0; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); }
  .muted { color:var(--muted); }
  .warn { color:var(--warn); }
  .err { color:var(--err); }
  .ok { color:var(--ok); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  code { background:#0b0f14; padding:1px 5px; border-radius:5px; }
</style>
</head>
<body>
<header>
  <h1>n8n-ts runtime</h1>
  <span class="badge" id="health">health: …</span>
  <span class="badge" id="meta">v${bootstrap.version} · ${bootstrap.env} · ${bootstrap.storage}</span>
  <span class="badge" id="engine">engine: …</span>
  <span style="flex:1"></span>
  <label class="muted" for="apikey" style="font-size:12px">API key</label>
  <input id="apikey" type="password" placeholder="N8N_TS_API_KEY (optional)" style="max-width:220px" />
</header>

<main>
  <section>
    <h2>Workflow definition</h2>
    <div class="row">
      <button class="primary" id="run">Run</button>
      <button id="save">Save</button>
      <button id="saveAs">Save as new</button>
      <button id="sample">Load sample</button>
      <button id="format">Format</button>
    </div>
    <div class="row">
      <label class="muted">startNode <input type="text" id="startNode" placeholder="(auto)" style="max-width:140px"></label>
      <label class="muted">locale
        <input type="text" id="locale" value="${bootstrap.locale}" style="max-width:70px">
      </label>
    </div>
    <textarea id="editor" spellcheck="false"></textarea>
    <p class="muted" id="editorHint">Input items (JSON) sent to the trigger:</p>
    <textarea id="input" spellcheck="false" style="min-height:80px">[{"json":{}}]</textarea>
  </section>

  <section>
    <h2>Saved workflows</h2>
    <div class="row"><button id="refresh">Refresh</button></div>
    <ul class="list" id="workflows"><li class="muted">loading…</li></ul>
    <h2 style="margin-top:14px">Recent executions</h2>
    <ul class="list" id="executions"><li class="muted">none</li></ul>
  </section>

  <section>
    <h2>Result</h2>
    <div id="resultSummary" class="muted">No run yet.</div>
    <div class="row"><button id="toggleRaw">Show raw JSON</button></div>
    <pre id="result">—</pre>
    <h2 style="margin-top:14px">Execution log</h2>
    <table id="logTable"><thead><tr><th>node</th><th>type</th><th>in</th><th>out</th><th>ms</th><th>status</th></tr></thead><tbody></tbody></table>
    <h2 style="margin-top:14px">Runtime</h2>
    <pre id="runtimeInfo">—</pre>
  </section>
</main>

<script>
const BOOT = ${JSON.stringify(bootstrap)};
const $ = (id) => document.getElementById(id);
let lastRecord = null;
let currentId = null;

const apiKey = () => $('apikey').value.trim();
$('apikey').value = localStorage.getItem('n8n-ts-api-key') || '';
$('apikey').addEventListener('change', () => localStorage.setItem('n8n-ts-api-key', apiKey()));
$('editor').value = JSON.stringify(BOOT.sample, null, 2);

async function api(path, options = {}) {
  const headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {});
  const key = apiKey();
  if (key) headers['x-n8n-api-key'] = key;
  const response = await fetch(path, Object.assign({}, options, { headers }));
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = body && body.message ? body.message : response.status + ' ' + response.statusText;
    const error = new Error(message + (body && body.code ? ' [' + body.code + ']' : ''));
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
}

function setBadge(el, text, cls) { el.textContent = text; el.className = 'badge ' + (cls || ''); }

async function refreshHealth() {
  try {
    const response = await fetch('/healthz');
    const body = await response.json();
    setBadge($('health'), 'health: ' + body.status, body.status === 'ok' ? 'ok' : 'err');
  } catch (error) {
    setBadge($('health'), 'health: unreachable', 'err');
  }
}

async function refreshMeta() {
  try {
    const { data } = await api('/api/v1/version');
    $('engine').textContent = 'engine: ' + data.engine.package + '@' + data.engine.version + ' · registry ' + data.engine.registryVersion;
    setBadge($('meta'), 'v' + data.version + ' · ' + data.mode + ' · ' + BOOT.storage);
    const nodes = await api('/api/v1/nodes');
    $('runtimeInfo').textContent = JSON.stringify({ version: data, registeredNodeTypes: nodes.data.nodes.map((n) => n.type) }, null, 2);
  } catch (error) {
    setBadge($('engine'), 'engine: unavailable', 'err');
  }
}

async function refreshWorkflows() {
  const list = $('workflows');
  try {
    const { data } = await api('/api/v1/workflows');
    if (data.count === 0) { list.innerHTML = '<li class="muted">no saved workflows</li>'; return; }
    list.innerHTML = '';
    for (const item of data.items) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = item.name + '  (' + item.nodeCount + ' nodes)';
      const actions = document.createElement('span');
      const load = document.createElement('button'); load.textContent = 'Load';
      load.onclick = async () => {
        const response = await api('/api/v1/workflows/' + encodeURIComponent(item.id));
        currentId = item.id; $('editor').value = JSON.stringify(response.data, null, 2);
      };
      const run = document.createElement('button'); run.textContent = 'Run';
      run.onclick = () => runStored(item.id);
      const del = document.createElement('button'); del.className = 'danger'; del.textContent = '×';
      del.onclick = async () => { await api('/api/v1/workflows/' + encodeURIComponent(item.id), { method: 'DELETE' }); refreshWorkflows(); };
      actions.append(load, run, del);
      li.append(label, actions);
      list.append(li);
    }
  } catch (error) {
    list.innerHTML = '<li class="err">' + error.message + '</li>';
  }
}

async function refreshExecutions() {
  const list = $('executions');
  try {
    const { data } = await api('/api/v1/executions?limit=10');
    if (data.count === 0) { list.innerHTML = '<li class="muted">no executions yet</li>'; return; }
    list.innerHTML = '';
    for (const item of data.items) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = item.executionId.slice(0, 13) + '…  ' + item.status + ' · ' + item.durationMs + 'ms';
      label.className = item.ok ? 'ok' : 'err';
      const view = document.createElement('button'); view.textContent = 'View';
      view.onclick = async () => {
        const response = await api('/api/v1/executions/' + encodeURIComponent(item.executionId));
        renderRecord(response.data);
      };
      const actions = document.createElement('span'); actions.append(view);
      li.append(label, actions);
      list.append(li);
    }
  } catch (error) {
    list.innerHTML = '<li class="err">' + error.message + '</li>';
  }
}

function renderRecord(record) {
  lastRecord = record;
  $('resultSummary').innerHTML =
    '<span class="' + (record.ok ? 'ok' : 'err') + '">' + record.status + '</span> · ' +
    record.durationMs + 'ms · ' + record.executionId +
    (record.warnings && record.warnings.length ? ' · <span class="warn">' + record.warnings.length + ' warning(s)</span>' : '');
  $('result').textContent = JSON.stringify({ data: record.data, warnings: record.warnings, error: record.error }, null, 2);
  const tbody = $('logTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const entry of record.executionLog || []) {
    const tr = document.createElement('tr');
    for (const value of [entry.node, entry.type, entry.inputCount, entry.outputCount, entry.durationMs, entry.statusText || entry.status]) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    tbody.append(tr);
  }
}

function parseEditor() {
  try { return JSON.parse($('editor').value); }
  catch (error) { throw new Error('workflow editor does not contain valid JSON: ' + error.message); }
}

function parseInput() {
  const raw = $('input').value.trim();
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch (error) { throw new Error('input is not valid JSON: ' + error.message); }
}

async function runCurrent() {
  const payload = { workflow: parseEditor(), input: parseInput() };
  const startNode = $('startNode').value.trim();
  if (startNode) payload.startNode = startNode;
  const locale = $('locale').value.trim();
  if (locale) payload.locale = locale;
  payload.requestedBy = 'console';
  const { data } = await api('/api/v1/workflows/run', { method: 'POST', body: JSON.stringify(payload) });
  data.ok = true;
  renderRecord(data);
  refreshExecutions();
}

async function runStored(id) {
  const payload = { input: parseInput(), requestedBy: 'console' };
  const { data } = await api('/api/v1/workflows/' + encodeURIComponent(id) + '/run', { method: 'POST', body: JSON.stringify(payload) });
  data.ok = true;
  renderRecord(data);
  refreshExecutions();
}

function showError(error) {
  $('resultSummary').innerHTML = '<span class="err">' + error.message + '</span>';
  $('result').textContent = JSON.stringify(error.body || { message: error.message }, null, 2);
}

$('run').onclick = async () => { try { await runCurrent(); } catch (error) { showError(error); } };
$('save').onclick = async () => {
  try {
    const definition = parseEditor();
    if (currentId) definition.id = currentId;
    const { data } = await api('/api/v1/workflows', { method: 'POST', body: JSON.stringify({ workflow: definition }) });
    currentId = data.id;
    await refreshWorkflows();
  } catch (error) { showError(error); }
};
$('saveAs').onclick = async () => {
  try { currentId = null; await $('save').onclick(); } catch (error) { showError(error); }
};
$('sample').onclick = () => { $('editor').value = JSON.stringify(BOOT.sample, null, 2); currentId = null; };
$('format').onclick = () => { try { $('editor').value = JSON.stringify(parseEditor(), null, 2); } catch (error) { showError(error); } };
$('refresh').onclick = () => { refreshWorkflows(); refreshExecutions(); };
$('toggleRaw').onclick = () => { $('result').textContent = JSON.stringify(lastRecord || {}, null, 2); };

refreshHealth(); refreshMeta(); refreshWorkflows(); refreshExecutions();
setInterval(refreshHealth, 5000);
</script>
</body>
</html>
`;
}
