# P6-S01 Evidence — Live community / private / custom node installation path (Issue #95)

Slice: **P6-S01** · Program: P6 (Node Ecosystem) · Module: `apps/n8n-lego/src/lego/node-admission.mjs`
Contract `node.admission@0.1.0`, domain `node-registry`.

## What was missing, and what this slice adds

P6 already owned every primitive the admission path needs — the declaration
vocabulary and invariants (`node-registry.mjs`), the trust-class → capability
ceiling (`plugin-policy.mjs`), the trust-class → locality matrix
(`plugin-locality.mjs`), digest/attestation/revocation (`supply-chain.mjs`),
the integrity chain and freshness (`registry-integrity.mjs`), the crash breaker
and quarantine (`node-health.mjs`), and the transactional
resolve→prepare→verify→stage→publish→activate steps (`package-transaction.mjs`).

What did **not** exist was the thing that runs them **in order, fail-closed,
with a reason** — the pipeline Issue #95 specifies. Two registry capabilities
were still `unsupported` (`node-registry.community-packages`,
`node-registry.community-node-type-detail`) precisely because there was no
admission decision to put behind them.

This slice adds that pipeline as a pure decision function: it performs no I/O,
downloads nothing, installs nothing and executes nothing.

## The pipeline

```text
artifact → identify → verify package metadata → verify digest/signature/provenance
         → resolve node contract → resolve requested capabilities
         → resolve trust class → resolve runtime locality
         → validate resource limits → validate compatibility
         → health/self-test → admit or reject
```

The stage order is Issue #95's, unchanged, and it is load-bearing: identity
before provenance, provenance before capability, capability before locality,
health last so a node is never health-tested before it is known to be legal.

## Hasil test (offline, exit 0)

- **41 tests green** in `apps/n8n-lego/test/lego-node-admission.test.mjs`, 0 failures.
- `apps/n8n-lego` suite: **2703 pass / 3 fail** — the same three pre-existing
  node-catalog REST failures present at the pre-change baseline (2665 → 2706
  tests, +41, 0 new failures).
- `lego:arch` OK · `lego:arch:selftest` 26/26 · `lego:capabilities` 22 REST
  features vs **103** registered capabilities OK · `lego:scaleout` OK ·
  `lego:foundation` OK · `lego:foundation:selftest` 15/15 · `lego:ai:check` in
  sync (101 files).
- `cargo test --workspace` 321 passed / 0 failed; `cargo fmt --all -- --check`
  clean (unchanged Rust, re-verified).

## Coverage

### A node class is a policy input, not a trust grant

| Behaviour under test | Test |
|---|---|
| All seven Issue #95 classes are distinguished | `all seven Issue #95 node classes are distinguished` |
| **No class maps to CORE** — origin, language and official status grant no trust | `NO node class maps to CORE — origin, language and official status grant no trust` |
| `official` and `native-rust` share a TRUSTED ceiling and nothing higher (Rust is not automatically trusted) | `official and native-rust share a TRUSTED ceiling and nothing higher` |
| Community/portable classes never reach TRUSTED | `community and portable classes are never above ISOLATED` |
| The plugin-runtime vocabulary is used, not the registry's (a real mixing bug) | `the trust/locality vocabulary is the plugin-runtime one, not the registry one` |

### Fail-closed, first failure wins

| Behaviour under test | Test |
|---|---|
| The first failing stage ends the pipeline; later stages are `skipped`, never run, and carry no reason | `the first failing stage ends the pipeline and later stages are skipped` |
| Every stage rejects its own malformed input (27 stage/reason pairs) | `each stage rejects its own malformed input` |
| An absent `nodeClass` is not "default to official" | `an absent optional field is never silently defaulted into a pass` |
| A revoked artifact is refused even when everything else is clean | `a revoked artifact is refused even when everything else is clean` |
| An unverified artifact is refused rather than assumed | `an unverified artifact is refused rather than assumed` |

### The ceiling is the class, not the capability name

| Behaviour under test | Test |
|---|---|
| The same capability token is legal for one class and illegal for another | `the same capability is legal for one class and illegal for another` |
| A capability over the class ceiling is refused at `resolve-trust` | `a capability over the class ceiling is refused at resolve-trust` |
| A declared trust class may be more isolated, never more permissive | `a declared trust class may be more isolated, never more permissive` |
| An AI-authored node must be SANDBOXED | `an AI-authored node must be admitted SANDBOXED` |
| Requested capabilities are bounded | `requested capabilities are bounded` |
| **Admission grants nothing** — a node cannot admit itself by writing its own grant list | `admission grants nothing: the pipeline evaluates with no operator grants` |

### Locality stays inside the matrix

| Behaviour under test | Test |
|---|---|
| Locality is chosen inside the trust-class matrix | `locality is chosen inside the trust-class matrix` |
| A locality outside the class row is refused with the allowed row named | `a locality outside the class row is refused with the allowed row named` |
| An override can only move within the matrix, never widen it | `a localityShape override can only move within the matrix` |

### The runtime choice never changes the consumer-facing contract

| Behaviour under test | Test |
|---|---|
| The surface is the one Issue #95 enumerates | `the consumer-facing surface is the one Issue #95 enumerates` |
| An unchanged surface replays as `unchanged` | `an unchanged surface replays as unchanged` |
| **A runtime move alone is not a contract change** | `a runtime move alone does not change the consumer contract` |
| A changed `executionSemantics` or `nodeType` is `breaking`, not a migration | `a changed executionSemantics or nodeType is breaking, not a migration` |
| A changed parameter or UI surface is a `migration-required`, not a break | `a changed parameter or UI surface is a migration, not a break` |
| The pipeline replays the consumer contract against the incumbent | `the pipeline replays the consumer contract against the incumbent` |
| A candidate that declares itself `breaking` is refused | `a candidate that declares itself breaking is refused even with no incumbent` |

### Resources, health, determinism

| Behaviour under test | Test |
|---|---|
| A resource profile over the caller limit is refused with the field named | `a resource profile over the caller limit is refused with the field named` |
| A profile within the limit is admitted | `a resource profile within the limit is admitted` |
| A quarantined node is refused regardless of its metadata | `a quarantined node is refused regardless of its metadata` |
| A healthy node with a passing self-test is admitted | `a healthy node with a passing self-test is admitted` |
| `explainAdmission` names the failing stage, never a bare boolean | `explainAdmission names the failing stage and never returns a bare boolean` |
| A malformed call is a contract violation, not a rejection | `a malformed call is a contract violation, not a rejection` |
| Equal candidates produce equal verdicts; the verdict is frozen and bounded | `equal candidates produce equal verdicts` · `the verdict is frozen and its trace is bounded` |

## Bugs found and fixed while delivering this slice

1. **Stage-order bug.** `resolve-capabilities` originally checked each requested
   capability against the trust ceiling, but it runs *before* `resolve-trust` —
   the stage that resolves the ceiling. The ceiling was therefore always
   `null` and the check could never fire. Restructured so `resolve-capabilities`
   resolves the requested set and `resolve-trust` checks it once the ceiling is
   known, preserving Issue #95's exact stage order.
2. **Dropped state.** The pipeline loop carried `trustClass`, `locality` and
   `compatibility` forward but not `requestedCapabilities`, so the ceiling check
   iterated an empty list and admitted every request. This is the bug that made
   bug 1 invisible — the pipeline admitted a community node requesting `network`.
3. **Wrong verdict key.** `evaluateCapability` answers `granted`, not `allowed`.
   Reading `.allowed` (always `undefined`) silently admitted everything.
4. **Vocabulary collision.** `node-registry.mjs` publishes lowercase foundation
   trust levels (`core`/`verified`/`community`/`untrusted`) and runtime *names*
   (`js-compat`/`wasm`/…), while `plugin-policy.mjs` / `plugin-locality.mjs`
   enforce uppercase trust *postures* (`CORE`/`TRUSTED`/…) and *localities*
   (`IN_PROCESS`/`WASM`/…). The module initially imported the wrong pair and
   rejected every candidate with `UNKNOWN_TRUST_CLASS`. Now pinned by a test.
5. **Gated checks.** The `concurrency` validation sat behind the *optional*
   `resourceProfile`, and the self-test behind the optional `health` object, so
   a bad value slipped through whenever the caller omitted the optional field.
   Both are now checked unconditionally.

## Acceptance anchors (Issue #95) and where each is met

| Anchor | Where |
|---|---|
| Distinguishes the seven node classes | `NODE_CLASSES` — all seven, each with a declared ceiling |
| A node class is a policy input, not an automatic trust grant | `NODE_CLASS_TRUST_CEILING` maps class → **ceiling**; `NO node class maps to CORE` |
| Rust is not automatically trusted | `native-rust` → TRUSTED, identical to `official`, never CORE |
| Official does not mean unrestricted | `official` → TRUSTED, never CORE |
| Community code does not inherit Core authority | `verified-community`/`private` → ISOLATED; `unverified-community` → SANDBOXED |
| AI-generated defaults to a more restrictive class | `AI_AUTHOR_NOT_SANDBOXED` — a hard floor, not a preference |
| The specified pipeline order | `ADMISSION_STAGES` — Issue #95's order, asserted verbatim |
| Fail-closed for invalid or insufficiently trusted definitions | first-failure-wins; `skipped` stages; no silent defaults |
| Runtime placement mapping (in-process / WASM / isolated / remote) | `plugin-locality` matrix + `recommendLocality`; `LOCALITY_NOT_ALLOWED` |
| The runtime choice must not change the consumer-facing contract | `CONSUMER_CONTRACT_SURFACE` + `validateCompatibility`; `a runtime move alone does not change the consumer contract` |
| Preserve node type identity, parameters, expressions, credential bindings, UI metadata, import/export, execution semantics | the eight `CONSUMER_CONTRACT_SURFACE` fields |
| Validate contract version, implementation version, dependency compatibility, capability changes, resource-budget changes | `BAD_CONTRACT_VERSION`, `UNKNOWN_CAPABILITY`, `CAPABILITY_OVER_CEILING`, `RESOURCE_LIMIT_EXCEEDED`, `UNKNOWN_RESOURCE_FIELD` |
| Side-by-side validation, health/self-test, rollback, compatibility replay | `context.incumbent` replay + `health-selftest`; rollback itself stays with `registry-compiler` (P6.19) |
| Inspect trust/runtime/capability metadata | the frozen verdict carries `trustClass`, `locality`, `compatibility`, `identity` and a per-stage trace |
| Disable / quarantine / inspect failures | `NODE_QUARANTINED` refuses; quarantine remains per-host state owned by `node-health` |
| A repeatedly crashing or violating node must not destabilize Core | `health-selftest` refuses `failing` and `quarantined` before the node is declared |
| Relationship to P2.27 / P3 | the pipeline **consumes** P2.27 primitives and re-declares none of them |

## Batasan & kompatibilitas

- Nol perubahan kontrak publik lama; nol dependensi baru; std + `node:` only.
- Default = perilaku kanonik: an unclassifiable or unverifiable candidate is
  **rejected**, never admitted on a guess.
- Tidak ada second execution engine, tidak ada workflow definition kedua, tidak
  ada microservice-per-route, tidak ada dependensi wajib pada sistem
  terdistribusi atau Redis, tidak ada AI decision-maker (non-goals #95).
- Scope walls: this module does not download, unpack, install or execute an
  artifact; does not verify a signature itself (it consumes the caller's
  provenance verdict); does not schedule resources; does not uninstall, revoke
  or roll back an epoch; and re-declares no vocabulary it consumes.
- Authority: an admission is a **registry** decision. It grants no capability
  by itself — every capability the node requests is still evaluated against the
  foundation ceiling by `plugin-policy.mjs` at request time.

## Artefak

- Implementation: `apps/n8n-lego/src/lego/node-admission.mjs` (contract
  `node.admission@0.1.0`)
- Tests: `apps/n8n-lego/test/lego-node-admission.test.mjs` (41 tests)
- Capability registration: `apps/n8n-lego/src/lego/manifest/domains.json` —
  `node-registry.community-packages` and
  `node-registry.community-node-type-detail` moved from `unsupported` to
  `implemented`; new `node-registry.admission` registered.
- Projections regenerated by `npm run lego:ai`.
