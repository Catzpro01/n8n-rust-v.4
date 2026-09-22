# ADR-0009 — Provider-neutral AI contracts are written before any adapter

- **Date:** 2026-09-22
- **Phase:** P2.10
- **Status:** accepted

## Decision

The AI Foundation enters the repository as **contracts only**: a taxonomy, a set
of operation vocabularies, and machine-checked rules. No inference, no agent
runtime, no gateway client and no MCP adapter is implemented. Vendor names may
appear only inside `examples` arrays, and a gate rule (F15) enforces it.

## Reason

The normal sequence for AI integration is: one vendor's SDK arrives first, its
shape becomes the internal model, and every later provider is bent to fit a
competitor's abstractions. The damage is not the dependency — it is that the
first vendor's *concepts* become the architecture, and the cost of the second
provider is a refactor rather than an adapter.

Writing the neutral contract first inverts that. The first adapter becomes an
implementation of an existing contract rather than the definition of one.

Keeping five concepts separate is what makes it work:

```
capability     WHAT the system can do        (owned by a LEGO, stable)
implementation HOW it is realised            (JS or Rust, swappable)
provider       WHERE it is sourced from      (model / tool / application)
transport      HOW bytes move                (in-process / worker / remote / mcp)
runtime        WHERE an agent executes       (agent / simulation runtime)
```

A capability named `composio.github.repo.read` fuses three of these into one
identifier, and from then on the same logical capability reached natively is a
*different* capability with a different name.

## Alternatives considered

- **Write the contracts when the first adapter is built.** Rejected: that is
  precisely the moment the vendor's shape is most persuasive and least
  questioned.
- **Adopt MCP as the internal model.** Rejected, and made a rule. MCP is a good
  interoperability protocol; as an internal application architecture it would
  make every local call speak a remote protocol and would tie internal
  refactoring to an external spec's release cycle. It is an edge adapter.
- **Model GitHub as a Composio tool.** Rejected: it would make a first-class
  native integration depend on a third-party gateway. GitHub is an
  application-provider whose capabilities can be satisfied natively *or* through
  a gateway; both are bindings of one capability set.
- **Skip the contracts until AI work is actually scheduled.** Rejected: the
  contracts are what let the work be scheduled without a redesign, and they cost
  nothing at runtime because nothing loads them.

## Consequences

- A new provider is an adapter, not a refactor.
- `contract-only` became a distinct registry status, because "the contract is
  fixed and testable but nothing implements it" is a genuinely different promise
  from "planned".
- The AI Foundation is a dependency-free leaf owned by **manager**, not by
  whoever writes the first adapter. Shared contracts acquire accidental owners
  otherwise.
- Zero-install — foundation present, no provider configured — is a declared
  valid state rather than an error, so a provider can later be attached as
  configuration.
- Nothing here runs. If it ever does, that is a bug this ADR authorises anyone
  to revert.
