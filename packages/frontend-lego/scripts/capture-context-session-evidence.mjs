import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { VOCABULARIES, LOCAL_VOCABULARIES, PENDING_PUBLICATIONS, PROMOTED_PUBLICATIONS, PENDING_CONTRACT_ROWS, QUOTED_FROM, DECLARED_OVERLAPS } from '../src/vocabulary.mjs';

const repo = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
// The peer tree is read-only and is pointed at explicitly; nothing here writes to it and nothing
// here assumes it exists. `git archive origin/<peer-branch> apps/n8n-lego/src/lego | tar -x -C <dir>`
// is how it is produced.
const peerRoot = process.env.N8N_PEER_BACKEND_LEGO_ROOT ?? '';
const hasPeer = peerRoot !== '' && existsSync(`${peerRoot}/contracts/contract-lock.json`);
const FOCUSED = ['packages/frontend-lego/test/32-context-session.test.mjs',
  'packages/frontend-lego/test/29-alignment.test.mjs', 'packages/frontend-lego/test/31-skills.test.mjs',
  'packages/frontend-lego/test/24-vocabulary.test.mjs', 'packages/frontend-lego/test/33-milestones.test.mjs',
  'packages/frontend-lego/test/19-conformance.test.mjs'];
// A missing file would silently shrink the count, and a smaller number still looks like a pass.
for (const file of FOCUSED) if (!existsSync(`${repo}/${file}`)) throw new Error(`focused test file not found: ${file}`);
const run = (env) => {
  const out = execFileSync('bash', ['-c', `node --test ${FOCUSED.join(' ')} 2>&1`],
    { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8' });
  return summarise(out);
};
const runSuite = (env) => {
  const files = execFileSync('bash', ['-c', 'ls packages/frontend-lego/test/*.test.mjs'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  const out = execFileSync('bash', ['-c', `node --test ${files.join(' ')} 2>&1`], { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8' });
  return summarise(out);
};
// The runner's TAP summary may be CRLF-terminated, so the counts are matched without a line-end anchor.
const summarise = (out) => {
  const grab = (key) => {
    const matches = [...out.matchAll(new RegExp(`^#\\s*${key}\\s+(\\d+)`, 'gm'))].map((m) => Number(m[1]));
    return matches.length ? matches[matches.length - 1] : null;
  };
  const result = { tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), skipped: grab('skipped') };
  if (result.tests === null) throw new Error(`no TAP summary in the test output; first 400 chars: ${out.slice(0, 400)}`);
  return result;
};

const surface = JSON.parse(readFileSync(`${repo}/packages/frontend-lego/manifest/context-session.json`, 'utf8'));
const decisions = JSON.parse(readFileSync(`${repo}/docs/n8n-lego/decisions/cross-agent-decisions.json`, 'utf8'));
const peerLock = hasPeer ? JSON.parse(readFileSync(`${peerRoot}/contracts/contract-lock.json`, 'utf8')) : { rows: [] };
const localLock = JSON.parse(readFileSync(`${repo}/apps/n8n-lego/src/lego/contracts/contract-lock.json`, 'utf8'));
const rowsOf = (lock) => (lock.rows ?? lock.contracts ?? []);
const ids = (lock) => rowsOf(lock).map((r) => r.id ?? r.contract).filter((id) => /^ai\.(context|agent-session)$/.test(id));

const evidence = {
  capturedAt: new Date().toISOString().slice(0, 10),
  milestone: 'P2.13',
  side: 'frontend (agent-1)',
  branch: 'arena/01a0c6b4-n8n-rust-v-4',
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  peerTreeAvailable: hasPeer,
  purpose: 'Evidence that the frontend consumes the published backend vocabulary and nothing else, and that it is truthful against BOTH trees: protected main (no publication) and agent-2\'s publication (fb254f32).',
  trees: {
    protectedMain: {
      commit: 'e754c5df35b41b0ff2ac769519f05f056835411c',
      contractLockRows: rowsOf(localLock).length,
      publishedContextOrSessionRows: ids(localLock),
      note: 'this branch carries a copy of the protected-main backend; neither ai.context nor ai.agent-session is locked here',
    },
    peerPublication: hasPeer ? {
      agent: 'agent-2',
      branch: 'arena/01a0c6b5-n8n-rust-v-4',
      commit: 'fb254f32',
      contractLockRows: rowsOf(peerLock).length,
      publishedContextOrSessionRows: rowsOf(peerLock)
        .filter((r) => ids(peerLock).includes(r.id ?? r.contract))
        .map((r) => `${r.id ?? r.contract}@${r.version} owner=${r.owner} status=${r.status} domain=${r.domain}`),
      note: 'GitHub-visible, not merged. The frontend quotes it and records protected main beside it.',
      root: peerRoot,
    } : { skipped: `no peer tree pointed at (N8N_PEER_BACKEND_LEGO_ROOT=${peerRoot || 'unset'})` },
  },
  runs: {
    focusedThisTree: run({}),
    focusedPeerTree: hasPeer ? run({ N8N_BACKEND_LEGO_ROOT: peerRoot }) : { skipped: `no peer tree at N8N_PEER_BACKEND_LEGO_ROOT (${peerRoot || 'unset'})` },
    fullSuiteThisTree: runSuite({}),
    fullSuitePeerTree: hasPeer ? runSuite({ N8N_BACKEND_LEGO_ROOT: peerRoot }) : { skipped: 'no peer tree pointed at' },
    focusedFiles: FOCUSED.map((file) => file.replace('packages/frontend-lego/test/', '')),
    howThePeerTreeIsPointedAt: 'N8N_BACKEND_LEGO_ROOT=<git archive origin/arena/01a0c6b5-n8n-rust-v-4>/apps/n8n-lego/src/lego',
  },
  vocabulary: {
    quotedSets: VOCABULARIES.length,
    localSets: LOCAL_VOCABULARIES.length,
    pendingPublicationRows: PENDING_PUBLICATIONS.length,
    promotedPublicationRows: PROMOTED_PUBLICATIONS.length,
    pendingContractRows: PENDING_CONTRACT_ROWS.length,
    declaredOverlapsChecked: DECLARED_OVERLAPS.length,
    quotedFrom: Object.fromEntries(Object.entries(QUOTED_FROM).map(([k, v]) => [k, v?.contract ?? v?.file ?? v?.symbol ?? (v === null ? 'null (deliberately unpublished)' : JSON.stringify(v).slice(0, 60))])),
    publicationStatus: surface.publication?.status ?? null,
    source: 'packages/frontend-lego/src/vocabulary.mjs — imported, not retyped',
    beforeThisCommit: { quotedSets: 53, pendingPublicationRows: 2, contextOperations: 2, aiLegoStatusWords: 5 },
  },
  publicationManifest: {
    rowsThisTreePublishes: surface.publication?.rows?.length ?? 0,
    protectedMainBlock: surface.publication?.protectedMain ?? null,
    publishedOnPeerBranchBlock: surface.publication?.publishedOnPeerBranch ?? null,
    expectedOperationCount: (surface.publication?.expected ?? []).reduce((n, e) => n + (e.operations?.length ?? 0), 0),
    policy: 'publication.rows carries only what THIS tree publishes, so the surface cannot claim a publication it does not hold; the peer rows are evidence, recorded verbatim, in a separate block.',
  },
  registeredDivergences: [],
  closedDivergences: [
    {
      id: 'backend-internal-spelling',
      status: 'closed',
      where: 'manifest/ai-lego-set.json#lego[id=context-session].continuationPackage',
      canonicalContractSpelling: ['toolStateReferences', 'importantReferences'],
      closedBy: { commit: 'fa18ba76', agent: 'agent-2', mergedIn: { branch: 'main', commit: 'efa3da35', pullRequest: 45 } },
      verifiedOnMain: true,
      decision: 'XA-20',
    },
    {
      id: 'pre-merge-operation-count',
      status: 'closed',
      where: 'capabilities[id=ai.context].operations',
      allFiveOperationsPublished: ['load', 'compact', 'rollover', 'rehydrate', 'verify'],
      closedBy: { mergedIn: { branch: 'main', commit: 'efa3da35', pullRequest: 45 } },
      verifiedOnMain: true,
      decision: 'XA-20',
    },
  ],
  openDecisions: decisions.decisions
    .filter((d) => ['XA-20', 'XA-21'].includes(d.id))
    .map((d) => ({ id: d.id, status: d.status, blockingLevel: d.blockingLevel, question: d.question })),
  scopeHonesty: {
    implementedHere: ['contract-level presentation of context scope, session identity and state, usage state, rollover preparation, continuation state, continuity verification, session relationships, degraded continuation'],
    notImplemented: [
      'model inference', 'provider calls', 'Agent Machine loop', 'multi-agent runtime', 'Skill execution',
      'Memory store', 'Workspace executor', 'filesystem/terminal authority', 'MCP runtime',
      'Runtime Adapter runtime', 'Node Creator/Translation runtime', 'token provider integration',
      'external agent runtime', 'Rust',
    ],
    neverRendered: ['a token dashboard', 'a transcript', 'fabricated token counts', 'a Memory-store implication', 'an execution affordance'],
    visibleDistinctions: ['conversation', 'session', 'context window', 'memory', 'execution'],
  },
  environmentBlockers: [
    {
      gate: 'npm run lego:test',
      state: '436/439 pass, 3 fail',
      reason: 'the three failures are the node-catalog REST suites (GET /rest/types/nodes.json, GET /rest/types/node-versions.json, POST /rest/node-types): the 8 MB catalog is not committed, so they answer 404 until `npm run lego:catalog` or a network fetch. Pre-existing at e754c5df, environmental, not a code regression.',
    },
    {
      gate: 'python3 tools/sublego-audit/audit.py',
      state: 'blocked',
      reason: 'ModuleNotFoundError: No module named \'yaml\' in this sandbox — the audit cannot run here, so its result is reported as unmeasured rather than assumed passing.',
    },
    {
      gate: 'npm run verify:fast',
      state: '5/10 (G06-G10 fail)',
      reason: 'the workflow/Rust track\'s gates need packages/workflow-lego/node_modules and the live reference runtime, neither of which is installed here. The run also rewrites docs/isolation/*, another track\'s ownership area, so those two files are reverted after every run.',
    },
    {
      gate: 'node apps/n8n-lego/scripts/capture-frontend-evidence.mjs',
      state: '52/56 here, 55/56 dependency-complete',
      reason: 'three page-level checks need the stock UI dependency (absent in this sandbox); agent-2 measured 55/56 with it installed. The one failure in both runs is the real heap pin.',
    },
    {
      gate: 'descriptor assembly heap',
      state: 'FAIL, recorded not edited',
      reason: '4,444 KB against a 4,096 KB pin after the P2.13 vocabulary promotion (4,275 KB before it). XA-21 stays open; a gate is not edited to make a run green.',
    },
  ],
  gatesMeasuredGreen: [
    'npm run lego:arch — 26 domains, 15 locked public contracts, every backend import respects its declared boundary',
    'npm run lego:arch:selftest — 26/26',
    'npm run lego:foundation — 26 LEGOs, 12 node creation routes',
    'npm run lego:foundation:selftest — 15/15',
    'npm run lego:capabilities — 23 REST features vs 83 registered capabilities, owners and phases agree',
    'npm run lego:scaleout — every finding is a declared, owned exception',
    'npm run lego:ai:check — .ai in sync: 63 generated, 37 curated, 100 total',
    'npm run frontend-lego:test — 363/363 in both trees',
  ],
};
writeFileSync(`${repo}/docs/n8n-lego/evidence/frontend-context-session-p213.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ runs: evidence.runs, vocabulary: evidence.vocabulary, lockRows: [evidence.trees.protectedMain.contractLockRows, evidence.trees.peerPublication.contractLockRows] }, null, 1));
