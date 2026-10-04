# Physical LEGO isolation — staged migration

Date: 2026-10-04  
Baseline: `554ebd61b259759047ee5f19f6f90399eaeaf526`  
Scope authorized by repository owner: **all project layers, implemented incrementally through PRs**.  
Status of this change: **stage 1 only; draft pending remote CI and maintainer review**.

## 1. Decision and non-goals

Every implemented LEGO must have its own physical implementation root and a public contract. External consumers may use only that contract. A folder declaration, an empty directory, a capability entry, or a passing test of a declaration is not proof of a physically separated implementation.

This is a development/ownership boundary, not a request to turn every LEGO into a microservice. Keep in-process calls and existing runtime performance characteristics; do not introduce IPC or JSON serialization on the execution hot path merely to enforce boundaries. Preserve n8n 2.9.4 behavior and UI appearance. Rust remains active. Do not patch the vendored reference tree.

The owner authorized the target for the whole project, not a claim that the entire migration is complete in this PR. This document does not invent a new program/milestone namespace or increase delivery percentages.

## 2. Target layout and enforcement

For a backend domain, prefer its existing meaningful domain folder when possible:

```text
apps/n8n-lego/src/<domain>/
  contract/       exact public entry points, exported types/models/errors
  internal/       private implementation and adapters
```

Domain-local unit tests may be colocated where the test runner supports them. Cross-domain integration/contract tests remain under `apps/n8n-lego/test/` and name the owning domain. Keep the existing canonical `domains.json` and `contract-lock.json` as the single source of ownership/version truth rather than adding a second competing registry per folder.

For Rust, use the existing crate as a physical boundary when it matches a LEGO; otherwise establish a private module tree with an explicit public facade before considering an additional crate. For frontend, use separately owned implementation folders and explicit public entry points; a real build/loader and behavior evidence are required before claiming independent UI delivery.

Required final-state rules:

1. Every production source file has exactly one effective owner. Distinguish logical parent/child ownership from competing ownership.
2. Every implemented LEGO has an identifiable, exclusive implementation root. Existing nested LEGO identities must retain explicit parent-child mapping.
3. External consumers cannot import private implementation, including the composition root. Composition occurs through published factories/adapters.
4. Dependencies are explicit, direction-checked, and acyclic; no hidden dependency through a shared utility dump.
5. Contracts are versioned and tested. Public additions/removals follow the existing compatibility policy.
6. Compatibility shims contain forwarding exports only, are explicitly enumerated, and have no independent state/logic. Final cutover removes them only after consumers and packaging have migrated.
7. A migrated LEGO cannot spill implementation back into an old path. Boundary tests must demonstrate rejection, not just acceptance.
8. Runtime permissions, credential isolation and process sandboxing remain separate security controls. Static architecture checks do not sandbox hostile JavaScript.
9. Generated AI documentation is regenerated from the canonical manifests; it is never manually relabeled to look complete.
10. Browser behavior, deployment artifacts, configuration paths and rollback remain regression-tested.

## 3. Delivered in stage 1: platform-kernel

```text
apps/n8n-lego/src/
  platform-kernel/
    contract/
      config.mjs
      logger.mjs
    internal/
      config.mjs
      logger.mjs
  config.mjs       # forwarding-only historical API
  logger.mjs       # forwarding-only historical API
```

- Moved configuration and logging implementation into the physical root; no duplicate implementation remains at historical paths.
- Published canonical contract entry points and moved six runtime consumer files to them: server, engine, frontend host, scope readers, and CLI.
- Retained two historical public paths for compatibility with existing callers/tests/install scripts.
- Bumped `kernel.platform` from **1.0.0 to 1.1.0**, additively. Existing symbols and function identities are unchanged.
- Adjusted `APP_ROOT`/`REPO_ROOT` calculations for the deeper directory. Verified repository and installed-package layouts; the editor still resolves from the package's `node_modules`.
- Added opt-in `physical` metadata to the canonical domain entry. Only this domain is enrolled in the new physical-layout check in this PR.
- Added **R10 physical-layout** to the existing architecture gate: physical roots, public entry placement, implementation placement, and forwarding-only historical shims.
- Made **R4 internal-import** strict for a physically migrated target even when the consumer is the composition root or legacy aggregate. The two existing legacy allowances are not widened.
- Extended static import scanning to include multiline imports/re-exports. It now exposes an existing ownership mismatch: `src/lego/agent-machine-runtime.mjs` was implicitly attributed to `lego-foundation` although it imports the AI Agent Machine contract. This PR explicitly assigns that file to `ai-foundation`; no runtime logic or public API is changed and no reverse dependency/cycle is introduced.
- Relocated existing scale-out exception file references to the new implementation path. The underlying limitations are **not** declared fixed by a file move.
- Updated boundary tests to inspect real implementation files recursively rather than assume every ownership entry is a file. The kernel retains a maximum of three implementation files; its current two implementations are config and logger.
- Regenerated the five affected `.ai/` projections through the repository generator.

### Enforcement boundary in this stage

The existing gate scans backend `src/` and `bin/` `.mjs` imports and now handles multiline static imports and literal dynamic imports. It is not a complete JavaScript parser and does not resolve computed imports, arbitrary loader aliases, or runtime-generated code. Cross-package/frontend/Rust isolation must be addressed in their migration stages, rather than claiming this backend checker covers them. New module systems or loading mechanisms require corresponding fail-closed analysis before admission.

The stage-1 kernel has no cross-domain dependency. This PR adds no dynamic loader, network adapter, runtime dependency, workflow change, or Rust code. It does not yet certify the 25 other backend registry entries as physically isolated.

## 4. Whole-project work breakdown

These are migration work packages, **not new canonical program/slice IDs**. Each subsequent PR must be reconciled with the existing project register and must identify its own owner, dependencies, evidence and rollback.

| Work package | Domains/components | Required result |
|---|---|---|
| Initial kernel | `platform-kernel` | This PR: implementation root, stable facades, strict target boundary, regression evidence |
| Contract infrastructure | `lego-foundation`, `compatibility` | Separate registry/versioning/transport mechanics from product and AI logic; publish only deliberate contract entry points |
| Security | `auth`, `auth.identity`, `credentials` | Dedicated implementation roots and identity mapping; no consumer imports session/vault/key internals; negative authorization and secret-handling tests |
| Workflow runtime | `workflow`, `execution`, `node-registry`, `dynamic-parameters`, `webhook` | Extract real implementations from shared/legacy files; preserve behavior; inject dependencies via public contracts |
| State and operations | `storage`, `worker`, `realtime`, `settings`, `workspace`, `observability`, `data-tables` | Separate persistence and operational ownership, with concurrency/recovery evidence; do not confuse movement with fixing known storage blockers |
| Hosting and strangler cleanup | `editor-ui-host`, `runtime-host`, `legacy-rest` | Composition through public factories only; legacy area shrinks; compatibility paths are enumerated then retired safely |
| Reference templates | `reference-lego`, `.validation`, `.validation.schema`, `.repository` | Preserve example hierarchy, separate child internals/contracts, and prove sibling/ancestor boundary checks |
| AI family | Official AI LEGO set listed below | Reconcile logical identity and current ownership before physical extraction; no duplicate owner for workspace/node capabilities |
| Rust engine | Existing crates and registry components listed below | Crate/module public facades, private implementation, dependency graph checks, compile-fail/visibility tests and behavior conformance |
| Frontend | `ui-frontend` and 19 declared sub-LEGOs | Actual owned source/build boundaries, not empty directories; preserve visual and behavioral parity before switching from upstream bundle |
| Final cutover | All layers | No untracked exceptions or duplicate implementations; remove obsolete shims; packaging, browser, rollback and release gates pass |

### AI identities must not be lost under one umbrella

The backend registry contains `ai-foundation`, but the separate canonical AI LEGO set declares these 15 identities:

`ai-foundation`, `skill`, `agent-machine`, `memory`, `workspace`, `context-session`, `translation`, `node-creator`, `capability`, `mcp-adapter`, `runtime-adapter`, `artifact`, `approval`, `agent-event`, `token-usage`.

These are not 15 additional independent backend domains by default. Reconcile their contracts/owners against the existing backend domains and surface aliases before creating folders. In particular, do not silently move workspace ownership into AI Foundation or count the same capability twice.

### Rust and orchestration mapping

The `.arena` registry includes `workflow`, `node`, `connection`, `validation`, `execution_data`, `expression`, `trigger`, `webhook`, `scheduler`, `persistence`, `credentials`, `api`, and `manager`. The last is engineering orchestration, not a runtime product LEGO. `common` is a shared primitive dependency, not permission to collect unrelated business logic.

Eight existing crates are retained as the starting point: `n8n-common`, `n8n-workflow`, `n8n-connection`, `n8n-validation`, `n8n-node-model`, `n8n-execution-data`, `n8n-expression`, and `n8n-nodes-rust`. A single registry LEGO can map to more than one crate, and multiple logical components can currently share a crate. The Rust work package must make this mapping explicit and test visibility instead of equating crate count with LEGO count.

### Frontend inventory and constraint

Top-level units: `auth`, `navigation`, `dashboard`, `settings`, `workflow-editor`, `node-picker`, `credentials`, `executions`, `notifications`, `dialogs`, `error-surfaces`.

Nested units: `settings.general`, `settings.security`, `settings.localization`, `settings.localization.rtl`, `workflow-editor.canvas`, `workflow-editor.node-panel`, `workflow-editor.parameter-panel`, `workflow-editor.execution-panel`.

All 19 are declared in the catalog at the baseline. The pinned n8n UI remains the runtime reference. Creating these directories alone does not isolate the shipped UI. Before replacing its implementation, establish route/state/interaction contracts, packaging/loader strategy, upstream licensing boundaries, visual parity, and browser regression evidence. Do not alter upstream reference files to simulate completion.

## 5. Acceptance checklist per migration PR

- [ ] Mapping identifies old paths, physical root, public surface, private implementation, owner, version and consumers.
- [ ] Implementation is actually relocated, not copied or hidden behind a facade that still points to a shared legacy body.
- [ ] All known consumers use public contracts; historical paths are forwarding-only and explicitly tracked.
- [ ] Negative tests reject private imports, undeclared dependencies, cycles and implementation escaping its root.
- [ ] Domain-specific contract/behavior tests pass, including configuration/resource resolution after movement.
- [ ] Packaging includes every moved file and can boot from the distributable, not just the source tree.
- [ ] Relevant browser/CLI/runtime compatibility tests pass.
- [ ] Manifest, contract lock, ownership and generated projections agree.
- [ ] No existing security or architecture assertion is disabled to make the migration green.
- [ ] Independent review, remote CI and explicit rollback evidence exist before merge.

## 6. Local evidence for stage 1

Validation used selected files read through GitHub's API at the baseline SHA. No clone, git checkout or history download was used. Catalog assets were provisioned with the repository's pinned fetch script (`n8n-nodes-base@2.9.1`); selected upstream permission fixtures were read through the API for differential tests. Test assets and dependency caches are not included in the PR.

Runtime: **Node v22.23.3**, Linux sandbox.

| Check | Result |
|---|---|
| Backend architecture gate | PASS, no violations |
| Architecture gate selftest | PASS, 26/26 |
| Capability conformance | PASS |
| Foundation gate | PASS |
| Foundation negative selftest | PASS, 15/15 |
| Scale-out declaration check | PASS; known blockers remain declared, not solved |
| Generated AI pack drift check | PASS |
| App unit + integration suite, `apps/n8n-lego/test/*.test.mjs` | **3,158 passed, 0 failed, 0 skipped** |
| Frontend contract/unit suite, `packages/frontend-lego/test/*.test.mjs` | **1,041 passed, 0 failed, 1 skipped** |

The frontend skip is the existing alternate-tree assertion that assumes `ai.memory` is absent; its complementary assertion runs on this tree, where that contract is present. No test was newly disabled in this change.

New kernel isolation tests are included in the app suite and exercise legacy export identity, installed-package root resolution, configuration behavior, forbidden internal imports (including multiline, literal dynamic, composition-root and legacy callers), forwarding-only shims, and physical placement.

The first broad run exposed missing files in the selectively assembled validation workspace plus two test assumptions affected by the refactor. Required files were fetched, ownership/layout assertions were updated without weakening their intended bounds, and the suites above were rerun to completion. Failed intermediate runs are not represented as successful evidence.

### Not yet verified

Remote GitHub CI, browser E2E, Docker/tarball release packaging, Windows execution, and Rust conformance/build are **not claimed by this local evidence**. The PR stays draft pending relevant checks and maintainer review. No workflow runner configuration or required gate was modified.

## 7. Rollback and completion reporting

Rollback stage 1 by reverting the single migration commit through a reviewed PR. No database migration or stored configuration format changes are included. Do not delete the historical config/logger facades independently of their callers.

Report progress as a matrix of identities with evidence states: `mapped`, `physically-separated`, `boundary-enforced`, `behavior-verified`, `release-verified`. Those are migration evidence labels, not replacements for the project's canonical delivery status vocabulary. A domain is not complete merely because its folder exists.

**Stage-1 result:** one backend LEGO's implementation physically separated and boundary-enforced; whole-project migration remains in progress. The two compatibility shims are intentional transition debt, not independent implementations.
