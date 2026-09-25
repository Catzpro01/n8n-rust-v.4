# P5-M01 — Security hardening: tombstone revocation (evidence)

Slice `P5-M01` (program P5, maintenance; issue #85; debt source: `P5.8-CERTIFICATION-EVIDENCE.md` §7).
Delivered by one PR (DEC-0014). Task executed by the Manager because no worker session was
attached (DEC-0016). Status stays `in-progress` in the register until the Slice is COMPLETE
(merge, fresh-main verification and, under DEC-0015, the deferred self-hosted checks passing on main).

## 1. Scope decided for this Slice

| Feature | Disposition | Basis |
|---|---|---|
| P5-F-DEBT-002: API-key revoke marks revoked instead of deleting | **delivered here**; also covers service principals | P5.8 §7: "key revocation deletes instead of tombstoning" |
| P5-F-DEBT-001: permission decision cache on the REST path | **deferred** | Measured in P5.8 §4.2 / finding 1: a warm cache hit (438 ns p50) is not faster than uncached `authorize` ALLOW (384 ns p50). The finding says to route REST through the engine only when per-resource or tenant policy needs it; no such need exists yet. |
| P5-F-DEBT-003: key-rotation work list without O(n) scan | **moved to P5-M04** (planned) | Every rotation batch also persists with an O(n) `replaceAll`, so an index does not change the complexity class. Measure the per-batch scan against the persist first. |
| P5-F-DEBT-004 / -005: multi-host key storage; shared session + limiter state | **moved to P5-M05** (planned) | They depend on the P8 storage contract (P8-S01, not authorized). There is no multi-instance claim: `src/store.mjs` is still a local JSON system of record. |

## 2. Behaviour

- `DELETE /rest/api-keys/:id` and `revokeServicePrincipal` keep the record with `revokedAt` and `revokedReason`. The digest stays, the raw credential was never stored, and the upstream response `{ success: true }` is unchanged.
- A presented revoked credential is now reported **`revoked`** instead of `unknown`. This happens only when the secret matches: a wrong secret for a revoked id is still `unknown`. The caller still gets the same uniform 401; the verdict is used for audit only.
- Revoking an unknown or already revoked id is a silent no-op, with no second `api-key.revoked` / `service-principal.revoked` audit event. The response never confirms that an id exists (upstream semantics).
- Lists and the per-owner limit (`maxKeysPerOwner` = 50) count only live records, as before. Creating a new credential keeps existing tombstones.
- **Bounded:** at most `API_KEY_POLICY.maxRevokedTombstonesPerOwner` = 50 tombstones per owner and credential kind; the oldest are pruned first. Live records are never pruned.

## 3. Tests

`apps/n8n-lego/test/lego-machine-identity.test.mjs`:
- New describe block with 3 tests:
  - API-key tombstone, hidden from the list, idempotent repeat, tombstone kept across create;
  - service-principal tombstone, REVOKED verdict, second revoke false, wrong secret still UNKNOWN;
  - tombstone bound and pruning order.
- The existing "revoked (DELETE)" test now expects `revoked` instead of `unknown`. This is the intended change; no assertion was relaxed.

## 4. Rollback

`git revert -m 1 <merge>`. Stored tombstones are ordinary records with `revokedAt` set. Every reader filters them out already, and the older code treats them as revoked, so no data migration is needed in either direction.
