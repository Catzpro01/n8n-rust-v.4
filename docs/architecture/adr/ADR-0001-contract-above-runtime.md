# ADR-0001 — The stable contract lives above JS, Rust and WASM

- **Date:** 2026-09-22
- **Phase:** P2.8-B
- **Foundation version:** 1.0.0
- **Status:** accepted

## Decision

The public contract is the architecture. JavaScript, Rust and WASM are implementation choices underneath it. A LEGO is identified by its contract and version, never by the language it happens to be written in.

## Reason

If the runtime were part of the architecture, every implementation change would be an architecture change: consumers would have to know what a LEGO is written in, and a future Rust implementation would become a migration of the whole system rather than a swap of one component. Putting the contract above the runtime is what makes "replace the implementation, leave the consumers alone" possible at all.

## Alternatives considered

- **Runtime-specific contracts (a JS contract and a Rust contract).** Rejected: two contracts for one promise is two sources of truth, and they drift.
- **A single native ABI everything must speak.** Rejected: it would impose serialization on direct in-process calls, which is a permanent tax paid for a hypothetical future.
- **Defer the question until Rust arrives.** Rejected: by then every consumer would have baked in JS assumptions.

## Consequences

- Contracts must be expressible without TypeScript (see ADR-0002).
- A contract may never expose a runtime detail — no `Buffer` in a signature, no JS-specific error class.
- Adding a Rust implementation later is a version-neutral event if the contract is unchanged.
- `canReplaceImplementation` in `compat.mjs` is the mechanical check.
