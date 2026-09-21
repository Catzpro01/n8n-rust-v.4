# ADR-0011 — The repository is the project memory, and it is generated

- **Date:** 2026-09-22
- **Phase:** P2.11
- **Status:** accepted

## Decision

The project's architecture, roadmap, governance and current status are declared
in manifests under `apps/n8n-lego/src/lego/manifest/` and **generated** into
`.ai/master/` by `tools/lego/ai-pack.mjs`. A new agent must be able to answer
what the project is, what each LEGO owns, what is implemented, what is blocked
and what comes next by reading the repository alone, with no access to
conversation history.

Three new authoritative declarations were added:

| File | Declares |
| --- | --- |
| `manifest/ai-lego-set.json` | the fifteen official AI/Agent LEGO |
| `manifest/project-governance.json` | the development workforce, control planes, principles and blockers |
| `manifest/reference-scenarios.json` | seven end-to-end contract walkthroughs |

Eleven documents are generated from them. None may be edited by hand: the
generator deletes `.ai/` before writing, and `npm run lego:ai:check` fails the
build when the output is stale.

## Reason

Prose drifts from data, and it drifts silently. This phase produced the proof
while it was being written: the repository asserted **173 operations** in
`BACKEND_LEGO.md`, in `ADR-0010` and in the P2.10 evidence file. The manifest had
declared **139** the entire time — 82 capabilities, 62 of which declare
operations. Nothing had regressed; `manifest/domains.json` is byte-identical to
its P2.10 state. A human had done arithmetic once, written the result in three
places, and every later reader treated the agreement between those three places
as corroboration.

That is the general failure. A number maintained by hand is wrong eventually,
and copies of it make the error look verified. The same fate was already visible
for the domain count, which had been described as 25 while the manifest declared
26.

The fix is not better proofreading. It is removing the opportunity: the count is
now computed from the manifest at generation time and appears in
`CURRENT_STATUS.md`, so it is either correct or the build is red.

## What this does not claim

Generation is not implementation. Every one of the fifteen AI/Agent LEGO except
Capability is `contract-only` or `planned`, and the generated documents say so on
every page. There is no inference, no agent loop, no MCP runtime, no vendor
adapter and no Agent Machine runtime in this repository.

## Consequences

- **The declaration is the source; the document is a projection.** Changing an
  architectural fact means editing a manifest, not a Markdown file.
- **A new gate rule, F17 `ai-set-reconciliation`,** fails the build when an
  official AI LEGO shares a name with a core domain without declaring how the
  two reconcile. This is what stops `ai-workspace` from appearing beside
  `workspace` and quietly meaning something else. Two selftest fixtures prove
  F17 fires; the foundation selftest is now 15/15.
- **A new test file, `test/lego-ai-set.test.mjs` (37 tests),** asserts the set's
  internal consistency: no dangling dependency, no undeclared phase or owner, no
  cycle, no fabricated version on an unpublished contract, no forward phase
  dependency that is not declared with its degradation, and no scenario reaching
  for an undeclared concept. Five of those tests are negative proofs that plant
  the exact defect and require detection.
- **Blockers are asserted, not described.** A test requires the two class-A
  storage blockers to be declared open. Closing one costs a deliberate edit to
  an assertion rather than a quiet status flip in prose.
- **Superseded numbers are corrected in place with a note,** never deleted. An
  evidence file whose figures silently change is not evidence.

## Alternatives considered

**Write the master plan as hand-authored Markdown.** Faster, and this is what
the documents would have been if the operation count had not just demonstrated
the cost. Rejected: hand-written architecture documentation is a second registry,
and a second registry always drifts from the first.

**Pin the numbers in tests instead of generating them.** Rejected for a reason
this phase also demonstrated: a test pinning `ERROR_CONTRACT_VERSION` to exactly
`1.0.0` failed when XA-5 legitimately published eleven new codes as a MINOR bump.
A pinned value trains the reader to edit the assertion rather than think about
it. That test now asserts the real invariant — the MAJOR version — and lets
compatible additions through.
