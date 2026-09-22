# MCP and runtime adapters

**Status:** planning. **Published:** the MCP vocabulary block and the runtime contract
(`ai-foundation.json` mcp block, `ai.agent-runtime`). **Not published:** a capability of MCP's own
(**XA-16**), any MCP client/server, any adapter implementation.

---

## 1. MCP is interoperability, not business architecture

```
external world  <->  MCP adapter  <->  LEGO capability contract  <->  implementation
```

Rules, quoted from the canonical block and enforced in the frontend:

1. **Internal calls never travel over MCP.** One LEGO calling another uses the declared interaction
   classes (CALL / EVENT / STREAM / BATCH) and the cheapest capable transport. MCP is for the *edge*.
2. **MCP concepts map onto the tool gateway.** A tool is a tool, a resource is a resource, a prompt is
   a prompt — the gateway's operations (`tools.list`, `tool.describe`, `tool.call`, `resources.*`,
   `prompts.*`) are the contract; MCP is a provider reaching them.
3. **Exports are explicit.** A server exports an individual, named list — never "everything".
4. **No transport details in a capability.** The UI shows *what* a capability is; server, transport,
   health and tools-loaded live in advanced details.
5. **Lazy discovery.** Capability first (`github.search — MCP`); a server's tools load when asked,
   paged, never as a wall of hundreds of tools.
6. **Authorization is a real state.** `permission-required` is its own connection state; the UI never
   implies an unauthenticated server is "offline".

MCP object roles the frontend can render: `client-capability`, `server-capability`, `tool`,
`resource`, `prompt`, `connection`, `authorization`, `availability` (a declared *view* set, mapped
into the canonical `mcpConcept` words — `vocabulary.mjs` `mcpObjectView`). Connection words:
`connected`, `unavailable`, `permission-required`, `capability-unsupported`.

## 2. Runtime adapters

A runtime becomes replaceable because the **adapter contract** stays stable:

| Concern | Declared | Rule |
| :--- | :--- | :--- |
| identity | runtimeId, kind, version | a vendor name is data, never a field |
| reachability | availability, transport, locality | locality in `in-process`, `local-process`, `local-network`, `remote` |
| capability | `supports` (session, background, stream, cancellation, delegation) | absent support = absent action, never a silent no-op |
| lifecycle | create, start, send, pause, resume, cancel, status, stream, artifact, close | `pause` optional (`lego.operation_unsupported`); `cancellation: false` legitimate |
| evidence | artifacts + events | normalized into `ai.agent-events`, owner stays n8n |

**External runtimes are never rewritten in this project.** n8n retains ownership of task, policy,
workspace boundary, approval, artifact references, event normalization, the context contract and
resource accounting — that ownership is what prevents vendor lock-in.

## 3. What a user sees

- Runtime: `Runtime · <name> · Remote · Connected`; advanced: kind, version, supports, locality,
  resource cost, health. A runtime is **never mandatory**: `Local` is a legitimate answer and the
  local-only instance renders complete surfaces.
- MCP: a capability row with a `— MCP` source label; advanced: server, transport, health, tools
  loaded, availability.
- Both: a state, not a mystery — `optional-absent` says "not configured, and that is fine",
  `degraded` says what still works, `runtime.unavailable` says what is paused.

## 4. Non-goals

No MCP server or client implementation, no adapter runtime, no simulation runtime, no "MCP-first"
architecture, no internal HTTP between local LEGO, and no surface whose default state is "no runtime,
therefore broken".

## See also

- `AI_RUNTIME_AND_PROVIDER_PLAN.md`
- `PROVIDER_TAXONOMY.md`
