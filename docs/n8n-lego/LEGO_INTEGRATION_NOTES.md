# P2.6/P2.7 integration notes — Agent 1 (P2.5) and future P3–P11 agents

Companion to `docs/n8n-lego/BACKEND_LEGO.md`. That document defines the backend
LEGO foundation and its lifecycle rules; this one is the short version each
agent needs to act on.

Baseline: `main` @ `cb71dbb2`. Nothing in P2.6 or P2.7 changes runtime behaviour —
`src/server.mjs` is untouched, no route was added, removed or altered, and the
nested reference tree is a template that is never mounted.

---

## Part A — Agent 1 (Frontend LEGO / P2.5)

### A.1 What you can rely on, and where it is

| you need | consume | do NOT consume |
| :--- | :--- | :--- |
| capability ids + owner + phase | the `501` body: `{code:'unsupported', meta:{feature, owner, phase}}` | `src/compat/capability.mjs` internals |
| the full capability map, offline | `apps/n8n-lego/src/lego/manifest/domains.json` → `domains[].capabilities[]` (`restFeature` is the wire name) | any domain source file |
| error identity | `apps/n8n-lego/src/lego/contracts/errors.contract.json` | English message strings |
| REST envelope + status semantics | contract `compat.http` v1.0.0 (`src/lego/contracts/contract-lock.json`) | `src/rest/routes.mjs` |
| scopes / auth context shape | `compat.http` → `auth-context.mjs`, `scopes.mjs` exports | `src/auth.mjs` |

Both files are plain JSON with no build step, so a frontend generator can read
them directly or vendor a copy.

### A.2 The three shared contracts you must consume

1. **`compat.http` v1.0.0** — the envelope (`{data}`, bare `{count,data}`), the
   error shape (`{message, code?, meta?}`), the status semantics, and
   `PublicUser.globalScopes`. Unchanged by P2.6; now version-locked, so it
   cannot move under you without a version bump and a changelog entry.
2. **`lego.error-contract` v1.0.0** — `code` is the stable, language-independent
   identity. **Map presentation off `code`, never off `message`.** This is the
   prerequisite for the future Translation LEGO; if P2.5 keys any UI string off
   backend English, translation work later has to be redone.
3. **`lego.domain-registry` v1.1.0** — capability ids, owners and phases. If the
   frontend wants to render "this feature arrives in P5, owned by auth", read it
   from here or from the 501 meta; do not hardcode a second roadmap. v1.1.0 added
   hierarchy accessors; it is additive, so a v1.0.0 consumer needs no change.
4. **`lego.contract-compat` v1.0.0** (P2.7) — if P2.5 wants to reason about
   backend contract versions (e.g. "is this frontend build compatible with this
   backend?"), use `satisfies()` and `classifyChange()` rather than inventing a
   second comparison. Capability identity stays **shared and conceptual**
   (one id, e.g. `workflow.history`); frontend and backend may each have their
   own manifestation of it, but there must not be two competing id vocabularies.

### A.3 Rules that apply to you

* `unsupported` is deliberately namespace-free (`code: 'unsupported'`, not
  `compat.unsupported`) — that is the P2 wire contract and it stays.
* Adding an error code is a MINOR change on our side; your mapping must degrade
  gracefully on an unknown code (generic message + the code in diagnostics),
  never crash.
* No frontend implementation detail may be imported into backend architecture,
  and P2.6 dictates nothing about Vue, stores or components. The boundary is the
  HTTP surface, in both directions.
* If you need a capability the backend does not expose, request it as a
  **capability id** in the registry — do not add a special case in `src/compat/`.

### A.4 Coordination items open with you

| item | needs |
| :--- | :--- |
| capability id naming | we use `<domain>.<capability>` in the registry and the shorter `restFeature` on the wire. Confirm the wire name is what P2.5 keys off. |
| unknown-code fallback | confirm P2.5 renders a sane default for an unregistered code. |
| `settings` domain ownership | you own `GET /rest/settings`, but its inputs come from many domains. Manager arbitration (§C.2). |
| one capability vocabulary | P2.7 keeps a single conceptual capability identity. If P2.5 builds a frontend registry, it must *reference* these ids, not mint parallel ones. **Flagged for Manager if P2.5 has already diverged.** |
| contract version exposure | should the backend surface its contract versions over HTTP (e.g. in `/rest/settings`) so the frontend can check compatibility at runtime? Not built — **Manager decision**, since it adds a wire field. |

---

## Part B — P3–P11 domain agents

### B.1 Before you write a line of your domain

1. Read `apps/n8n-lego/src/reference-lego/README.md` (six steps, ~100 lines).
2. Find your domain in `src/lego/manifest/domains.json`. It already exists with
   your ownership, dependency direction and capability stubs.
3. `node tools/lego/architecture-gate.mjs` must be green before you start, so any
   red is yours.

### B.2 Building the domain

```
src/<your-domain>/
├── contract/index.mjs   PUBLIC  — the only file other domains may import
├── internal/…           PRIVATE — gate-enforced, cross-domain imports fail
├── sub/<child>/         optional sub-LEGO, same shape, own registry entry
└── routes.mjs           the compat-router route table (if you own REST paths)
```

If you split into sub-LEGOs (P2.7): each child is a **full** registry entry with
`parent` set and its `paths` inside yours; depth is capped at 3; declare the
child versions you build against in your `requires` map. A compatible child
upgrade then does **not** force you to bump — that rule is tested, not just
documented. See `src/reference-lego/` for the worked example.

Then, in the manifest, update your entry's `paths`, `public`, `dependsOn`,
`capabilities` and `contract.version`, add your error codes under your
`errorNamespace` in `errors.contract.json`, add your row to
`contract-lock.json` with its exports/consumers/tests, and wire the domain in
`src/server.mjs` — the only file allowed to import several domains'
implementations.

### B.3 The rules that will fail your build

| you did | rule |
| :--- | :--- |
| imported another domain without declaring it | R3 |
| imported a domain your entry forbids | R2 |
| imported someone's `internal/` or a non-public file | R4 |
| added a file to `src/rest/` | R5 |
| added a file no domain claims | R1 |
| changed a locked contract's exports without a version bump | R7 |
| left an allowance in the manifest nothing uses | R8 |

Your carve-out from the legacy zone: look up your prefix in
`legacy.migrationTargets`. Moving a prefix out of `src/rest/routes.mjs` into your
domain is the expected shape of a P3+ change — the zone is frozen and may only
shrink.

### B.4 Per-agent starting point

| agent | domains | ready to start? | first move |
| :--- | :--- | :--- | :--- |
| Agent 2 | `workflow`, `execution`, `webhook`, `workspace` | **yes** | carve `/rest/workflows` + `/rest/executions` out of the legacy zone behind a published contract; `workflow → execution contract` is already the declared direction |
| Agent 3 | `auth`, `credentials` | **yes**, with a blocker to clear first | publish `src/auth/contract/` (`toPublicUser`, `hasOwner`) — that retires allowances **A1** and **A2** and unblocks compat/settings |
| Agent 4 | `node-registry`, `dynamic-parameters` | **yes** | publish a node-registry contract; note `node-registry` is forbidden from reaching credentials or storage — request a contract instead |
| Agent 5 | `storage`, `data-tables` | **yes**, and you are on the critical path | publish `src/storage/contract/` (id allocation + collection ports) — that retires **A3** and unblocks execution/workflow persistence work |
| Agent 6 | `runtime-host`, `realtime`, `worker`, `observability` | partly | `runtime-host` and `realtime` are implemented; `worker` stays at 501 until queue mode is a funded phase (P11) |

### B.5 Things you must not do in your domain

* No `common/`, `utils/`, `helpers/` directory. If it is genuinely cross-domain,
  it is a kernel proposal to Manager (§5 of BACKEND_LEGO.md) — four criteria, not
  a convenience.
* No new business logic in `src/compat/`. The boundary translates; it does not
  decide.
* No error string as identity. `assertErrorCode()` will throw on an unregistered
  code — that is the point.
* No HTTP inside a domain contract. Raise a code; the compatibility layer renders
  the status. Your contract must stay usable from a test, a CLI or a worker.
* No Rust. Rust remains locked until the Manager unlocks it. When it is
  unlocked, the path is already carved: publish the same contract, satisfy the
  same operations, pass the same contract tests — see the two interchangeable
  implementations in `sub/validation/sub/schema/`.
* **No process-local coupling in new code.** No module-global mutable state, no
  in-memory id allocation, no direct filesystem or `process.env` access — take
  config and collaborators by injection. `npm run lego:scaleout` fails the build
  on new LEGO code that does this, precisely so a future worker split is a
  deployment change and not a redesign.
* No HTTP microservice to "prove" isolation. LEGO-to-LEGO is in-process behind
  contracts; that is what lets a worker wrap the same logical contract later.

---

## Part C — Manager

### C.1 What is enforceable today

Ownership uniqueness (at every nesting level), dependency direction, public/private
surfaces, nested parent/child/sibling rules, the frozen legacy zone,
contract-version drift and consumer compatibility, stale allowances, capability
owner/phase agreement between the wire and the registry, and scale-out
exceptions being declared rather than accumulating silently.

All of it in well under a second of pure Node, proven by a selftest that plants
real violations — **19/19 detected** (11 source fixtures, 7 registry fixtures,
1 negative control).

### C.1b What P2.7 certifies (with evidence)

| property | proof |
| :--- | :--- |
| nested LEGO (depth 3) | registry + `lego-lifecycle.test.mjs` §1–2 |
| sub-LEGO upgraded independently | `reference.validation` 1.0.0→1.1.0 with siblings and parent unmoved, §3 |
| implementation replacement | two impls behind `reference.validation.schema`, consumer blind to the swap, §4 |
| compatibility decisions | compatible / breaking / migration-required / downgrade, §5 |
| upgrade lifecycle | `planUpgrade()` → check → migrate → test → activate, §6 |
| scale-out readiness | 10 findings, all declared and owned; **2 blockers named**, §7 |

### C.2 What needs arbitration

| # | question |
| :--- | :--- |
| 1 | `webhook` — Agent 2 (workflow/execution) or Agent 6 (runtime ingress)? Currently Agent 2, provisional. |
| 2 | `settings` — Agent 1 owns the boot payload, but its inputs are owned by five domains. Contract-per-input, or keep aggregation with Agent 1? |
| 3 | `workspace`/projects — touches auth sharing and workflow resources. Currently Agent 2, provisional. |
| 4 | `legacy-rest` — Agent 1 is custodian, not owner. Confirm that each carve-out is delivered by the *target* domain's agent, not by Agent 1. |
| 5 | Kernel admissions — any addition to `platform-kernel` is a Manager decision. |
| 6 | Whether P3 may run with `storage` still contract-less (allowance A3 open) or must wait for Agent 5. |
| 7 | **Scale-out blockers are storage-owned and P8-dated** (`src/store.mjs`: in-memory execution id counter, local-disk system of record). If multi-process execution is wanted earlier than P8, Agent 5's storage contract must be re-prioritised. |
| 8 | Should contract versions be exposed over HTTP for frontend compatibility checks? Adds a wire field; not built. |
| 9 | `webhook` ownership interacts with scale-out (ingress may belong with runtime). Decide together with item 1. |

### C.3 Intentionally deferred debt

* `src/rest/routes.mjs` (845 lines) is still a multi-domain aggregate; only its
  growth is blocked, not its existence.
* `auth`, `storage`, `execution`, `workflow`, `node-registry` have empty `public`
  arrays — they are not yet consumable as contracts, only as implementations by
  the composition root.
* Allowances A1/A2/A3 are open, each with an owner and a phase deadline.
* Only static, literal import specifiers are analysed. A computed
  `import(variable)` would escape the gate; no such call exists in the tree today,
  and adding one should be treated as a review failure.
* Capability status is declared, not measured — the registry says what a domain
  *claims*; the domain's own contract tests are what prove it.
* **The backend is not scale-out ready, and P2.7 does not claim it is.** Two
  blocking findings remain in `src/store.mjs` (process-local id allocation,
  local-disk system of record), owned by Agent 5 for P8. Everything else is
  benign or permanently accepted. See BACKEND_LEGO.md §16.
* The nested proof lives in the reference *template*. Real domains
  (`workflow`, `execution`, …) are **not** split into sub-LEGOs yet — P2.7
  provides the mechanism and the worked example; using it is P3+ work.
* Contract compatibility is checked between the registry, the lock and declared
  `requires` ranges. It does not introspect runtime call sites — a consumer that
  never declares `requires` is not version-checked.
