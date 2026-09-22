# Provider taxonomy

**Status:** consumption view. **Canonical owner:** manager (`ai-foundation.json` `providerKinds`,
`vendorRule`). A vendor name may appear in documentation and in adapter metadata; it may never appear
in a contract field, a permission, a status word or a required field.

---

## 1. The taxonomy

```
kinds (canonical)                contract                     replaceable examples
----------------------------------------------------------------------------------------
model-provider                   ai.model-gateway             9Router, another model gateway
tool-provider                    ai.tool-gateway              Composio, another tool/app gateway
application-provider             ai.application-provider      GitHub (native, first-class)
agent-runtime                    ai.agent-runtime             Hermes, Claude Code, Gemini CLI,
                                                              OpenClaw, DeepSeek Harness
simulation-runtime               ai.agent-runtime             MiroFish
```

Anti-pattern (recorded in the canonical vocabulary): a vendor-scoped capability id such as
`composio.github.repo.read`. The capability is `github.repo.read`; Composio is a *provider* of tools,
not part of the capability's name.

## 2. Replacement table

Any row of the middle column may be swapped without a consumer rewrite, because the consumer depends
on the contract, not on the provider:

| Replaceable | Replaced by | What must not change |
| :--- | :--- | :--- |
| 9Router | another model gateway | `ai.model-gateway` operations, permissions and `modelMetadata` shape |
| Composio | another tool gateway | `ai.tool-gateway` operations, `sideEffects` requirement |
| GitHub | another application provider | `ai.application-provider` capability decomposition + `app:*` grants |
| Hermes / Claude Code / Gemini CLI / OpenClaw | another agent runtime | `ai.agent-runtime` lifecycle + `runtimeMetadata` |
| MiroFish | another simulation runtime | the simulation kind stays distinct from the agent kind |

## 3. Frontend rules

1. **Vendor names are data.** They appear only where an example, an adapter label or documentation
   belongs. No frontend constant, message key or vocabulary word contains one (`describeAgents()`
   proves this in `test/26`).
2. **One provider kind is not another.** A runtime is never a provider kind; a tool provider is never
   an application provider; the UI labels the source (`Native`, `MCP`, `Runtime`, `Remote`) instead of
   guessing.
3. **A missing provider is a state, not an error.** `AI Foundation ready · no provider configured` is
   a valid installation (zero-install), reported as `capability-unavailable` with the reason
   *no inference provider configured*.
4. **Costs are reported or absent.** A missing cost is unknown, never zero; the UI shows `estimated`
   when it derives anything, and shows nothing rather than inventing a number.
5. **Keys never reach a surface.** A provider credential is never requested, stored, rendered or
   forwarded by any AI surface; a declaration carrying credential material is refused by name.

## 4. Why the separation is worth it

The provider kind answers *where*; the capability answers *what*; the operation answers *which action*;
the interaction class answers *what kind of exchange*; the transport answers *how bytes move*; the
runtime answers *where execution happens*. Collapsing any two of them is what creates vendor lock-in —
and vendor lock-in is the thing this taxonomy exists to prevent.

## See also

- `AI_RUNTIME_AND_PROVIDER_PLAN.md`
- `AI_AGENT_LEGO_MASTER_PLAN.md`
