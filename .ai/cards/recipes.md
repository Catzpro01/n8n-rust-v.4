# L3 — Task recipes

One recipe per task shape. Each is complete on its own: files, steps, commands,
and the test set that proves it. Load the recipe, not the whole pack.

---

## R1 — Add a sub-LEGO unit

**When:** a UI area gains an independently meaningful contract, ownership or
upgrade path. Not for a component, button, icon or helper — those stay internal.

1. Decide the id: `parent.child` (bounded at domain → feature → sub-feature).
   The parent comes from the id; never declare a different `parentId`.
2. Add the entry to `packages/frontend-lego/manifest/sub-legos.json`: `owner`,
   `surface`, `version`, `status`, `public.ports`, `internals`, `tests`,
   `dependsOn`, `upgrade`.
3. Publish ports for exactly what another unit may depend on. A port may not
   collide with a hook id or another unit's port.
4. Declare dependencies as `{ subLego, port, versionRange }` against **published**
   ports only.
5. Update `.ai/index/units.json` (the drift test fails until you do).
6. Verify:

```bash
node --test packages/frontend-lego/test/06-sublegos.test.mjs
node --test packages/frontend-lego/test/12-knowledge.test.mjs
```

Adding a unit is a shared-hierarchy change: the plan model marks it
`requiresArbitration: true` (Manager).

---

## R2 — Change or add an extension hook

**When:** a future capability needs a new attachment point on a surface.

1. Add the hook to `packages/frontend-lego/manifest/extension-points.json`:
   `id` matches `^ui:[a-z-]+:[a-z-]+$` (no digits), plus `surface`, `purpose`,
   `additive`, `mutates`, `requiresCapability`, `consumers`, `status`.
2. A hook that mutates another surface's attributes is `attributes-only` and must
   carry a non-empty `attributeWhitelist` plus at least three `never` entries.
3. Reference it from the surface's `extensionPoints` in `surfaces.json`, and from
   `.ai/index/contracts.json` if a contract governs it.
4. Bump `extensionPoints.version` (additive → minor).
5. Verify:

```bash
npm run frontend-lego:test
node apps/n8n-lego/scripts/capture-frontend-evidence.mjs
```

---

## R3 — Change a frontend contract

**When:** behaviour between the frontend and its consumers changes.

1. Ask the impact graph first:

```bash
node -e "import('./packages/frontend-lego/index.mjs').then(m=>{
  const l=m.createFrontendLego({app:{name:'n8n-lego',version:'0.1.0'}});
  console.log(JSON.stringify(l.planChange({target:'settings',kind:'surface'}),null,1));})"
```

2. Own contract (`frontend.contract.md`, `frontend-sub-lego.contract.md`) → change
   it, bump the version, update the contract index.
3. Foreign contract → **coordinate** with its owner (agent-02 for backend domains).
   Never restate their vocabulary; the index says who consumes what.
4. Additive only unless the change is explicitly negotiated; a breaking change is
   refused by the upgrade rules until dependents acknowledge it.
5. Verify the tier the plan recommends — at minimum:

```bash
node --test packages/frontend-lego/test/*.test.mjs
node --test apps/n8n-lego/test/*.test.mjs
```

---

## R4 — Upgrade a unit version (the atomic path)

**When:** one unit moves forward without touching its siblings.

```bash
node -e "import('./packages/frontend-lego/index.mjs').then(m=>{
  const l=m.createFrontendLego({app:{name:'n8n-lego',version:'0.1.0'}});
  console.log(JSON.stringify(l.subLegos.upgrade('settings.general',{version:'1.0.1'}),null,1));})"
```

- A minor/patch move leaves every sibling byte-identical.
- A major move is refused while a dependent pins the previous major. Only a named
  acknowledgement moves it, and only the unit plus its dependents change.
- Downgrades and coupled declarations are refused.
- A refused upgrade leaves the catalog exactly as it was (no half-applied state).

Prove it with `node --test packages/frontend-lego/test/06-sublegos.test.mjs`
(the upgrade tests assert byte-identity of untouched units).

---

## R5 — Run the selective test set for a change

```bash
node -e "import('./packages/frontend-lego/index.mjs').then(m=>{
  const l=m.createFrontendLego({app:{name:'n8n-lego',version:'0.1.0'}});
  console.log(JSON.stringify(l.impactOf(process.argv[1]).recommendedTests,null,1));})" settings.localization.rtl
```

| Tier | Run | Escalates when |
| ---- | --- | -------------- |
| fast-contract | `node --test packages/frontend-lego/test/01-contract.test.mjs` + the unit's own tests | always |
| boundary | `test/05-boundary`, `test/06-sublegos`, app boundary test | a nested unit or a surface is touched |
| browser | `tests/e2e/frontend-boundary.mjs` (CI, needs Chromium) | the change reaches what the browser receives |
| integration | app suites + `tests/e2e/lego-smoke.mjs` | a dependent or a foreign contract is affected |
| full | `npm run frontend-lego:test`, `npm run verify:fast`, `tools/sublego-audit/audit.py`, `scripts/release.sh --no-docker` | risk is high |

Do not run the full tier "to be safe": if the graph says a private change, the
private set is the correct answer.

---

## R6 — Hand work to another agent or the Manager

1. Produce the plan: `planChange({ target, kind, description })`.
2. Attach the evidence: the command and its result, never an intention.
3. If a contract is involved, name its owner from `.ai/index/contracts.json`.
4. If the plan says `requiresArbitration`, stop and route it — do not implement
   around an unresolved shared contract.
5. State what was deliberately **not** done (the hard stops) so the reader does not
   assume coverage.
