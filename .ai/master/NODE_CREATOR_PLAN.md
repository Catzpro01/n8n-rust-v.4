# Node Creator

**Status:** planning. **Published:** `node-registry@0.1.0` (catalog `resolve`,
`describe`, `list`, `icons.read`). **Not published:** node drafting/validation (**XA-15**).
No node generator, no schema compiler and no AI drafting exists in this repository.

---

## 1. What Node Creator is for

Node Creator is the project-level factory for new node capabilities: a user describes what they need,
and the result is a **validated, installable node** — or an honest explanation of which declared step
is missing. It is not a code generator that bypasses contracts.

## 2. Creation methods (peers, not a ladder)

`template` · `visual` · `declarative` · `OpenAPI` · `transform` · `formula` · `subworkflow` · `script` ·
`native JS` · `Rust/WASM` · `connector` · `agent-generated`.

Selection principle: **simple -> declarative/template** · **external API -> connector/OpenAPI** ·
**complex reusable logic -> code** · **heavy deterministic computation -> Rust/WASM**.

**Nothing pushes a user toward Rust.** Rust/WASM is one peer among many, chosen for measured benefit
(the project's Rust rule), never for branding; `Rust/WASM` must never be the default in a picker.

## 3. AI-assisted flow (gated on XA-15)

```
Describe -> Draft -> Validate -> Test -> Preview -> Install
```

| Step | What it produces | Gate |
| :--- | :--- | :--- |
| Describe | intent, inputs/outputs, credentials shape, side effects | no AI contract needed |
| Draft | an artifact (node definition/source) | **XA-15**: a drafting capability must be published |
| Validate | schema + contract conformance | reuses the published workflow validation where available |
| Test | a run against sample data | execution domain operations |
| Preview | what will be installed, and what it will touch | approval where policy says so |
| Install | registration + activation | `node-registry` operations; approval for a write action |

Rules: the AI flow **never bypasses validation**; an install is a write action and therefore an
approval candidate; a draft is an **artifact** (referenced, previewable, revertible), never a silent
in-place edit; a failed test keeps the previous node.

## 4. Lifecycle

`draft -> validate -> generate -> test -> conformance -> package -> install -> activate`.
Every step is observable, and the node's own lifecycle (`registered -> available -> enabled ->
disabled -> upgraded -> removed`) stays distinct from the *creation* lifecycle above.

## 5. Frontend surface

`Create with AI` appears in the node editor next to the classic catalog path. While XA-15 is open, the
flow is **specified and gated**: the surface explains which step is missing instead of mocking a
draft. The classic path (catalog `resolve`/`describe`/`list`, visual configuration) works without AI
and always will — a user who never uses AI must lose nothing.

## 6. What must not happen

No node source code rendered into the chat; no installation without a validated preview; no
AI-generated node that skips conformance; no credential material in a draft; no Rust push; no second
node catalog beside `node-registry`.

## See also

- `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md`
- `SECURITY_AND_APPROVAL_MODEL.md`
