# Platform, deployment and extension strategy

**Status:** specification (consumption view + project policy). **Owner:** manager for the policy,
agent-2 for the backend declarations it quotes, agent-01 for the frontend consequences.
**Nothing here is an implementation**, and nothing here changes a contract.

---

## 1. Deployment modes (all four are valid)

| Mode | Composition | What it is for |
| :--- | :--- | :--- |
| **Core** | n8n LEGO + AI Foundation | a complete, working editor with **no local inference**; zero-install is a valid installation, not a degraded one |
| **Remote AI** | local UI/orchestrator + remote model and/or remote agent | the low-resource default: the device runs the UI, the workflow core and AI orchestration; inference and heavy execution happen elsewhere |
| **Connected** | n8n + connectors + remote capabilities | tool/app gateways and MCP servers at the edge |
| **Power** | local + remote runtimes + full tooling | everything, still optional |

The **contract does not change between modes** — only the deployment does. That is exactly why
transport, capability, provider and runtime stay separate abstractions (§5).

## 2. Low-resource, mobile and Termux-like environments

The architecture must stay viable on a low-spec laptop, a desktop, a VPS and Android/Termux-like
environments. A small device must be able to run:

```
n8n LEGO core + AI Foundation + remote model + remote runtime
```

without installing every AI component. Concretely, a low-resource deployment avoids: large local
models · unnecessary agent runtimes · eager tool loading · full transcript retention · heavyweight
services · internal HTTP between local LEGO · duplicated databases. Providers are reached remotely,
the context window is bounded, tool and memory lists are paged — and none of that requires a different
contract.

## 3. Performance architecture

For local LEGO the rule is **direct function/local dispatch**: avoid `LEGO A -> HTTP -> LEGO B` when
A and B are local. Remote transport is used only where a real boundary exists. **No default broker, no
default queue, no scheduler inserted into every call path.** The four semantic interaction classes stay
`CALL`, `EVENT`, `STREAM`, `BATCH`; transport is a separate question from semantic interaction, and it
is chosen by eligibility and cost.

## 4. Stream backpressure

Every STREAM capability declares a policy, and **an unbounded default buffer is forbidden**. Declared
today: model streams `block` (a token stream is not silently dropped) and agent streams `coalesce`
(progress events collapse instead of flooding). The recognised policy vocabulary is
`block`, `buffer`, `drop`, `drop-oldest`, `coalesce`, `reject`, `terminate`; a capability that cannot
name its policy is not ready to stream.

## 5. Transport, capability, provider, runtime — never collapsed

| Concern | Question | Why it must stay separate |
| :--- | :--- | :--- |
| interaction class | what kind of exchange is this? | an operation's semantics may not be downgraded by a transport |
| capability | what can be done? | the contract survives a provider change |
| provider | where does a service come from? | 9Router, Composio, GitHub, Hermes … are replaceable |
| transport | how do bytes move? | local dispatch beats HTTP when the boundary is fake |
| runtime | where does execution happen? | remote-only mode must be first-class |

## 6. Rust migration strategy

Rust is a **measured optimisation, not an ideology**. Candidates are evaluated from measurements, not
preferences: execution state · event routing · cancellation · delegation · budget accounting ·
capability enforcement · lightweight persistence/cache · CPU-heavy deterministic operations. Stable
LEGO contracts hide the implementation language, so a migration must be invisible to consumers —
and **external agent runtimes are never rewritten in Rust** (they are reached through an adapter).

## 7. Zero-install and remote-only

`AI Foundation ready · no provider configured` is a **valid** state and the UI says so. A remote-only
installation (UI + workflow core + AI orchestration local, model and agent remote) is equally valid,
and it is the strategy for constrained devices. Neither state may be rendered as an error, and neither
may cause the editor to degrade: the workflow canvas works with zero AI.

## 8. Extension philosophy

Core stays small. Skills, runtimes, MCP servers, providers and node creators are installed
**independently**, and an extension may never silently rewrite core policy. Extension lifecycle:
`registered -> available -> enabled -> disabled -> upgraded -> removed`, with the provenance of an
extension visible wherever it is used (the same rule as a quoted vocabulary word: a consumer must be
able to see who declared what, at which version).

## 9. What this document forbids

No internal HTTP, broker, queue or scheduler between local LEGO · no mandatory runtime or provider ·
no default local model requirement · no vendor-specific field in a business contract · no extension
that bypasses capability, policy or approval · no Rust rewrite without a measurement · no readiness
claim that the gates do not support (`KNOWN_BLOCKERS.md`).
