# ADR-0004 — Direct in-process calls are the default; no internal HTTP without a real process boundary

- **Date:** 2026-09-22
- **Phase:** P2.8-B
- **Foundation version:** 1.0.0
- **Status:** accepted

## Decision

LEGOs in the same process communicate by direct function call. HTTP, message buses and serialization are introduced only where a real process boundary exists. The four communication modes (call, event, stream, batch) are transport-independent descriptions of semantics, not of plumbing.

## Reason

Internal HTTP between two objects in one process is the most expensive way to call a function: it adds serialization, a loopback network hop, error translation and a new failure mode, in exchange for the *appearance* of separation. Isolation comes from enforced boundaries — which the architecture gate already provides by reading imports — not from a transport. The gate proves the boundary at build time and costs nothing at runtime.

## Alternatives considered

- **Internal HTTP everywhere "to be ready for microservices".** Rejected: pays a permanent runtime cost for a migration that may never happen, and on a Termux device that cost is not theoretical.
- **A mandatory in-process message bus.** Rejected: turns a stack trace into a correlation-id hunt.
- **Always-on plugin runtimes.** Rejected: violates the activation model — nothing is forced into RAM.

## Consequences

- The envelope must be zero-cost on direct calls: metadata passed as a field, not serialized.
- When a real boundary does appear (worker, remote), the same logical contract gets a new binding; consumers do not change.
- The preferred escalation is: direct call -> explicit contract -> lazy runtime -> worker only when necessary.
