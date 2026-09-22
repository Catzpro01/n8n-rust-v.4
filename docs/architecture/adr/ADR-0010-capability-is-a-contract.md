# ADR-0010 — A capability is a contract, not a name and a status

- **Date:** 2026-09-22
- **Phase:** P2.10
- **Status:** accepted

## Decision

Every capability declares its operations, permissions, interaction classes,
lifecycle, availability, criticality, trust, transport, migration state,
degradation behaviour, resources and replacement policy. Each operation declares
its own name, interaction class, permission, idempotency and status — and, for
streams, a backpressure policy with a recorded reason.

Nothing about a capability may be inferred from route existence, file presence
or implementation detail.

## Reason

Until P2.10 a capability was `{id, status}`. That is enough to say a feature
exists and nowhere near enough to negotiate with it. Consumers closed the gap by
inferring:

- operations from **route existence** — so an internal refactor of a URL changed
  what the capability appeared to offer;
- permissions from **implementation** — so a permission check moved when the
  code moved;
- lifecycle from **file presence** — so deleting a file looked like disabling a
  feature;
- transport from **the fact that something answered over HTTP** — so a local
  capability looked remote.

Every one of those inferences breaks silently when an implementation is
replaced, which is the exact operation this architecture exists to make safe. An
inference that survives refactoring is a coincidence; the declaration is the
contract.

## Alternatives considered

- **Derive operations from the route table.** Rejected: it inverts the
  dependency. The contract would then be defined by the compatibility layer,
  which is a temporary strangler surface scheduled for deletion.
- **Keep `{id, status}` and document the rest in prose.** Rejected: prose cannot
  be gate-checked, and an unchecked rule is a suggestion.
- **Generate the declarations from the implementation.** Rejected: the contract
  would then change whenever the implementation did, which defeats the purpose
  of having one.

## Consequences

- 71 capabilities and 139 operations are now declared, all grounded in routes or
  module exports that genuinely exist. Capabilities with no implementation
  declare `[]` operations and keep an honest status.
- Six gate rules (F10–F15) enforce this, and the foundation gate gained its own
  selftest (12 fixtures plus a negative control) so the rules are known to fire.
- Writing the declarations immediately exposed five stream operations with no
  backpressure policy — including the editor push stream, where the practical
  consequence is a slow browser growing the server heap. Each now declares a
  policy and a reason.
- A capability may never claim more trust than the LEGO that owns it, and never
  more availability than its status justifies.

> **Correction (P2.11).** The operation count above read 173 when this ADR was written. The manifest declared 139 then and declares 139 now; the figure was an arithmetic error in the prose, not a change to the data. Superseded numbers are corrected in place and noted rather than removed, because an ADR whose numbers silently change is not a record.
