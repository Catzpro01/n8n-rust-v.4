# TASK-412 — Node parameter issues engine

Status: **SUBMITTED_FOR_REVIEW**

## Delivered

- `parameter-issues.mjs`: `getNodeParametersIssues`, `getParameterIssues`, and `mergeIssues`.
- Display-aware required checks for primitive, option, multi-option, date-time, resource-locator, and workflow-selector parameters.
- Recursive collection and fixed-collection validation, including minimum/maximum field counts.
- Resource-locator regex and resource-mapper schema validation.
- Disabled-node and pin-data suppression.
- `field-validation.mjs`: dependency-free validation subset consumed by issue generation.

## Evidence

- Focused Node LEGO suite: **66/66 PASS**, including eight issue-engine tests.
- Differential groups N19/N20: 18 new comparisons.
- Full Node differential: **337 agree / 0 diverge / 337 comparisons**, 2 explicitly NOT-DIFFABLE, 0 harness errors.
- Node gate: **7/7 PASS**.
- Reference tree remains hash-pinned and unchanged.

## Explicit boundary

Filter execution, binary/form-field coercion, Luxon object construction, webhook helpers, and workflow validation are not duplicated in this task. The issue-facing behavior exercised by `getParameterIssues` is preserved and differentially checked.
