# P5-M07 — Service-principal REST + UI management (evidence)

Slice `P5-M07` (program P5, maintenance; issue #85; debt source:
`docs/n8n-lego/evidence/P5.8-CERTIFICATION-EVIDENCE.md` §7).

Source of the scope: the P5.7 technical-debt list, `P5.8-CERTIFICATION-EVIDENCE.md` §7 —
"**no REST/UI and no ownership transfer for service principals**" and "**members (not only
admins) may create service principals within their own grant**" — plus the P5-M07 register
entry, which names the lifecycle explicitly: *create shown once, redacted list, revoke with
tombstone*.

The lifecycle itself is P5.7 work (`machine-identity.mjs`, `createServicePrincipalRecord`,
`revokeWithTombstone`) and is contract-locked as HTTP-free and storage-free with
`src/auth/api-key-routes.mjs` named as its boundary. This slice mounts that boundary.

## 1. What this slice mounts

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/rest/service-principals` | redacted list of the caller's live principals |
| GET | `/rest/service-principals/scopes` | the scope vocabulary the caller may attenuate to |
| POST | `/rest/service-principals` | create — record **plus the raw credential, exactly once** |
| PATCH | `/rest/service-principals/:id` | ownership transfer — record **plus a rotated credential, exactly once** |
| DELETE | `/rest/service-principals/:id` | revoke — tombstone, `{ success: boolean }` |

Upstream truth: **pinned n8n 2.9.4 has no service-principal REST surface at all** —
`grep -r service-principal reference/n8n/packages/cli/src` is empty. The wire shape therefore
follows this product's own editor idiom, `/rest/api-keys`
(`reference/n8n/packages/cli/src/controllers/api-keys.controller.ts`): `sendData` envelopes,
`{ success: true }` on item writes, a silent no-op for an id the caller does not own, and the
same label/scope/expiry validation messages. The lifecycle semantics come from
`machine-identity.mjs`, which is the contract-declared boundary.

### 1.1 Create: the credential exists on exactly one response

`POST` is the only route that mints, and `rawApiKey` appears on its response and nowhere
else. `servicePrincipalDto` is a whitelist — `id, kind, label, ownerId, tenantId, scopes,
credential, createdAt, expiresAt, lastUsedAt` — where `credential` is
`redactApiKey(hint)`, i.e. six asterisks and the 4-character hint. The store keeps a
SHA-256 `digest` and the `hint`, never the raw value. A field the DTO does not know about
cannot leak, which the test proves by adding `internalNote` to a stored record and asserting
it is absent from the response.

### 1.2 Revoke: tombstone, not delete

`revokeWithTombstone` (P5-M01) marks the record `revokedAt` and keeps it, so the credential
is later reported **REVOKED** rather than **UNKNOWN** and the audit row survives. An unknown
or already revoked id is a silent no-op — the response never confirms that an id exists.

### 1.3 Transfer: the authority moves, the credential rotates

The P5.7 debt item "no ownership transfer for service principals" is closed here. Six
invariants, each asserted in the route rather than left to the caller:

1. the authority **moves**: the record leaves the sender's list and joins the receiver's, so
   deleting either owner deletes exactly the credentials that owner is accountable for;
2. the **tenant does not**: a principal is bound to the tenant it was minted in and its
   scopes are only meaningful against that tenant's registry, so a cross-tenant transfer is
   refused rather than re-homed;
3. the **receiver must be able to hold what the principal already carries**: every scope is
   re-attenuated against the new owner's current grant, so a transfer to a less privileged
   owner narrows the principal instead of leaving it with authority its new owner could not
   have granted;
4. a **revoked** principal cannot be transferred — a tombstone is not an asset;
5. the **credential rotates**, and the record leaves the sender outright;
6. **both sides are audited**.

**Why (5) is not cosmetic.** `generateApiKey` bakes the owner id into the key
(`n8n_api_<ownerId>.<keyId>.<secret>`) so a presented credential resolves in O(1) with no
process-local index. A carried-over record would therefore stop resolving the moment it
moved, and the principal would silently become UNKNOWN. Rotating also means the previous
owner — who necessarily knew the raw value — cannot keep using it, which is the only safe
reading of "transfer". The record is **removed** from the sender rather than tombstoned
because it was moved, not revoked: a tombstone would leave the sender holding a revoked
principal they no longer own, and would answer 400 where this surface's own idiom is a
silent no-op. The old credential stops resolving on its own, because it carries the previous
owner id.

### 1.4 The member boundary (DEC-0023)

The guard inherited from `/rest/api-keys` is `apiKey:manage`. **That guard does not close the
debt item**, because `apiKey:manage` is not an admin-only scope in this product: the
extracted `apps/n8n-lego/data/roles.json` is a faithful port of pinned n8n 2.9.4, and
`reference/n8n/packages/@n8n/permissions/src/roles/scopes/global-scopes.ee.ts` lists
`'apiKey:manage'` inside `GLOBAL_MEMBER_SCOPES` (25 scopes) as well as
`GLOBAL_OWNER_SCOPES` and `GLOBAL_ADMIN_SCOPES` (121 each). Under the inherited guard a
`global:member` could mint a service principal over HTTP.

There is no upstream truth to copy — upstream has no service-principal surface — so this is
recorded as **DEC-0023**: service principals are admin/owner authority, and a member may
still manage their own personal API keys. The asymmetry is deliberate: a personal API key is
the member's own credential, bounded to what their role allows and revocable by them; a
service principal is a separate identity whose accountability is transferred, delegated and
audited. `requireServicePrincipalAuthority` enforces it, and every service-principal
operation answers the upstream `MISSING_SCOPE_MESSAGE` 403 for a member.

## 2. Tests

`apps/n8n-lego/test/service-principal-routes.test.mjs`: 32 tests, end to end through
`startServer` with a real session, CSRF and cookie jar, because the property under test
lives at the HTTP boundary.

| area | what is asserted |
| --- | --- |
| mounting | the two read shapes answer, an unknown sub-path is the explicit 501 capability answer, a service principal is not reachable through `/rest/api-keys` and an api key is not a service principal |
| shown once | `rawApiKey` is on the create response and in no other body; the store holds a digest and a 4-character hint and never the raw value |
| create policy | unknown kind is 400 naming the vocabulary; a scope outside the universe is 403 and stores nothing; an empty/malformed/non-array scope list is 400; the label rules match `/rest/api-keys`; expiry is a number or null and is echoed; the principal is bound to `default` with `audience: service-principal` |
| revoke | the credential answers REVOKED afterwards, not UNKNOWN; the record survives; an unknown or already revoked id is a silent no-op; a revoked principal leaves the list but not the store |
| transfer | the record leaves one owner and joins the other; kind, label, tenant, `createdAt` travel while the digest is re-minted; the rotated credential authenticates as the new owner and the old one is UNKNOWN; the rotated credential is not retrievable; a receiver that cannot hold the scopes is 400 and takes nothing; an unknown receiver and a self-transfer are 400; a revoked principal is 400; the receiver limit is enforced |
| enumeration | an id the caller never owned is a silent no-op on PATCH and on DELETE, and the record is untouched |
| member boundary | every operation is 403 for `global:member`, with the upstream message; a member cannot read, transfer or revoke an owner's principal through any path |
| redaction | no response body contains `"digest"`, `"rawApiKey"`, `"raw"`, `"rawCredential"` or `"password"`, nor the digest value; the DTO is a whitelist, proven by adding a field to the stored record |
| session boundary | a service credential and an api key both answer 401 on `/rest/*`; a cross-origin write with a real session is 403 before a handler runs and stores nothing; a request with no session is 401 |

## 3. Registration

- `src/lego/manifest/domains.json`, capability `auth.machine-identity`: `service-principal-list`
  and `service-principal-transfer` added, so the capability model names the surface that now
  exists.
- `machine-identity.mjs`: `MACHINE_AUDIT_EVENTS` gains `service-principal.transferred`;
  `AUDIT_FIELDS` gains `fromRef` and `toRef`, because accountability changed on both sides
  of a transfer and an audit row that names only the new owner is not an audit row.
- `docs/engineering-operations/workforce/decisions/DEC-0023.json`: the member boundary.

## 4. Deliberate differences from `/rest/api-keys`

- **Admin/owner only** (DEC-0023), because `apiKey:manage` is not admin-only upstream.
- **A transfer rotates the credential**; `/rest/api-keys` has no transfer to compare to.
- **A `SecurityError` is mapped to its published status.** The create route wraps
  `createServicePrincipal` so a policy denial answers 403 (`auth.forbidden`) or 400
  (`lego.contract_violation`) instead of escaping as a 500, which would tell an operator the
  server broke when the request was correctly refused. This is the same `guarded` pattern
  `src/compat/credentials.mjs` already uses for the vault.

## 5. Not delivered here

- **Project/ownership beyond a single accountable owner.** A transfer moves a principal
  between users in the same tenant; there is no project model to move it into (P5-M10).
- **Delegation over HTTP.** `delegate()` stays in-process, as the contract-lock row declares.
- **A frontend implementation.** The editor is the pinned prebuilt `n8n-editor-ui` 2.9.4 with
  no local source tree, so "UI management" here means the `/rest` contract the editor's
  settings page consumes, exercised through the real server. No second framework or asset
  tree is introduced.
