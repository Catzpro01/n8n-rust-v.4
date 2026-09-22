# ADR-0006 — Scale-out blockers stay visible and owned rather than being quietly fixed or quietly hidden

- **Date:** 2026-09-22
- **Phase:** P2.8-B
- **Foundation version:** 1.0.0
- **Status:** accepted

## Decision

The two `src/store.mjs` blockers (a process-local execution-id counter and local JSON as the system of record) remain in place, classified, owned by agent-5 and scheduled for P8. `tools/lego/scale-out-readiness.mjs` continues to report them, and `.ai/scale-out.md` states plainly that the backend is not scale-out ready.

## Reason

There were two tempting wrong answers. Fixing the blockers now would mean implementing the storage domain, which is explicitly out of scope and would be a feature implementation dressed as architecture. Hiding them behind an exception annotation would make the gate green and the system dishonest — and a green gate that lies is worse than a red one, because it stops anyone looking.

Keeping them visible, owned and dated is the only option that is both in scope and true.

## Alternatives considered

- **Fix now.** Rejected: out of scope, and storage design is a P8 decision.
- **Annotate as accepted.** Rejected: they are not acceptable, only deferred. `declared-exception` would launder a blocker into a non-issue.
- **Remove the probe.** Rejected: deleting the thermometer does not lower the temperature.

## Consequences

- Any claim that the system is scale-out ready is contradicted by a tool in the repository.
- The future solution is documented as a contract change, not a rewrite: execution-id allocation and the system of record move behind the storage contract, local JSON -> SQLite -> Postgres.
- Whether these blockers should pull storage work ahead of P8 is one of the open Manager arbitration items.
