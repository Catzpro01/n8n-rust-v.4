# Frontend constitution — the hard stops (agent-1)

**Status:** hand-written, agent-1. **Canonical for:** the frontend branch's non-negotiable rules, the
frontend half of L0. The backend L0 is the generated `.ai/constitution.md` (Agent 2's tool); this
document adds what the frontend may not talk itself out of. Neither overrides the other: where they
touch the same subject, the stricter rule wins.

1. **Rust is LOCKED.** No Rust, no WASM, no FFI in the frontend or its adapters without a separately
   approved phase and measured benefit. JavaScript is the implementation.
2. **No framework imports.** The frontend package is framework-neutral: no React, no Svelte, no Web
   Components, no runtime dependency of any kind. A UI framework may *consume* the package; the
   package never depends on one.
3. **No HTTP between local LEGO.** Local communication is a direct in-process call. Network transport
   is for real boundaries only — never a broker, never a queue between local modules.
4. **Never push to `main`.** `main` is protected; work lands on the assigned session branch, and only
   through an explicit, owned change.
5. **Only the assigned paths.** The frontend does not edit another agent's files: `tests/integration/boundary_audit.py`
   belongs to **agent-05**, and backend manifests, contracts and gates belong to agent-2. A shared file
   is touched minimally and the touch is documented.
6. **Declared ≠ installed ≠ loaded ≠ active.** Availability states are never collapsed: a capability
   that is declared but not installed renders as such, and the UI never implies more than the
   declaration says.
7. **Never chain-of-thought.** No private reasoning is rendered, stored, requested or inferred.
   Decisions carry summaries, evidence, risk, approval state and artifacts.
8. **Never fabricate a number.** Token counts are `reported` or `estimated`; a message count is never
   presented as model input; a missing value renders as unknown, never as zero.
9. **Presentation names are never silent aliases.** `executions` is a declared surface alias of the
   canonical `execution`; the UI never invents a second name for the same concept.
10. **No readiness claim the gates do not support.** Scale-out is **NOT READY** while the class-A
    blockers stand, and the AI Foundation is **contract-only**.
