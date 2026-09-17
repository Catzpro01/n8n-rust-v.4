# Webhook LEGO (`@lego/webhook`)

HTTP edge for `/webhook/*`, `/form/*`, `/webhook-test/*` and waiting routes —
method guard, CORS preflight, route matching (exact-first, longest-dynamic),
and response-mode resolution.

- Reference: n8n `2.9.4` (`b6dc2787`), `packages/cli/src/webhooks/*`,
  `packages/cli/src/errors/response-errors/webhook-not-found.error.ts`,
  `packages/workflow/src/errors/webhook-taken.error.ts`
- Contract: `contracts/webhook.contract.md` · Isolation: `docs/isolation/webhook.md`
- Invariants: **W1–W10** (`src/model-surface.ts`, `WEBHOOK_PROVENANCE`)
- Engine twin: `packages/reconstructed-engine/src/webhook-engine.ts`
- Tests: `npm test` → `test/01-boundary.test.mjs` (6/6, zero deps, offline)

Status: **VERIFIED** (Phase 4-13). Zero Rust, UI untouched.
