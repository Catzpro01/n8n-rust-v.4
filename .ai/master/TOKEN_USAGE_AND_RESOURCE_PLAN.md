# Token usage, resources and the economy of context

**Status:** specification. **Canonical source today:** `ai.model-gateway.countTokens` +
declared costs (`ai.foundation@1.0.0`). **A usage capability is XA-17
(`publicationPending`).** Nothing here fabricates a number.

---

## 1. Three counts, never confused

| Count | Meaning | Where it comes from |
| :--- | :--- | :--- |
| **Message tokens** | tokens of the visible message | the message's own count (`· 1 token`, `· 8 tokens`) |
| **Model input tokens** | everything actually sent: system instructions, conversation, memory, tools, context, current message, other provider context | reported by the call, or `estimated` |
| **Output tokens** | the generated response | reported by the call, or `estimated` |

Worked example, and the honesty rule that goes with it:

```
Message      1 token          <- what the user sees inline
Model input  1,847 tokens     <- advanced details only
Output       8 tokens         <- advanced details only
```

The UI must never present a message token count as if it were the model input count. Advanced details
show Message / Context / Output / Total / **Source**, and `source` is `reported` or `estimated` —
never "precise". A count nobody reported is `estimated`, or it is not shown at all. Provider-reported
costs are never normalised across providers, because providers do not report the same categories.

## 2. Token telemetry is a resource signal, not decoration

Consumption feeds: the context manager (when to compact or roll over), the resource manager, agent /
task / session budgets, provider usage accounting, and runtime selection where appropriate. It informs
decisions such as preferring a cheaper model, reducing tool discovery, reducing memory loading,
switching runtime, or stopping an over-budget task — always through **policy**, never by a hidden
heuristic in the UI.

## 3. Budgets

Delegation declares budgets (`maxTokens`, `maxToolCalls`, `maxDurationMs`, `maxChildren`) — these are
**limits, not consumption**. A budget is clamped to the parent's; the UI shows remaining budget only
when the consumption it subtracts from is reported, otherwise it shows the limit and says so.

## 4. Resource-aware operation

Declared dimensions: cpu, memory, disk, network, latency, locality, startup cost, estimated cost,
availability. Declared profiles: `low-resource`, `standard`, `high-resource`, `remote`; declared
deployment shapes for the four deployment modes. The rule the UI obeys: **selection is budget-derived
and one-directional** (a device profile is a budget; a runtime declares requirements; the answer is
derived) — never "vendor A is preferred".

## 5. The economy of context

The system must optimise *useful context* against *repeated context*, *tool overhead*, *memory
overhead* and *model output*. Practical consequences already enforced elsewhere in this tree:
selective context load, lazy tool/memory/skill discovery, bounded traces with drop counting,
references instead of payloads, no transcript copies, no eager agent trees, subscriptions instead of
polling, and a boot payload that carries no AI metadata at all (18,126 B JSON, budget 32 KB).

## 6. UI rules

- Inline: one small, subtle chip. No token dashboards, no gauges, no large badges.
- On demand: the breakdown, with its source labelled.
- Never: a fabricated number, a fabricated percentage, a vendor price table, a "cost" for something
  that was never billed, or a session total assembled from estimates presented as a total.
- A future token-efficiency skill may inspect **measurable** usage; it may not invent metrics.

## See also

- `CONTEXT_SESSION_MEMORY_PLAN.md`
- `AI_FRONTEND_CONTRACT_MATRIX.md`
