# Skills and capabilities

**Status:** planning. **Capability: published** (`lego.domain-registry@1.1.0`, `lego.interaction`,
`lego.negotiation`, `ai.foundation` taxonomy). **Skill: XA-11 — `publicationPending`**
(no capability, no contract, no vocabulary exists at P2.10).

---

## 1. The distinction that must never blur

| Concept | Question | Shape |
| :--- | :--- | :--- |
| **Capability** | *what can be done* | a declared, versioned contract with operations, permissions, interaction classes |
| **Skill** *(XA-11)* | *how the job should be done* | knowledge + rules + procedure + capability map + validators |
| **Agent Machine** | *who/what orchestrates the job* | a runtime executing a delegated task |
| **Workspace** | *where the action occurs* | a scoped place with a boundary |
| **Approval** | *whether the action is allowed* | a human gate with risk and reason |
| **Artifact** | *what result was produced* | a referenced, retentive output |
| **Work Trace** | *what operationally happened* | bounded operational rows |

A skill is **not** an agent: it does not inherit authority, does not execute tools directly, and does
not decide. It may *require* or *prefer* capabilities, and it may declare validators — but the
capability call is made by the caller, with the caller's permission.

## 2. Capability: published rules the frontend obeys

1. A capability is declared, never discovered; an unknown capability fails closed **by name**.
2. Operations are published (`operations[]`); an operation a capability does not publish is
   `operation-unpublished` — the UI never guesses that it exists.
3. Permissions are declared names (`ai:model:invoke`); a missing or unknown grant is
   `permission-missing` / `permission-unknown`, never worked around.
4. Interaction class belongs to the **operation** (CALL, EVENT, STREAM, BATCH); transport is chosen by
   eligibility and cost and is never named in a business contract.
5. Suitability is derived from declarations (`suitableRuntimes`): a thin client is steered away from
   runtimes it cannot run — one direction, no vendor preference.

## 3. Skill: the target shape (planning only)

If the manager publishes `ai.skill`, the shape this plan expects:

- **identity**: skill id, semantic version, owner, status;
- **procedure**: the ordered steps (a procedure, not a prompt);
- **capability map**: required and optional capabilities it needs to work;
- **validators**: named checks that can fail loudly;
- **references**: knowledge to load on demand;
- **token budget**: an expectation, not a consumption report;
- **lifecycle**: `registered -> available -> selected -> loaded -> active -> released` (a *skill's* own
  lifecycle, distinct from capability lifecycle and from session state).

Progressive disclosure for a skill: **L0** identity · **L1** card · **L2** procedure ·
**L3** deep knowledge. The UI shows `Skills 3 active` -> list -> one skill's details, and **never** a
skill's private reasoning, internal notes or validator source.

## 4. Why skills must not carry authority

A skill that could execute would be an agent with a friendlier name, and its provenance (who wrote it,
which version is active) would become a permission boundary nobody reviews. Keeping skills declarative
means: capability grants stay with the caller, approvals stay with the action, and a skill can be
updated or replaced without changing what the system is allowed to do.

## 5. Frontend behaviour while XA-11 is open

The Skills surface is specified and **gated**: the chip renders a presentation-only count or
`capability-unavailable` with the reason; no skill state is requested, stored or sent to the backend;
no mock data is rendered; and the skill words above are *planning vocabulary* that the frontend must
not present as a published contract.

## See also

- `AI_AGENT_LEGO_MASTER_PLAN.md`
- `SECURITY_AND_APPROVAL_MODEL.md`
