# Post-P2.27 Transition Package — Manager decision input

**Owner:** Manager (this document is decision input, not authorization)
**Prepared by:** Agent 1 — Global Integration / Reconciliation, 2026-09-24
**Status:** PLANNING-ONLY. This document authorizes nothing.

**Purpose.** P2.27 is complete. No next milestone ID has been authorized. This
file exists so the next Manager decision can be made from repository evidence
alone, without chat history. It invents no milestone number and starts no
implementation.

**Authority sources used (all in-repo or in-GitHub, nothing inferred):**

- `docs/n8n-lego/milestones.json` — the canonical machine-readable register
- `apps/n8n-lego/src/lego/manifest/ai-lego-set.json` — the official 15 AI/Agent LEGO
- `apps/n8n-lego/src/lego/contracts/contract-lock.json` — 76 locked contract rows
- GitHub Issue #90 — Master Strategic Roadmap (planning-only by its own text)
- GitHub Issue #101 — P9 deep-design workstream (planning-only by its own text)
- `docs/n8n-lego/P2.27-PLUGIN-RUNTIME-DESIGN.md` and Issue #83 — P2.27 architecture

---

## A. Current baseline

```text
main:
  827216e07537c53e4f74866a93cfec9fbca0b222   (verified, working tree dirty 0)
P2.27:
  complete
P9:
  independent / active
```

Detail on the baseline:

| Item | Value | Note |
| --- | --- | --- |
| Protected main | `827216e0` | one commit past the P2.27 wrap point |
| P2.27 wrap point | `7e709e69` | PR #199 |
| P2.27 final implementation slice | `7d4eae8d` | PR #197 |
| Delta `7e709e69` → `827216e0` | 1 file, +14/−3 | PR #202, evidence tail only, no code |
| Register `currentMilestone` | `P2.27` | Manager-owned, deliberately **not** advanced |
| Register `previousCompletedMilestone` | `P2.26` | Manager-owned, deliberately **not** advanced |
| `P2.27.status` | `complete` | `finishEvidence = PR #197 → 7d4eae8d` |
| Contract rows | 76 | `lego.plugin-runtime@0.10.0`, zero drift |
| Gates on `827216e0` | 7/7 | see §G below |

The register pointers still point at P2.27 even though P2.27 is complete. That is
**correct and intentional**: advancing `currentMilestone` /
`previousCompletedMilestone` is a Manager act performed when the next milestone
is authorized, not a side effect of the previous one finishing. Both milestone
suites pin these values.

---

## B. Completed dependency chain

P2.27 closed the P2 ladder. Every register row from P2.11 through P2.27 is
`status = complete`:

```text
P2.11 → P2.12 → P2.13 → P2.14 → P2.15 → P2.16 → P2.17 → P2.18 → P2.19 → P2.20
      → P2.21 → P2.22 → P2.23 → P2.24 → P2.25 → P2.26 → P2.27  [all complete]
```

The rows that matter most as inputs to any next P2 work:

| Milestone | Title | Why it matters next |
| --- | --- | --- |
| P2.16 | Agent Machine / execution foundation | named dependency of the residual `P2.17+` row |
| P2.18 | Universal Transport & Envelope Kernel | envelopes, deadlines, cancellation |
| P2.19 | Artifact, Approval & Audit Foundation | contract rows for Artifact / Approval |
| P2.20 | MCP vs Agent Control Boundary | `ai.mcp-boundary` contract row |
| P2.21 | Runtime Adapter & Harness Stack | `ai.runtime-adapter@1.1.0` |
| P2.22 | Node Compatibility & Portability | portability discipline for any Rust work |
| P2.23 | Node Creator & Translation | both still `planned` in the AI/LEGO set |
| P2.24 | Token & Usage — honest accounting | `ai.token-usage`, LEGO still `in-progress` |
| P2.25 | External provider integration | first real provider adapters |
| P2.26 | Provider, Workspace & GitHub + readiness | foundation-readiness gate |
| **P2.27** | **Contract-Driven Pluggable Runtime & Security** | **tiny Core, plugin registry, capability policy, locality, secret broker, resource budgets, supervisor + quarantine, circuit breaker, contract replay, side-by-side upgrade/rollback, supply-chain admission, frontend plugin boundary** |

P2.27 delivered a single new contract row, `lego.plugin-runtime@0.10.0`, with a
12-file locked surface:

```text
plugin-runtime.mjs    plugin-registry.mjs   plugin-manifest.mjs
plugin-policy.mjs     plugin-locality.mjs   plugin-secrets.mjs
plugin-resources.mjs  plugin-supervisor.mjs plugin-failure.mjs
plugin-replay.mjs     plugin-upgrade.mjs    plugin-frontend.mjs
```

**This is the new shared foundation every candidate below now sits on.** No
candidate needs to re-derive trust classes, capability policy, locality policy,
secret brokering, resource budgets, quarantine, or supply-chain admission — those
are built, locked and tested.

---

## C. Candidate next work

**No candidate below is authorized. These are the only capability areas the
authoritative sources name as unfinished.**

The register's single remaining row is `P2.17+ — Later capability ladder`
(`status = planned`, `owner = manager`). Its own boundary text states: *"Future
ladder only. Exact future numbering can be split or refined by Manager when
implementation evidence requires it, but only by updating this canonical
register."* Its declared deliverables are the candidate list:

| # | Candidate area | Register deliverable | AI/LEGO status today | Phase |
| --- | --- | --- | --- | --- |
| C1 | **Artifact** | Phase C Artifact | `contract-only` | C |
| C2 | **Approval** | Phase C Approval | `contract-only` | C |
| C3 | **MCP boundary** | Phase C MCP | `contract-only` | C |
| C4 | **Runtime Adapter** | Phase C Runtime Adapter | `contract-only` | C |
| C5 | **Work Trace / Agent Event** | Phase D Work Trace | `contract-only` | D |
| C6 | **Token & Usage follow-on** | Phase D Token & Usage | `in-progress` | D |
| C7 | **Node Creator follow-on** | Phase D Node Creator | `planned` | D |
| C8 | **Translation follow-on** | Phase D Translation | `planned` | D |
| C9 | **External providers follow-on** | Phase E external providers | — | E |
| C10 | **Measured native optimisation** | Phase F measured native optimisation | — | F |

Status vocabulary, verbatim from `ai-lego-set.json`, so the table is not
over-read:

- `implemented` — "Code exists, runs and is covered by tests."
- `contract-only` — "The contract is fixed and testable; no implementation exists."
- `planned` — "Intended; no contract is fixed yet."
- `in-progress` — "Implementation is underway; completion still requires reconciliation and protected-main verification."

Note the contract-lock nuance: `ai.artifact`, `ai.approval`, `ai.mcp-boundary`,
`ai.runtime-adapter` and `ai.token-usage` all carry `status = implemented` **in
the contract lock**, while their LEGO rows are `contract-only`. Both are true and
they mean different things: the contract surface and its tests exist; the runtime
behind them does not. A candidate in this table is a **runtime** milestone, not a
contract-authoring one.

Two further candidate tracks exist but sit **outside** the P2 ladder, so they are
listed for completeness and are explicitly not P2.28-shaped:

- **P3** is already `ACTIVE` as Issue #97 with canonical `P3.x` numbering and
  merged slices; it has its own lane and its own evidence chain.
- **P9** is an independent protected workstream (see §H).

---

## D. Dependencies per candidate

Declared dependencies are quoted from `ai-lego-set.json`; the runtime/security
column is what P2.27 now supplies.

### C1 — Artifact

| Axis | Dependency |
| --- | --- |
| Contract | `ai.artifact@1.0.0` exists (contract lock, `implemented` surface) |
| Capability | depends on `ai-foundation` and `storage` |
| Security | artifact access must route through P2.27 capability policy (deny-by-default) and the secret broker; no new trust path |
| Runtime | storage LEGO is the provider; P2.27 locality decides in-process vs remote |
| Frontend | artifact surfacing would touch the P2.27.10 frontend plugin boundary |
| P9 | artifact/audit evidence is observable via P9 audit integration; P9 must not be redesigned to serve it |

### C2 — Approval

| Axis | Dependency |
| --- | --- |
| Contract | `ai.approval@1.0.0` exists |
| Capability | depends on `ai-foundation` and `capability`; `agent-machine` already depends on `approval` |
| Security | the highest-leverage security candidate: approval-bound authority must consume P2.27 permission primitives, never invent a parallel grant mechanism |
| Runtime | approval state must survive supervisor restart/quarantine |
| Frontend | approval prompts are a public extension point under the P2.27.10 boundary |
| P9 | approval decisions are audit-relevant; correlate, do not co-own |

### C3 — MCP boundary

| Axis | Dependency |
| --- | --- |
| Contract | `ai.mcp-boundary@1.0.0` exists |
| Capability | depends on `ai-foundation` and `capability` |
| Security | MCP servers are untrusted-by-nature: this is where P2.27 trust classes (`CORE`/`TRUSTED`/`ISOLATED`/`SANDBOXED`) and locality (`ISOLATED_PROCESS`/`REMOTE`) get their first real consumer |
| Runtime | needs the supervisor + circuit breaker for remote MCP failures |
| Frontend | minimal |
| P9 | MCP call telemetry is P9's to observe |

### C4 — Runtime Adapter

| Axis | Dependency |
| --- | --- |
| Contract | `ai.runtime-adapter@1.1.0` exists |
| Capability | depends on `ai-foundation` and `agent-machine` |
| Security | adapters execute third-party-shaped work → P2.27 supply-chain admission applies |
| Runtime | the most P2.27-coupled candidate: it is the natural consumer of `lego.plugin-runtime` locality + resource budgets |
| Frontend | minimal |
| P9 | adapter health/resource telemetry overlaps P9 resource-pressure; must consume, not duplicate |

### C5 — Work Trace / Agent Event

| Axis | Dependency |
| --- | --- |
| Contract | no dedicated row yet in the 76 — would be a new row, so the 76-count pin and `.ai` regen must move in the same slice |
| Capability | depends on `ai-foundation` |
| Security | traces carry tenant context; redaction is P9's fail-closed policy (P9.7) |
| Runtime | emission must not become a hidden semantic dependency (Issue #101 core rule) |
| Frontend | trace rendering would use public extension points |
| P9 | **Highest overlap with P9.** This candidate cannot start without an explicit Manager ruling on the P9/P2 seam |

### C6 — Token & Usage follow-on

| Axis | Dependency |
| --- | --- |
| Contract | `ai.token-usage@1.0.0` exists |
| Capability | depends on `ai-foundation` and `context-session` (which is itself `in-progress`) |
| Security | usage accounting is integrity-critical; deny-by-default reporting |
| Runtime | resource budgets from P2.27 are the enforcement primitive |
| Frontend | usage display surface exists |
| P9 | metrics naming overlaps P9.3 metric cardinality |

### C7 — Node Creator follow-on

| Axis | Dependency |
| --- | --- |
| Contract | none fixed (`planned`) — contract work is part of the candidate |
| Capability | depends on `node-registry` and `capability`; `node-registry` already owns 33 of the 76 locked rows |
| Security | generated nodes are untrusted code → supply-chain admission + quarantine |
| Runtime | natural first `WASM`/`ISOLATED_PROCESS` locality consumer |
| Frontend | node-creator UI is a real frontend surface |
| P9 | node/plugin health is P9-owned |

### C8 — Translation follow-on

| Axis | Dependency |
| --- | --- |
| Contract | none fixed (`planned`) |
| Capability | depends on `ai-foundation` |
| Security | translation output is untrusted → admission applies |
| Runtime | provider-backed, so it inherits C9 |
| Frontend | UI strings surface |
| P9 | low |

### C9 — External providers follow-on

| Axis | Dependency |
| --- | --- |
| Contract | P2.25/P2.26 provider declaration + adapters already landed |
| Capability | provider adapters exist; follow-on is breadth/robustness |
| Security | credential isolation via the P2.27 secret broker is mandatory, not optional |
| Runtime | remote locality, circuit breaker, deadline propagation |
| Frontend | provider config surfaces exist |
| P9 | provider call telemetry |

### C10 — Measured native optimisation (Phase F)

| Axis | Dependency |
| --- | --- |
| Contract | none new |
| Capability | — |
| Security | unchanged |
| Runtime | Rust/WASM behind existing contracts, per the P2.22 portability discipline |
| Frontend | none |
| P9 | measurement itself needs P9 telemetry — **blocked-ish on P9 landing** |
| Known blocker | Issue #121 (TypeScript runtime gate structurally fails every Rust change set) and #130 (pre-existing Rust fmt drift) must be resolved first |

---

## E. Boundary — what no candidate would own

These boundaries hold regardless of which candidate is chosen:

1. **Core stays tiny.** No candidate may move workflow, execution, memory,
   storage implementation, AI provider implementation, Node Registry business
   logic, GitHub integration, Workspace business logic, translation features or
   credential implementation into Core.
2. **No second engine.** One workflow engine. No parallel execution path.
3. **No new architecture domain.** New work is a sub-LEGO, a capability or an
   operation of an existing LEGO unless it owns a genuinely distinct lifecycle
   *and* data set (the `setRule` in `ai-lego-set.json`). No sixteenth top-level
   AI LEGO.
4. **No plugin-per-function.** Pluginization must not become microservice sprawl.
5. **Trust class never grants unrestricted capability.** Capabilities stay
   explicit and deny-by-default.
6. **Locality vocabulary stays closed:** `IN_PROCESS`, `WASM`,
   `ISOLATED_PROCESS`, `REMOTE`.
7. **Secrets stay scoped and short-lived**, one operation, never plugin-owned
   state.
8. **Budgets stay explicit and bounded.**
9. **Repeated failure still leads to quarantine.**
10. **Side-by-side activation and workflow-rewrite-free rollback stay possible.**
11. **P2.27 is frozen.** No `P2.27.11`, no `P2.27.12`, no silent "small
    improvement" appended to a completed milestone. Any post-P2.27 improvement
    becomes a new issue, an additive change, a new milestone/slice, or an
    explicit regression fix.
12. **GitHub remains code authority.**
13. **P9 is not a dependency to be consumed by rewriting it.** Candidates may
    consume P9 contracts; none may redesign P9 internals, rebase P9, merge P9, or
    alter P9 shared files for cosmetic synchronization.

---

## F. Required Manager decisions

Exactly these, and only these, block the next implementation:

1. **Which candidate.** Pick one of C1–C10 (or name something else). The register
   supplies the list; it does not rank it.
2. **The exact milestone ID.** No `P2.28` exists in the repository or on GitHub
   (verified: zero matches in both). The ID is created only by updating
   `docs/n8n-lego/milestones.json`, per that file's own `purpose` text.
3. **Pointer advance.** Whether to move `currentMilestone` off `P2.27` and
   `previousCompletedMilestone` to `P2.27`. Both are Manager-owned and both are
   currently pinned by the milestone suites; they must move together with the new
   row, in one slice, with `.ai` regenerated.
4. **The P2/P9 seam**, and only if a candidate with P9 overlap is chosen (C5 Work
   Trace is the sharpest case; C4 and C6 have milder overlap). Who owns the
   contract, who consumes it, and how telemetry failure stays non-semantic.
5. **A dedicated Master Prompt.** Per Issue #90: *"feature issues are durable
   requirements; Master Prompts authorize implementation."* A candidate is
   `planned` until that prompt exists.
6. **Rust/CI blockers**, only if C10 is chosen: Issues #121 and #130.

What is **not** a Manager decision and needs no ruling: P2.27's completion (it is
done and verified), the P9 firewall (it stands), and the historical evidence
record (it is append-only and untouched).

---

## G. Gate results on the reconciled tree

All gates were executed, not assumed. See the reconciliation evidence section in
`docs/n8n-lego/evidence/P2.27-PLUGIN-RUNTIME-EVIDENCE.md` for the full run.

| Gate | Result |
| --- | --- |
| `npm run lego:arch` | PASS — 26 domains, 76 locked contracts, every import inside its declared boundary |
| `npm run lego:arch:selftest` | PASS — 26/26 |
| `npm run lego:foundation` | PASS — 26 LEGOs, 12 node-creation routes |
| `npm run lego:foundation:selftest` | PASS — 15/15 |
| `npm run lego:capabilities` | PASS — 23 REST features vs 91 capabilities |
| `npm run lego:scaleout` | PASS — every finding a declared, owned exception |
| `npm run lego:ai:check` | PASS — `.ai/` in sync, 64 generated / 37 curated / 101 total |

---

## H. P9 firewall status

Inspected for dependency awareness only. **Nothing in P9 was modified.**

- Issue #101 — open, planning-only by its own text ("Implementation requires a
  dedicated P9 Master Prompt").
- The P9 lane has advanced well past the P9.5–P9.11 range: 16 open P9 PRs were
  observed — `#176`, `#177`, `#178`, `#179`, `#180`, `#181`, `#182`, `#184`,
  `#191`, `#194`, `#196`, `#198`, `#200`, `#201`, `#203`, `#204` — i.e. slices
  **P9.5 through P9.20**, all on `arena/agent4-p9.*` branches. (`#183` is *not*
  a P9 PR; it is the P2.27.0 preflight, already merged.)
- P9 rows in the contract lock are the four `observability.*` rows —
  `observability.envelope`, `observability.structured-log`,
  `observability.metrics`, `observability.trace` — all `status = stable` and all
  `agent-6`-owned.
- Agent 1 action on P9: **none** — no merge, no rebase, no close, no contract
  rewrite, no shared-file edit, no cherry-pick.

---

*End of transition package. Nothing here is authorization.*
