# TASK-AGENT4-RUNTIME-01 — real-n8n 2.9.4 runtime layer restored for the agent-4 reference lanes

**Status: SUCCESS** — the 27 unit tests that were unconditionally skipped (`hasRuntime` false) now
execute against the **actual n8n@2.9.4 classes**: `N8N_RUNTIME=/tmp/n8n-runtime npm run
reference:agent4` → **45 pass / 0 fail / 5 skip** (the 5 remaining skips are the live layer, which
needs a RUNNING n8n server + `N8N_URL`; without the runtime env the script still runs the
golden-only layers: 23 pass / 27 skip / 0 fail). `verify:all` unaffected — **real exit 0** on this
tip; no fixture/golden file touched.

## What was blocking, and the recipe that fixed it

1. **`cdn.sheetjs.com` TLS-blocked** — the first full `n8n@2.9.4` install died fetching the `xlsx`
   tarball from the SheetJS CDN. Fix: the **same npm-registry override** `setup-reference-runtime.sh`
   already uses for the partial runtime (`overrides.xlsx = 0.18.5`). Install then completes:
   1969 packages, ~2 min.
2. **Native builds would need nodejs.org headers (blocked)** — fixed with `--ignore-scripts`; the
   gated unit layers drive pure-JS classes only (`ActiveWorkflows`, `TriggersAndPollers`,
   `ScheduledTaskManager`, `WebhookService`+`WebhookEntity`, `Cipher`, `Credentials`, `flatted` —
   per the lane README), so nothing native is exercised.

Reproduction (also appended, append-only, to `tests/reference/agent-4/README.md`):

```bash
mkdir -p /tmp/n8n-runtime && cd /tmp/n8n-runtime && npm init -y
npm pkg set overrides.xlsx=0.18.5
npm install --ignore-scripts --no-audit --no-fund n8n@2.9.4
cd /home/user/n8n-rust-v.4
N8N_RUNTIME=/tmp/n8n-runtime npm run reference:agent4
```

## What this closes

- The audit's "LIVE 11/11: NOT RUN → INCONCLUSIVE" composition is now **two-layered with the unit
  half green**: every per-lane unit suite (trigger/scheduler/validation/webhook/persistence/
  credentials/api) is proven against the real n8n 2.9.4 code on this branch (45/0), leaving only
  the server layer (5 live tests) blocked on native module builds for the DB/disk stack — the same
  blocker class the setup script documented, recorded in the ledger addendum.
- The reproducible invocation is wired as `npm run reference:agent4` (informational layer; NOT
  added to `verify:all` — peers own that chain and these lanes are reference material).

## Files

`tasks/TASK-AGENT4-RUNTIME-01.yaml` · `package.json` (+1 script) ·
`tests/reference/agent-4/README.md` (append-only operational note — not a golden change) ·
`docs/isolation/CROSS-AGENT-ISSUES.md` (addendum) · this file.
