# P5-M09 — Public `/api/v1` credentials and users

Split out of P5-M08. Source of the scope: the P5.7 technical-debt list,
`docs/n8n-lego/evidence/P5.8-CERTIFICATION-EVIDENCE.md` §7 — "no `/api/v1`
mount" and "no REST/UI … for service principals" — plus the P5-M09 register
entry, which names the operations explicitly.

Upstream truth: `reference/n8n/packages/cli/src/public-api/v1` (n8n 2.9.4) —
`credentials.handler.ts`, `credentials.middleware.ts`, `credentials.service.ts`
(`sanitizeCredentials`, `toJsonSchema`) and `users.handler.ee.ts` /
`users.service.ee.ts` (`clean`, `pickUserSelectableProperties`), together with
the pinned specs under `.../spec/paths/` and `.../spec/schemas/`.

## 1. What this slice mounts

| Method | Path | Scope (upstream guard) |
| --- | --- | --- |
| GET | `/api/v1/credentials` | `credential:list` |
| POST | `/api/v1/credentials` | `credential:create` |
| PATCH | `/api/v1/credentials/{id}` | `credential:update` |
| DELETE | `/api/v1/credentials/{id}` | `credential:delete` |
| GET | `/api/v1/credentials/schema/{credentialTypeName}` | authenticated, no scope |
| GET | `/api/v1/users` | `user:list` |
| POST | `/api/v1/users` | `user:create` |
| GET | `/api/v1/users/{id}` | `user:read` |
| DELETE | `/api/v1/users/{id}` | `user:delete` |
| PATCH | `/api/v1/users/{id}/role` | `user:changeRole` |

Not mounted, and why:

- **`PUT /credentials/{id}`** — upstream updates a credential with **PATCH**
  (`credentials.id.yml`). `PUT` is therefore 405, not a silent alias.
- **`GET /credentials/{id}`** — upstream mounts no such operation; it is 405.
- **`/credentials/{id}/transfer`** — needs a project model (P5-M10).
- **`/api/v1/docs`** — DEC-0022: the surface serves its OpenAPI document at
  `/openapi.yml`, not a Swagger UI. `/docs` answers 404 `not found`.
- **`/projects`, `/audit`, `/source-control`, `/data-tables`** — no backing
  model (P5-M10).

### 1.1 Credentials: the secret never leaves the server

Every credential response is built by the same whitelist upstream calls
`sanitizeCredentials`: `id`, `name`, `type`, `createdAt`, `updatedAt`,
`isResolvable`. `data` and `shared` are not in it, so **no response on this
surface can carry a secret** — not create, not update, not delete, not list.
The write path goes through the P5.5 vault (`sealData`), so the stored record
carries `config` (non-secret, in the clear), `secretKeys` (the sealed field
NAMES as schema) and a sealed `secret` envelope bound to the credential id.

An update merges with the blank sentinel (`__n8n_BLANK_VALUE_…`) treated as
"unchanged", so echoing a redacted view back cannot overwrite a stored secret
with the literal sentinel string, and bumps `credentialVersion`, which
invalidates any SecretRef minted against the previous contents.

Data is validated against the credential type before it is stored: the type's
properties become a JSON Schema (`credentialTypeJsonSchema`, a port of
upstream `toJsonSchema`), with `options` properties resolved to string enums,
`hidden` properties dropped, and `displayOptions` dependencies expressed as
`if`/`then`/`else`. An unknown type is refused at the type boundary rather than
stored unvalidated.

### 1.2 Users: the whitelist is the protection

`userDto` is a port of upstream `clean` / `pickUserSelectableProperties`: `id`,
`email`, `firstName`, `lastName`, `createdAt`, `updatedAt`, `isPending`, plus
`role` only when `includeRole` is asked for. The password hash, the sealed MFA
secret, the recovery-code digests, the API keys and `settings` are not in that
list, so a new stored field cannot start leaking by accident.

An invited user is created `isPending` with **no password hash at all** — the
account cannot sign in until it is accepted, so there is nothing to mint.

Two invariants are enforced rather than assumed:

- an instance has exactly one owner, so nobody may be promoted into
  `global:owner` and the owner may not be demoted out of it (403);
- the owner account cannot be deleted through the API (403), because it is the
  account that mints API keys.

## 2. Two real bugs found while wiring this up

1. **`tools/lego/progress-event.mjs` stamped `updatedAt` after validating the
   register.** The rule "a slice with checkpoints must record updatedAt" is
   satisfied by the very event that installs the model, so validating first
   rejected the first checkpoint any slice ever records. `updatedAt` is now
   stamped before validation.
2. **`canonical()` compared the written register with `JSON.stringify`.** The
   surgical writer emits the managed keys (`checkpoints`, `updatedAt`,
   `latestUpdate`) immediately after `status`, while the in-memory clone
   carries them wherever they were added, so a plain stringify rejected a
   register whose content was identical. `canonical()` is now a key-order-
   insensitive structural form (array order still matters).
3. **`findUser` decided id-vs-email with a UUID test.** Upstream's ids are
   UUIDs; this product mints 16-hex ids (`createOwner`), so every id lookup
   fell through to an email lookup and 404'd. It now resolves by id first,
   which is the same rule without the shape assumption.

## 3. Tests

**New file:** `apps/n8n-lego/test/public-api-v1-credentials-users.test.mjs`,
34 tests, end to end through `startServer` with keys minted through the editor
flow. Covers the mounting table, the schema route (public document, per-type
JSON schema, `if`/`then`/`else` conditions, unknown type 404), create (never
echoes the submitted secret, validates the data, sealed at rest), list
(offset pagination, filters, no `data`), update (rename, version bump, sentinel
merge, type change with and without data), delete, the two visibility
boundaries (role grant, then ownership), the users whitelist, invite
(per-row envelope, duplicate reported, no password minted), delete, the role
change and the owner invariant, scope guards on every operation, and `/docs`
staying a 404.

The existing `public-api-v1.test.mjs` and `public-api-v1-resources.test.mjs`
were extended for the new operation count (31) and the `/docs`-unmounted
assertion; `apps/n8n-lego/data/public-api-openapi.json` was regenerated from
the pinned upstream spec by `apps/n8n-lego/scripts/extract-public-api-spec.py`
(31 operations on 17 paths).

## 4. Gates

| Gate | Result |
| --- | --- |
| `node --test apps/n8n-lego/test/*.test.mjs` | 2550 / 2553 pass (see §6 for the three environmental failures) |
| `npm run lego:gate` | pass |
| `node --test apps/n8n-lego/test/governance-register.test.mjs` | 74 / 74 pass |
| `node --test apps/n8n-lego/test/live-progress.test.mjs` | 25 / 25 pass |
| `node --test tools/workforce/test/*.test.mjs` | 7 / 7 pass |
| `node tools/workforce/src/cli.mjs decisions-check` | ok, no problems |
| `npm run lego:ai:check` | in sync |

## 5. What the delivery gate required

DEC-0015 requires every required check to have actually run on the PR head, on
a real runner, before the merge. PR #314 carried ten checks and all ten were
green on its head `b869574057f6b5f1dd6de4e6aaad25d5e0848d1c`:

| Job | Run | Runner | Result |
| --- | --- | --- | --- |
| Level 0 (Check & Format) | 36177715899 | `MDMTEST-n8n-wsl` | SUCCESS |
| Level 1 (Affected Tests) | 36177715899 | `MDMTEST-n8n-wsl-2` | SUCCESS |
| Level 2 Workspace Tests (linux) | 36177715909 | `MDMTEST-n8n-wsl-3` | SUCCESS |
| Level 2 Workspace Tests (windows) | 36177715909 | `laptop-build-worker-5` | SUCCESS |
| Level 2 Conformance LEGO & Node Catalog | 36177715909 | `MDMTEST-n8n-wsl-5` | SUCCESS |
| Backend LEGO architecture gate (P2.6) | 36177715914 | `GitHub Actions 1000003458` | SUCCESS |
| Unit + integration tests and release package | 36177715914 | `GitHub Actions 1000003457` | SUCCESS |
| Clean clone → start → health → browser smoke → restart | 36177715914 | `GitHub Actions 1000003459` | SUCCESS |
| Windows worker portability probe | 36177715914 | `laptop-build-worker` | SUCCESS |
| Post-Merge Verification & Branch Cleanup | 36178000339 | `MDMTEST-n8n-wsl` | SUCCESS |

DEC-0015 verdict: **ALL_GREEN** — self-hosted 5 pass / 0 fail / 0 waiting,
GitHub-hosted 5 pass.

## 6. Delivery record

| Field | Value |
| --- | --- |
| Delivery PR | [#314](https://github.com/Catzpro01/n8n-rust-v.4/pull/314) |
| PR head | `b869574057f6b5f1dd6de4e6aaad25d5e0848d1c` |
| Merge commit | `c13ba6dc7bcbb81efb1ccb9786942065ab5f3c26` |
| Merged | 2026-09-25T19:10:01Z |
| Changed files | 15 (+2347 / -192) |
| Checkpoints | CP-01..CP-05, all `completed` |

The checkpoint state was published as live telemetry (`governance(progress):`
commits `3493fc9c`, `b5ca62a7`, `778e9d23`, `0b5a0de1`, `9d514dbc`), one
measurable event per commit, straight to `main` as DEC-0021 allows. The
transition to `implemented`, the merge SHA and the `executionPointer` advance
are delivery state and were reconciled by the governance PR that closes this
section, never by telemetry.

Three `rest.test.mjs` cases fail in a fresh clone and are not attributable to
this slice: `GET /rest/types/nodes.json`,
`GET /rest/types/node-versions.json` and `POST /rest/node-types` all 404. They
fail identically on `602b23fc`, the commit before P5-M09 landed, and they need
the built reference runtime (`npm run setup:reference`) that this checkout does
not carry. Recorded as environmental, not relabelled as a regression.

One real tool bug was found while reconciling this slice: the Issue #307
governance test pinned `realtime = 86.1` for the reopened-CP-05 scenario, a
number that encoded "P5-M09 contributes 0". Once P5-M09's five checkpoints
completed that stopped being true, and the test failed on correct behaviour. It
now derives the expectation from CP-05's actual weight instead of pinning a
literal, so it cannot go stale again.
