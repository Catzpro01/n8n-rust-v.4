# ADR-0007 — Four interaction classes, one local dispatcher, zero transports

- **Date:** 2026-09-22
- **Phase:** P2.9
- **Status:** accepted

## Decision

Backend LEGO communication is described by exactly four interaction classes —
CALL, EVENT, STREAM, BATCH — implemented in `src/lego/interaction.mjs` as
**semantics plus a local dispatcher, containing no transport whatsoever**. A
cross-process or remote binding registers the same provider shape with a
different `transport` value; consumers do not change.

## Reason

Two failure modes had to be avoided simultaneously.

The first is turning every LEGO into an HTTP endpoint "to be ready for
microservices". Internal HTTP between two objects in one process is the most
expensive possible way to call a function, and on a Termux device that cost is
not theoretical. ADR-0004 already ruled it out.

The second is subtler and is why a dispatcher exists at all. If consumers import
their dependencies directly, then the *consumer* chooses the implementation, and
implementation replacement becomes a repo-wide edit. That silently invalidates
ADR-0001 (contract above runtime) and ADR-0005 (Rust as a swappable
implementation) — both claim you can change an implementation without touching
consumers, which is untrue the moment the call site names the module.

One `Map.get()` plus a function call buys that guarantee back. That is the
entire cost, and it is what the replacement test demonstrates.

## Alternatives considered

- **Direct imports everywhere.** Rejected: cheapest at runtime, but makes
  implementation replacement a rewrite, and the architecture's central promise
  becomes unenforceable.
- **An in-process message bus for everything.** Rejected: turns a stack trace
  into a correlation-id hunt, and makes a synchronous call asynchronous for no
  semantic reason.
- **Three classes (drop BATCH).** Rejected: node-type resolution is genuinely
  N-at-a-time, and expressing it as N calls loses the amortisation that is the
  whole point.
- **Let each LEGO pick its own transport.** Rejected: transport choice would
  leak into contracts, which is exactly what transport neutrality forbids.

## Consequences

- Adding a worker or remote binding requires no consumer change — that is the
  test of whether this decision held.
- STREAM operations must declare a backpressure policy at registration time; an
  undeclared policy means unbounded buffering, which fails slowly and invisibly.
- EVENT never throws at the emitter and never awaits handlers, so one broken
  subscriber cannot stall a producer.
- BATCH returns per-item outcomes rather than failing wholesale, because the
  callee already knows which item failed and the caller should not have to
  re-derive it.
