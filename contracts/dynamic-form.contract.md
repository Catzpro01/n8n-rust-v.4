# LEGO Contract: Dynamic Form & Resource Locator Validator

| Field | Value |
| :--- | :--- |
| Owner | Agent 4 — Validation Domain Engineer |
| LEGO | `dynamic-form` — Dynamic form validation, resource locator, resource mapper |
| Status | Phase 4 — `IMPLEMENTED`, 10/10 gates PASS, tsc 0 errors |
| Reference | n8n `2.9.4` — `reference/n8n/packages/workflow/src/node-helpers.ts` (validateResourceLocatorParameter, isValidResourceLocatorParameterValue, isResourceLocatorValue), `type-validation.ts`, `interfaces.ts` (INodeParameterResourceLocator) |
| Isolation record | `docs/isolation/reconstructed-engine.md` |
| Rust | **NOT STARTED** |

## 1. Purpose
Own dynamic form validation: resourceLocator, resourceMapper, fixedCollection, collection, required field validation, regex extraction, credential resource locator, workflowSelector.

## 2. Data Schema
```typescript
type ResourceLocatorModes = 'id' | 'url' | 'list' | string;

interface IResourceLocatorResult {
  name: string;
  value: string;
  url?: string;
}

interface INodeParameterResourceLocator {
  __rl: true;
  mode: ResourceLocatorModes;
  value: Exclude<NodeParameterValue, boolean>;
  cachedResultName?: string;
  cachedResultUrl?: string;
  __regex?: string;
}

function isResourceLocatorValue(value: unknown): value is INodeParameterResourceLocator;
function isValidResourceLocatorParameterValue(value: INodeParameterResourceLocator): boolean;
function validateResourceLocatorParameter(value: INodeParameterResourceLocator, isRequired: boolean): string | null;
function validateDynamicField(value: unknown, isRequired: boolean): boolean;
```

## 3. Responsibilities
1. **Type guards**: `isResourceLocatorValue`, `isResourceMapperValue`, `isValidResourceLocatorParameterValue`
2. **Validation**: `validateResourceLocatorParameter` (required check, mode check, value check, regex extraction), `validateDynamicField` (required empty check)
3. **Resource locator**: mode `id|url|list|custom`, value extraction, cachedResultName/Url, __regex
4. **Dynamic fields**: fixedCollection, collection, options, boolean, string, number with displayOptions
5. **Workflow selector**: same as resourceLocator but for workflowId

## 4. Non-responsibilities
| Not owned | Owner |
| :--- | :--- |
| Workflow structure | workflow LEGO |
| Node parameter defaults | node LEGO |
| Execution data | execution-data LEGO |
| Expression evaluation | expression LEGO |
| Structural validation (uniqueness, dangling, cycles) | validation LEGO |

## 5. Invariants
| Invariant | Enforced? | Evidence |
| :--- | :--- | :--- |
| `__rl: true` marks resourceLocator | YES | type-guards.ts |
| `mode` required, `value` required when isRequired | YES | node-helpers.ts validate |
| `isValidResourceLocatorParameterValue` checks mode + value | YES | node-helpers.ts |
| Empty required field returns false / error message | YES | validateDynamicField |
| Regex extraction works only when parameter type is resourceLocator | YES | interfaces.ts comment |

## 6. Dependencies
- `P-NODE-MODEL`: node parameter types
- `P-VALIDATION`: type-validation

## 7. Tests
- `packages/reconstructed-engine/test-enhanced.mjs` ALL LEGOs PASS
- `verify:fast` 10/10 PASS
- Resource locator validation in node-lego tests

## 8. Provenance
Reference: n8n 2.9.4 `node-helpers.ts`, `type-guards.ts`, `interfaces.ts`, reconstructed 1:1 in `packages/reconstructed-engine/src/dynamic-form-validator.ts`.
