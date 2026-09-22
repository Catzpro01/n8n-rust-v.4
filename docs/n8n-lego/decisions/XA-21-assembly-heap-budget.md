# XA-21 — the descriptor assembly heap budget is exhausted by surface growth

**Status:** `open-for-manager` · **Blocking level:** low for P2.13 (one check of 56), phase level for P2.14+
**Register row:** `docs/n8n-lego/decisions/cross-agent-decisions.json#decisions[id=XA-21]`
**Affected domains:** `frontend`, `editor-ui-host`
**Measured against:** `main @ e754c5df` (P2.12) and `arena/01a0c6b4-n8n-rust-v-4` (P2.13 frontend),
2026-09-22. Every number below was measured in this sandbox; §5 shows the commands.

---

## 1. The check

`apps/n8n-lego/scripts/capture-frontend-evidence.mjs` spawns a fresh Node process that imports
`packages/frontend-lego/index.mjs` and calls `createFrontendLego({ app })`, then asserts:

```js
check('the LEGO cold-imports and assembles within a small budget', cost.ms < 250, …);   // line 203
check('assembling the descriptor stays inside a small memory budget', cost.kb < 4096, …); // line 204
```

`cost.kb` is `process.memoryUsage().heapUsed` delta over import **plus** assembly, with no forced
GC — so it carries run-to-run noise of roughly ±70 KB.

## 2. The measurements

| Tree | `cost.kb` | verdict | notes |
|---|---|---|---|
| `main @ e754c5df` (P2.12, recorded evidence) | **3,780** | PASS | 316 KB of headroom; `frontend-boundary-p25.json`, 56/56 |
| `main @ e754c5df` (re-measured here, fresh probe) | 3,684 | PASS | same tree, no GC: the noise floor |
| this branch, view built eagerly at assembly | 4,361 / 4,316 | **FAIL** | two runs |
| this branch, view built on demand (current code) | 4,251 / 4,275 | **FAIL** | ~110 KB recovered; 4,275 KB is the number in the final capture (`frontend-boundary-p213-run.json`) |

Retained cost per module, measured with `--expose-gc` in one process, current tree against a
`git archive HEAD` copy of `packages/frontend-lego`:

| Module | HEAD | now | delta |
|---|---|---|---|
| `vocabulary.mjs` | 632 KB | 720 KB | **+88 KB** — ten new quoted sets, each with provenance and a publication-pending record |
| `context-session.mjs` | — | 243 KB | **+243 KB** — new (85,930 B of source; for scale, `skills.mjs` is 40,426 B) |
| `manifests.mjs` | 199 KB | 214 KB | +15 KB — one more manifest parsed eagerly |
| `conformance.mjs` | 1,018 KB | 1,005 KB | −13 KB (noise) |
| `lego.mjs` | 161 KB | 174 KB | +13 KB |
| **retained total** | | | **≈ +359 KB** |

What did **not** change: the boot payload is byte-identical at **18,126 B** (the P2.5 pin), the
assembly time is **49.7 ms** of a 250 ms budget, and the browser receives the descriptor and nothing
else — the Context & Session view is not in it.

## 3. What the number actually measures

The pin bounds the **whole LEGO package at import**, not the descriptor. It is therefore a budget on
the sum of every surface the frontend declares: vocabulary lock, seam, negotiation, agents, agent
events, skills, and now context & session. Read that way the check is doing its job — it says the
package has grown to where the *next* surface needs a decision, not that P2.13 shipped something
heavy to the browser.

Two structural facts make the growth expensive:

1. **V8 retains a module's source text.** `context-session.mjs` is 85,930 B, and because it contains
   typographic characters (em dashes, `≠`, `→`, curly quotes) the retained string is stored two bytes
   per character: ~170 KB of the 243 KB is the file's own text, documentation included.
2. **Surface prose lives in the module.** Refusal reasons, affordance details and lifecycle
   explanations are string tables in `src/`. The Skill surface puts its equivalent prose in
   `manifest/skills.json` — a manifest that is parsed when the surface is used.

## 4. Options

**A — raise the pin.** Set a stated budget (5,120 KB would carry P2.13 and leave ~600 KB) with the
measurement that justifies it. *Cost:* the pin stops being a forcing function; whoever raises it must
say what the new ceiling protects. *Note:* the pin was set at P2.8-F, before any AI surface existed.

**B — surfaces become opt-in imports.** `createFrontendLego()` stops importing feature surfaces; the
application imports `context-session` / `skills` where it renders them. *Cost:* a public-API and
contract change (`contracts/frontend.contract.md` §19.18–§19.19 both describe the assembly), and it
must be ruled before P2.14 rather than during it. *Benefit:* the boot path pays only for what the
instance renders, which is the same principle as lazy capability activation.

**C — surface prose moves into the manifests, parsed on demand.** `manifest/context-session.json`
carries the refusal reasons, affordance details and lifecycle explanations; `src/context-session.mjs`
keeps logic plus the quoted word lists, and `loadManifests()` parses that one file lazily. *Cost:*
~100 KB off the import path — real, but not enough on its own (4,251 → ~4,150). *Benefit:* it matches
the Skill pattern already in the tree, and it makes the prose declarative data a test can diff.

**D — accept the red check for P2.13** and record it (this row, B-14, the milestone's
`knownLimitations`). *Cost:* an evidence capture that reports 52/56 until someone rules.

**Recommendation (agent-1):** **C then A.** C is the design the Skill manifest already follows and
costs no API change; A is unavoidable by P2.14 whichever way C lands, because Memory is a third AI
surface on the same import path. B is the right long-term answer if the manager wants the boot path
to stay flat, but it is a contract change and should not be decided mid-milestone by an agent.

**Not done by agent-1:** editing the pin. It is a gate in the application's evidence script, and
editing a gate to make a run green is what the merge protocol forbids. The check is reported FAIL
with its measurement instead.

## 5. How to re-measure

```bash
# the failing check, with its number
node apps/n8n-lego/scripts/capture-frontend-evidence.mjs 2>&1 | grep -E "memory budget|cold-imports"

# the same probe on a pristine copy of the baseline tree
rm -rf /tmp/base && mkdir -p /tmp/base && git archive e754c5df packages/frontend-lego | tar -x -C /tmp/base
node --input-type=module -e '
const b=process.memoryUsage().heapUsed;
const m=await import("/tmp/base/packages/frontend-lego/index.mjs");
m.createFrontendLego({app:{name:"n8n-lego",version:"0.1.0"}});
console.log("base KB:",Math.round((process.memoryUsage().heapUsed-b)/1024));'

# retained cost per module, with GC, on either tree
node --expose-gc -e '
const root=process.argv[1];let last=process.memoryUsage().heapUsed;global.gc();
for(const f of ["vocabulary.mjs","skills.mjs","context-session.mjs","manifests.mjs","conformance.mjs","lego.mjs"]){
  await import(`${root}/packages/frontend-lego/src/${f}`).catch(()=>{});
  global.gc();const now=process.memoryUsage().heapUsed;
  console.log(f.padEnd(22),"+"+Math.round((now-last)/1024),"KB");last=now;}' /home/user/n8n-rust-v.4

wc -c packages/frontend-lego/src/context-session.mjs packages/frontend-lego/src/skills.mjs
```

## 6. Relation to the other failures in the same capture

The P2.13 run reports **52/56**. Three of the four failures are environmental and pre-existing in
this sandbox: `node_modules` is empty, so `apps/n8n-lego/node_modules/n8n-editor-ui/dist` does not
exist, the app serves no stock `index.html`, and the three page-level checks (boot meta tag present,
meta tag byte-equal to the endpoint, stock UI still templated) cannot run. They passed at
`e754c5df` in an environment with the bundle installed. That is **B-10**, not a regression, and it is
reported as skipped-for-environment rather than as passed. The fourth failure is this row.

## 7. Status

**Open — awaiting the manager's ruling.** `resolution` stays `null`. Recorded as **B-14** in
`.ai/master/frontend/KNOWN_BLOCKERS.md`, listed in `docs/n8n-lego/milestones.json#dependencyBlockers`
and in the P2.13 row's `knownLimitations`, and reported in the P2.13 final report with its
measurement. Nothing in this row changes a contract, a vocabulary or the boot payload.
