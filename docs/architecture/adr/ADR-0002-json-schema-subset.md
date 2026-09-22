# ADR-0002 — Contracts are described with a JSON Schema subset, and no generator is built yet

- **Date:** 2026-09-22
- **Phase:** P2.8-B
- **Foundation version:** 1.0.0
- **Status:** accepted

## Decision

Contract shapes are described as data using a JSON Schema (draft 2020-12) subset, stored beside the contract. No code generator is built in this phase. Schemas are optional now and mandatory for any contract that gains a second binding.

## Reason

The contract must be readable by a future Rust or WASM binding, so TypeScript cannot be the source of truth. JSON Schema is plain data, needs no build step, and has generators in every target language on the day we actually need them. Building a generator now — before a single contract has a second binding — would be building a tool for a user who does not exist yet.

## Alternatives considered

- **TypeScript types as the source of truth.** Rejected: not language-neutral; makes TS the architecture.
- **Protobuf / Cap'n Proto.** Rejected: imposes a serialization model on in-process calls and adds a compiler.
- **OpenAPI.** Rejected: HTTP-shaped by construction, which breaks transport neutrality.
- **A bespoke IDL.** Rejected: maximum cost, no ecosystem, no need.

## Consequences

- In-process JS calls pay nothing: validation is development-time only.
- Trust boundaries (remote, worker, WASM) validate on entry, always.
- `json` as a type is an escape hatch that a Rust binding cannot type; each use is debt.
- A generated artifact may never become the source of truth.
