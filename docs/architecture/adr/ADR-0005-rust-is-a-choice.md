# ADR-0005 — Rust is an implementation choice, permanently subordinate to the contract

- **Date:** 2026-09-22
- **Phase:** P2.8-B
- **Foundation version:** 1.0.0
- **Status:** accepted (Rust currently LOCKED)

## Decision

Rust may only ever appear as an additional implementation behind an unchanged contract. It must clear four hard constraints: a material measured benefit, prebuilt artifacts for every supported platform, an unchanged contract and node identity, and no impact on JS or community-node compatibility. The JS implementation is retained as a permanent fallback. `isRustJustified()` encodes this.

## Reason

The failure mode this guards against is Rust becoming a second architecture — its own protocols, its own contract system, its own build requirements — at which point the project has two systems to maintain and community nodes are second-class citizens. The benefit of Rust is narrow and real (hot deterministic transforms); the cost of letting it define architecture is broad and permanent.

## Alternatives considered

- **Port the backend to Rust.** Rejected by standing constraint, and it would break the entire community-node ecosystem.
- **Rust-first for new components.** Rejected: "prefer Rust" becomes "require a toolchain", and an end-user device must never need a compiler.
- **Ban Rust entirely.** Rejected: it is genuinely the right tool for a hot deterministic transform. The answer is a justification gate, not a ban.

## Consequences

- A migration requires an ADR with a measured benefit; "it is Rust" is explicitly not a reason.
- Equivalence must be proven by replay (capture -> replay -> compare) before rollout.
- Rollout is canary -> gradual with rollback armed; rollback means selecting the JS implementation, which is never deleted.
- Today: locked. No Rust file was touched in this phase.
