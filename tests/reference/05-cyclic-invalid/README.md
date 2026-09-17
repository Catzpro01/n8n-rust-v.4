# Negative reference fixture: cyclic workflow

This fixture intentionally contains `A -> B -> C -> A` on `main`.

It is consumed by both:

- `tests/compatibility/contract_conformance.mjs`, which must reject the cycle instead of treating every fixture as acyclic;
- `crates/n8n-workflow/tests/conformance.rs`, which drives the JSON through the Rust validation port and asserts `detect_cycles` returns an error.

The node and connection shapes remain valid. Only the Validation LEGO's acyclicity rule is expected to fail.

This is a **new-capability contract fixture**, not a claim that the n8n 2.9.4 Workflow class rejects cycles: the reference allows runtime loops. Its expected rejection is sourced from `contracts/validation.contract.md` §4.4/§11.8 and the standalone Validation implementation in `tests/reference/agent-4/validation/workflow-rules.ts`.
