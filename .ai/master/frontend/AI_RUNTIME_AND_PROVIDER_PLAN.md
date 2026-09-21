<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../AI_RUNTIME_AND_PROVIDER_PLAN.md`](../AI_RUNTIME_AND_PROVIDER_PLAN.md). Where the two disagree on a *number*, the canonical
> document wins: its figures are generated from the manifests at build time,
> whereas this view was hand-written against backend baseline `6f7b66da` (P2.10)
> and is **not** updated by regeneration.
>
> Known differences at the time of reconciliation: XA-5 is **closed** (the eleven
> `lego.*` codes are published; error contract 1.1.0, 35 codes), the operation
> count is **139** (not 173), and gate rules now run through **F17**.
>
> It is preserved because it carries frontend reasoning, UX consequences and
> cross-agent reconciliation notes that no backend manifest derives.

# AI runtime, providers and adapters — consumption plan

**Status:** consumption view + planning. **Canonical owner:** manager/agent-2
(`ai-foundation.json` `runtime`/`providerKinds`/`agentRuntime`, `ai.foundation@1.0.0`).
**Frontend owner:** agent-01 for what the UI renders. Nothing here is implemented in this branch.

---

## 1. The five kinds, never conflated

| Kind | Question | Canonical contract | Examples (documentation only) |
| :--- | :--- | :--- | :--- |
| **model-provider** | where inference comes from | `ai.model-gateway` | 9Router-style gateways |
| **tool-provider** | where tools/apps come from | `ai.tool-gateway` | Composio-style gateways |
| **application-provider** | a first-class application integration | `ai.application-provider` | GitHub (native, never behind a gateway) |
| **agent-runtime** | where an agent session executes | `ai.agent-runtime` | Hermes, Claude Code, Gemini CLI, OpenClaw, DeepSeek Harness |
| **simulation-runtime** | where simulated behaviour executes | `ai.agent-runtime` | MiroFish |

A vendor name is **data**, never a contract field: it may appear in an example list, in adapter
metadata or in documentation, and never as a required field, a permission name or a status word. This
is what makes any of them replaceable (`PROVIDER_TAXONOMY.md`).

## 2. Model plane, tool plane, code plane

- **Model plane** — `ai.model-gateway`: `models.list`, `model.describe`, `generate`, `stream`
  (backpressure `block` by default: a token stream is not silently dropped), `embed`, `countTokens`.
  Permissions `ai:model:read`, `ai:model:invoke`. `modelMetadata` is required to carry modelId,
  provider and availability; cost fields are optional and a **missing cost is unknown, never zero**.
- **Tool plane** — `ai.tool-gateway`: `tools.list`, `tool.describe`, `tool.call`, `resources.list`,
  `resource.read`, `prompts.list`, `prompt.get`; permissions `ai:tool:read`, `ai:tool:invoke`. Every
  tool declares `sideEffects` (`read-only`, `writes`, `destructive`, `external`); an undeclared value
  is treated as **destructive**.
- **Code plane** — `ai.application-provider`: a native application is first-class. GitHub's
  decomposition is documented as capabilities (`repo.read`, `repo.write`, `branch.read`,
  `branch.create`, `commit.create`, `pr.read`, `pr.create`, `issue.read`, `issue.create`,
  `actions.read`, `webhook.receive`) with `app:github:read|write|receive` grants. **Native GitHub
  never depends on a tool gateway**; a gateway is an alternative path, not a requirement.

## 3. Runtime adapters

Contract shape (`ai.agent-runtime`): lifecycle `create`, `start`, `send`, `pause`, `resume`,
`cancel`, `status`, `stream`, `artifact`, `close`; permissions `ai:agent:create`, `ai:agent:invoke`,
`ai:agent:control`, `ai:agent:read`. `runtimeMetadata` is required to declare runtimeId, kind,
version, availability, transport, locality and `supports` (`session`, `background`, `stream`,
`cancellation`, `delegation`).

Rules the frontend renders and never overrides:

1. **Optional, never mandatory.** `cancellation: false` is legitimate; the UI then has no cancel
   action — it does not grey out a control that would lie.
2. **`pause` is optional**: absent support produces the declared `lego.operation_unsupported` wording
   (XA-5: the code namespace itself is unpublished), not a silent no-op.
3. **Locality is declared** — `in-process`, `local-process`, `local-network`, `remote` — and the UI
   collapses it into one honest view word (`local` = "runs here", declared in `vocabulary.mjs` as
   `runtimeLocalityView`), never into a second canonical word.
4. **External runtimes stay external.** n8n retains ownership of task, policy, workspace boundary,
   approval, artifact references, event normalisation, the context contract and resource accounting.
   No external runtime is rewritten in this project, and none is required to exist.

## 4. Deployment modes (all valid)

| Mode | Composition | Notes |
| :--- | :--- | :--- |
| **Core** | n8n LEGO + AI Foundation | no local inference requirement; zero-install is valid |
| **Remote AI** | local UI/orchestrator + remote model and/or agent | the low-resource strategy; identical contracts |
| **Connected** | n8n + connectors + remote capabilities | MCP/tool gateways at the edge |
| **Power** | local + remote runtimes + full tooling | everything, still optional |

The contract does not change between modes — only the deployment does. This is why transport,
capability, provider and runtime remain separate abstractions.

## 5. Resource awareness

Runtime selection is **budget-derived**, never vendor-driven: a device profile (cpu, memory, disk,
network, latency, startup cost, estimated cost, availability) is matched against a runtime's declared
requirements and locality, and a thin client is steered to remote execution when local execution would
not fit. Resource-aware behaviour is policy-controlled and never a hidden preference.

## 6. What the frontend may show

`Runtime · <name> · <locality> · <availability>` (advanced: version, supports, resource cost, health)
· tool surfaces grouped by capability with a source label (`Native`, `MCP`, `Runtime`, `Remote`) ·
model choice as an **id** from `models.list`, never a URL, key or header. What it may never show: a
provider secret, a raw endpoint, a vendor-specific field invented as a contract field, or a cost the
provider did not report.
