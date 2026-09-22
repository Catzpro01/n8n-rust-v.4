# ADR-0008 — Retire an allowance with a narrow contract; never widen the allowlist

- **Date:** 2026-09-22
- **Phase:** P2.9
- **Status:** accepted

## Decision

A boundary violation is resolved by publishing the **smallest contract that
satisfies the real need**, never by adding to an allowlist. A1 and A2 were
retired this way and deleted from the manifest. A3 was narrowed and explicitly
**not** retired, because the only honest fix belongs to another agent's phase.

## Reason

The characteristic way a component architecture dies is not a dramatic breach.
It is: boundary violated → allowlist widened → gate green → repeat. Each step is
locally reasonable and the end state is a dependency graph with a decorative
gate on top.

A1/A2 were a good illustration. They looked like coupling between compatibility,
settings and auth. They were actually an *absence*: auth published nothing, so
two consumers reached inside for `toPublicUser` and `hasOwner`. Publishing those
two functions — and only those two — removed the violation without granting
anything new.

A3 is the opposite case, and it is why "retire every allowance" is the wrong
target. `newExecutionId` mutates a process-local counter that is scale-out
blocker S2. A storage contract that re-exported it would delete the allowance,
turn the gate greener, and leave the system exactly as unsafe. That is worse
than the allowance, because the allowance is at least visible.

## Alternatives considered

- **Add auth to the compatibility allowlist.** Rejected: the violation persists,
  now with permission.
- **Expose the whole auth module as public.** Rejected: publishing
  `createSession` and `signToken` to make a projection reachable grants
  authority to every consumer that only wanted a name.
- **Move `toPublicUser` into compatibility.** Rejected: user projection is
  agent-3's semantics; relocating it moves the coupling rather than removing it.
- **Retire A3 with a pass-through storage contract.** Rejected as
  gate-gaming — see above.

## Consequences

- The auth contract is a dependency-free **leaf**, because
  `auth/routes.mjs` depends on compatibility and a `compatibility → auth` edge
  would be a cycle. The gate caught this within seconds of the attempt.
- `test/lego-boundary.test.mjs` pins every surface as an upper bound: the auth
  contract is exactly two functions, A3 is one symbol in one file, and the
  allowance count may not grow.
- Allowance count: 3 → 1. Direction of travel is one-way by test.
- A3 stays visible, owned by agent-5, tied to the scale-out blocker it causes,
  and cannot be retired by paperwork.
