# Dependency and impact maps

Small maps that answer "what touches what" without reading source. Generated from
the manifests; verified by `packages/frontend-lego/test/12-knowledge.test.mjs`.

## 1. LEGO → LEGO

```
apps/n8n-lego ──(1 call: createFrontendLego)──▶ packages/frontend-lego ──▶ contracts/frontend*.contract.md
        │                                                  ▲
        └── compatibility boundary (REST) ──▶ backend LEGOs ── their own public contracts
```

- The app imports the frontend LEGO through exactly one specifier. A test enforces it.
- The frontend LEGO imports nothing from the app, and nothing from the backend.
- Backend ↔ backend coupling is not a frontend concern; no local HTTP between LEGOs.

## 2. Surface → backend capability / contract

| Surface | Backend capability | Contract | Kind |
| ------- | ------------------ | -------- | ---- |
| `auth` | `auth` | `contracts/api.contract.md` | page |
| `navigation` | `settings` | `contracts/settings.contract.md` | region |
| `dashboard` | `workflow` | `contracts/workflow.contract.md` | page |
| `settings` | `settings` | `contracts/settings.contract.md` | page |
| `workflow-editor` | `workflow` | `contracts/workflow.contract.md` | page |
| `node-picker` | `node-registry` | `contracts/node.contract.md` | panel |
| `credentials` | `credentials` | `contracts/credentials.contract.md` | page |
| `executions` | `execution` | `contracts/execution.contract.md` | page |
| `webhooks` | `webhook` | `contracts/webhook.contract.md` | page |
| `notifications` | `push` | `contracts/realtime.contract.md` | region |
| `dialogs` | — | — | overlay |
| `error-surfaces` | `compatibility` | `contracts/api.contract.md` | region |

Every contract in the right-hand column is **foreign**: it belongs to the backend
domain that owns it. The frontend reaches it only through the compatibility
boundary, and a change that touches it escalates to the full test tier and needs the
owner's agreement.

## 3. Unit → unit (published ports only)

```
settings ──ui:settings:shell──◀ general
                            ◀ security
                            ◀ localization ──ui:locale:direction──◀ rtl
workflow-editor ──ui:editor:panel──◀ canvas  ──ui:canvas:selection──◀ execution-panel
                                   ◀ node-panel ──ui:panel:selection──◀ parameter-panel
                                   ◀ parameter-panel
                                   ◀ execution-panel
dialogs ──ui:dialog:component──◀ credentials
notifications ──ui:notification:enqueue──◀ error-surfaces
error-surfaces ──ui:error:strip──◀ executions
```

Read as: the parent publishes the port; the indented unit depends on it. A unit may
depend on a *sibling's* port (`parameter-panel → node-panel#ui:panel:selection`),
which is allowed because it is published. Depending on anything else — an internal
path, an unpublished port, an ancestor's private area — is refused by name.

## 4. Capability → surfaces

| Capability | State | Surfaces it renders into |
| ---------- | ----- | ------------------------ |
| `translation` | declared (not installed) | navigation, dashboard, settings, workflow-editor, node-picker, dialogs, notifications, error-surfaces |

No capability is installed, so no capability is loaded, and the boot payload carries
an empty capability list. This is the load-bearing example of the state model.

## 5. "If this changes, what must be tested?"

Ask the graph rather than guessing:

```bash
node -e "import('./packages/frontend-lego/index.mjs').then(m=>{
  const l=m.createFrontendLego({app:{name:'n8n-lego',version:'0.1.0'}});
  console.log(JSON.stringify(l.impactOf('settings.localization').recommendedTests,null,1));})"
```

| Change | Risk | Because |
| ------ | ---- | ------- |
| `node-picker` (root, nobody depends on it, own contract) | low | blast radius is the unit itself |
| `settings.general` (nested, nobody depends on it) | medium | its parent's surface must still assemble |
| `workflow-editor.canvas` | high | `execution-panel` depends on `ui:canvas:selection` |
| any surface | high | its backend contract belongs to another LEGO |
| `settings.localization.rtl` | high | it declares the foreign localization contract |
| a new unit | low risk, **but** arbitration | risk is blast radius, consent is separate |

## 6. Legacy decomposition → current units

`contracts/micro-frontend.contract.md` (LEGO 13, superseded) proposed Web Components.
The decomposition survived the change of implementation; the mechanism did not.

| Legacy module | Current unit(s) |
| ------------- | --------------- |
| `<n8n-canvas>` | `workflow-editor.canvas` |
| `<n8n-node-settings>` | `workflow-editor.node-panel`, `workflow-editor.parameter-panel` |
| `<n8n-expression-editor>` | inside `workflow-editor.parameter-panel` (no separate unit: no independent contract) |
| `<n8n-i18n-provider>` | `settings.localization` (+ `settings.localization.rtl`) |
| `<n8n-app-shell>` | `navigation`, `dashboard`, `dialogs` |
