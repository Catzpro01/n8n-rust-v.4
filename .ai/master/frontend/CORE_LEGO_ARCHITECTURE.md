<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../CORE_LEGO_ARCHITECTURE.md`](../CORE_LEGO_ARCHITECTURE.md). Where the two disagree on a *number*, the canonical
> document wins: its figures are generated from the manifests at build time,
> whereas this view was hand-written against backend baseline `6f7b66da` (P2.10)
> and is **not** updated by regeneration.
>
> Known differences at the time of reconciliation: XA-5 is **closed** (the eleven
> `lego.*` codes are published), the operation count is **not 173**, and gate rules
> run through **F17**.
>
> This banner deliberately names no live totals. Counts move every phase (P2.12
> published `ai.skill` and added an error code), and a correction notice that
> hardcodes them goes stale exactly like the text it corrects. For current
> figures read the generated [`CURRENT_STATUS.md`](../CURRENT_STATUS.md) and
> [`AI_CONTRACT_MATRIX.md`](../AI_CONTRACT_MATRIX.md), which are derived from
> the manifests; where this snapshot disagrees with them, they win.
>
> It is preserved because it carries frontend reasoning, UX consequences and
> cross-agent reconciliation notes that no backend manifest derives.

# Core LEGO architecture — the frontend's consumption view

**Status:** consumption view. **Canonical owner:** agent-2 (`manifest/domains.json`,
`manifest/foundation.json`, `contracts/contract-lock.json`, ADR-0001…0010).
**This document declares nothing backend-visible.** It records what a frontend or planning agent must
know about the core LEGO domains in order to consume them, and where the truth lives. Any statement
here that contradicts `domains.json` is a defect in this document, not in the registry.

---

## 1. What a LEGO is

A LEGO is a domain with one responsibility boundary and one owner, described by one public contract:
identity, version, capabilities, operations, permissions, interaction classes, dependencies
(and forbidden dependencies), lifecycle, availability, criticality, trust, transport capability,
degradation, migration state, replacement strategy, resource profile, tests and evidence. A LEGO may
be replaced internally without forcing consumers to rewrite — the **contract is the seam**.

Nested LEGO is real LEGO, not a decorative folder: registry identity, owner, contract, version,
dependencies, capabilities, tests, lifecycle and a replacement boundary of its own, to a maximum depth
of three. `reference-lego.validation.schema` is the worked example.

## 2. What the frontend consumes, and from where

| Fact | Source | Consumed through |
| :--- | :--- | :--- |
| domain + capability identity, owner, status, lifecycle, criticality, trust, availability, degradation, migration state | `domains.json` | `manifest/capabilities.json` (frontend declaration) + `vocabulary.mjs` |
| operations, permissions, interaction classes | `domains.json` (`operations[]`) | the negotiation verdict, never a route |
| contract ids, versions, owners | `contract-lock.json` | the vocabulary lock's `provenance.contract` |
| how a capability cannot serve | `domains.json` degradation + `interaction.mjs` states | `negotiation.mjs` → 12 distinguishable outcomes |
| how bytes may move (never *which* bytes) | `ai-foundation.json` transportRouting, `foundation.json` transport targets | `transport.mjs` eligibility + cost ladder |
| trust, resources, device profiles | `manifest/foundation.json` (**XA-9**: no contract-lock row) | quoted with a `publicationPending` record |

The frontend never reads a route table, a module path, a port, a credential store or an
implementation file. That is the seam (`seam.mjs`: 13 declared inputs, 7 forbidden sources).

## 3. Status vocabulary (published)

`domains.json` carries six domain statuses: **implemented** (8), **partial** (5), **planned** (7),
**contract-only** (1 — `ai-foundation`), **legacy** (1 — `legacy-rest`), **template** (4 —
`reference-lego*`). `contract-only` is deliberately distinct from `planned`: it means *the contract
exists and is published; no implementation exists, and none may be assumed*. The frontend renders the
difference (`capabilityStatus`, `lifecycle`, `operationOutcome`) instead of collapsing it.

## 4. The compatibility boundary

`compatibility` owns `compat.http@1.0.0` and is the only place where HTTP semantics (status codes,
envelopes, the 501 unsupported path) are decided. Its row is byte-identical on both branches (XA-3,
resolved). Consumers get an *outcome*, never a sniffed status code: a missing capability is
`capability-unavailable`, an unimplemented one is `feature-unsupported`, a version clash is
`version-incompatible` — and the frontend never re-derives that from a transport.

## 5. Legacy REST and the shrink rule

`legacy-rest` is `legacy` status by design and its contract is `0.1.0`. It carries a route → owner
map, an `unresolvedOwnership` list (including the i18n families `/rest/credential-translation` and
`/rest/node-translation-headers`, currently constant empty objects with no business logic), and a set
of stub families whose rule is that a stub family must shrink, not grow. The frontend implication:
legacy routes are never a contract the UI depends on, and no UI may treat an empty i18n stub as a
working translation feature (`TRANSLATION_PLAN.md`, XA-14).

## 6. Interaction classes and transport

Four semantic interaction classes — **CALL, EVENT, STREAM, BATCH** — describe *what an operation is*.
Transport describes *how bytes move* and is chosen by eligibility and cost (same process → in-process
direct dispatcher; local event → in-process event dispatcher; process boundary → worker IPC; remote
service → remote HTTP; external interop → MCP). A business contract never names a transport; a
transport never overrides an operation's interaction class; a STREAM request is never silently served
as a CALL. Every STREAM declares a backpressure policy; an unbounded default buffer is forbidden.

## 7. Stability and versioning

Consumers depend on contracts, not implementations. Implementation version may move without a
consumer rewrite while the contract stays compatible; incompatible transitions are declared in the
lock, not discovered at runtime. Contract locks exist to prevent silent drift; a consumer that cannot
verify its contract fails closed rather than adapting silently.

## 8. Resource and trust declarations

Every domain declares a resource profile (cpu, memory, disk, network, concurrency, startup) and a
trust tier. The frontend uses these for two things only: deciding what it may offer on a constrained
device (runtime selection is budget-derived), and labelling capability sources honestly
(`Native`, `MCP`, `Runtime`, `Remote`). It never computes a resource profile of its own.

## 9. Frontend-side counterpart

`packages/frontend-lego/src/vocabulary.mjs` pins the shared words with provenance (38 canonical sets)
and declares the local ones (22 sets, each mapped or given a reason). `conformance.mjs` holds the
26 architecture rules; `seam.mjs` holds the boundary; `negotiation.mjs` holds the 12 outcomes;
`agents.mjs` / `agent-events.mjs` hold the AI contract views. Where the backend publishes a word, the
frontend quotes it; where it does not, the frontend records a `publicationPending` decision instead of
inventing one.
