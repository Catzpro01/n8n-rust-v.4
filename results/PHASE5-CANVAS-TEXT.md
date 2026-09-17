# PHASE5-CANVAS-TEXT — R4-03 adopted hub-natively + trigger spec adjudicated

Agent: agent-3 (Arena session `arena/01a0b104-n8n-rust-v-4`) · 2026-09-18.
Scope: (1) adopt SWARM-ROUND4-03 `workflow-canvas-text-translator` without copying its file;
(2) adjudicate the two trigger spec/port disagreements from §7.4 against the reference and align
the spec side. ROUND4-04 (enterprise bypass) was NOT touched — excluded, license risk.

## 1. R4-03 hub-native adoption

**Artifact assessed** (`agent-3@07da615a`, 503 bytes, zero tests, zero gate runs): raw
id/jv/ar/zh/ru dictionaries keyed by the STRAIGHT-quote form `When clicking 'Execute workflow'`.
Three defects ruled out a verbatim copy:

- the reference-exact default name is the CURLY form (`ManualTrigger.node.ts:20`
  `defaults: { name: 'When clicking ‘Execute workflow’' }`) — a straight-quote lookup misses it;
- two of its four phrases (`Execute workflow`, `Test step`) are ALREADY hub-owned
  (`execute.workflow`, `test.step` in all six locales);
- it mixed quote styles between its own keys (straight for Execute, curly for Test step).

**Adopted instead** (hub owns the strings, new module only matches):

- `packages/workflow-lego/src/backend-localization-service.ts`: +2 keys × 6 locales
  (`canvas.node.subtitle.manual`, `canvas.node.subtitle.testStep`; R4-03 non-English values
  verbatim, English = straight-quote canonical). Dictionaries 27 → 29 keys, parity intact.
- `packages/workflow-lego/src/canvas-text-translator.ts` (new, 70 lines, imports nothing,
  erasable TS): quote-normalizing matcher (curly/straight/double/backtick/none + whitespace)
  → hub key; `translateCanvasSubtitle(text, locale, translate)` with UNKNOWN-TEXT PASSTHROUGH.
  Case is NOT folded; workflow names (`When clicking 'Test workflow'`) pass through unchanged.
- `packages/workflow-lego/test/07-canvas-text.test.mjs` (new, 6 tests): all quote variants,
  R4-03 value table verbatim × 6 locales × 2 keys, fallback (`xx` → `en`, `in` → `id`,
  `jw` → `jv`), passthrough (names, short chrome, case variants, empty).
- `packages/workflow-lego/test/06-localization.test.mjs`: pins 27 → 29 (2 assertions + comments).
- `docs/isolation/localization.md`: new §4.3; fixed stale "11-gate" → 12-gate.

## 2. Trigger spec adjudication (closes §7.4 as "resolved")

Both disagreements were re-read directly against `core/src/execution-engine/active-workflows.ts`:

- **D1 duplicate activation**: reference `add` (lines 70-110) has NO duplicate guard — a second
  call re-runs triggers and OVERWRITES `activeWorkflows[id]`. The string
  `Workflow is already active` exists NOWHERE in `n8n-core`/`n8n-workflow` (grep-verified).
  The spec registry's throw was removed; `contracts/trigger.contract.md` §4 corrected (it had
  invented the string); `tasks/PHASE5-TRIGGER-PORT.yaml` count fixed 13/13 → 18/18.
- **D2 `TriggerCloseError`**: reference `closeTrigger` (lines 220-226) REPORTS via
  `logger.error` + `errorReporter.error(e, { extra: { workflowId } })`; only other close errors
  become `WorkflowDeactivationError` with the byte-exact envelope
  `Failed to deactivate trigger of workflow ID "X": "…"` (lines 231-234). Spec side aligned:
  `reportedCloseErrors[]` report hook, `closeTriggerOutcome` → `trigger-close-reported`, new
  `buildDeactivationError()` (manifest `publicSurface` updated; the trigger gate does not
  check the LEGO manifest surface, verified).
- `packages/trigger-lego/src/model-surface.ts`: `NO_TRIGGER_NODE_MESSAGE` comment sharpened
  (validation-layer guard, `workflow-validation.ts:57`, not a registry guard).
- `packages/trigger-lego/test/01-boundary.test.mjs`: 6 → 7 tests (adjudication test: re-add
  overwrites + deactivation envelope byte-exact); combined trigger suite **18/18**.
- `docs/isolation/trigger.md` §7.4 rewritten as adjudicated/resolved with line anchors.

## 3. Verification (2026-09-18, `.runtime` n8n 2.9.1)

- `node --test packages/trigger-lego/test/*.test.mjs` → **18/18**
- `bash scripts/run-lego-tests.sh` → **51/51** (06 + new 07 included)
- `npm run trigger:check` → 6/6 (78 calls) · `connection:check` → 9/9 (1944 calls) ·
  `i18n:check` → 5/5 · `npm run verify` → **12/12** (G08 51/51, G09 NONE, G11 live 7/7,
  G06/G07/G12 strict tsc 0 errors)
- Standalone `tsc --strict --noEmit` on the touched/new TS files → 0 errors

Note: `node --test` on the workflow suite WITHOUT the runner script fails 7 equivalence tests
with `LEGO_REFERENCE_PKG must point at…` — pre-existing runner requirement, not a regression.
