/**
 * Dynamic Form & Resource Locator Validator
 * Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/node-helpers.ts
 *         reference/n8n/packages/workflow/src/type-guards.ts
 *         reference/n8n/packages/workflow/src/interfaces.ts
 *         reference/n8n/packages/workflow/src/type-validation.ts
 *
 * Contract: contracts/dynamic-form.contract.md
 */

export type ResourceLocatorModes = 'id' | 'url' | 'list' | string;

export interface IResourceLocatorResult {
  name: string;
  value: string;
  url?: string;
}

export interface INodeParameterResourceLocator {
  __rl: true;
  mode: ResourceLocatorModes;
  value: unknown;
  cachedResultName?: string;
  cachedResultUrl?: string;
  __regex?: string;
}

export type NodeParameterValue = string | number | boolean | undefined | null;

export function isResourceLocatorValue(value: unknown): value is INodeParameterResourceLocator {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rl' in (value as any) &&
    (value as any).__rl === true &&
    'mode' in (value as any) &&
    'value' in (value as any)
  );
}

export function isResourceMapperValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mappingMode' in (value as any) &&
    'value' in (value as any)
  );
}

export function isValidResourceLocatorParameterValue(value: INodeParameterResourceLocator): boolean {
  if (!value) return false;
  if (typeof value.mode !== 'string' || value.mode.length === 0) return false;
  // value can be string, number, etc. but not empty when required
  if (value.value === undefined || value.value === null) return false;
  if (typeof value.value === 'string' && value.value.trim() === '') return false;
  return true;
}

export function validateResourceLocatorParameter(
  value: INodeParameterResourceLocator,
  isRequired: boolean,
): string | null {
  if (!value && isRequired) {
    return 'Parameter is required.';
  }
  if (!value) return null;

  if (!isResourceLocatorValue(value)) {
    return 'Parameter is not a valid resource locator.';
  }

  if (isRequired && !isValidResourceLocatorParameterValue(value)) {
    return 'Parameter is required but empty.';
  }

  // Regex validation if __regex present
  if (value.__regex && typeof value.value === 'string') {
    try {
      const regex = new RegExp(value.__regex);
      if (!regex.test(value.value)) {
        return `Parameter value does not match pattern ${value.__regex}`;
      }
    } catch {
      // Invalid regex itself is not a user error, ignore
    }
  }

  return null;
}

export function validateDynamicField(value: unknown, isRequired: boolean): boolean {
  if (isRequired && (value === undefined || value === null || value === '')) {
    return false;
  }
  // If it's a resource locator, use its validator
  if (isResourceLocatorValue(value)) {
    return isValidResourceLocatorParameterValue(value as INodeParameterResourceLocator);
  }
  // If it's an array and required, must have at least one item
  if (isRequired && Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}

export function validateFixedCollection(
  value: Record<string, unknown> | undefined,
  isRequired: boolean,
  allowedFields?: string[],
): string | null {
  if (!value && isRequired) return 'Collection is required.';
  if (!value) return null;

  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'Collection must be an object.';
  }

  if (allowedFields) {
    for (const key of Object.keys(value)) {
      if (!allowedFields.includes(key)) {
        return `Field "${key}" is not allowed.`;
      }
    }
  }

  return null;
}

export function extractResourceLocatorValue(
  value: INodeParameterResourceLocator | string,
): string {
  if (typeof value === 'string') return value;
  if (isResourceLocatorValue(value)) {
    return String(value.value);
  }
  return '';
}

export function extractResourceLocatorUrl(
  value: INodeParameterResourceLocator,
): string | undefined {
  if (!isResourceLocatorValue(value)) return undefined;
  return value.cachedResultUrl;
}

export function createResourceLocator(
  mode: ResourceLocatorModes,
  value: unknown,
  cachedResultName?: string,
  cachedResultUrl?: string,
  regex?: string,
): INodeParameterResourceLocator {
  return {
    __rl: true,
    mode,
    value: value as any,
    cachedResultName,
    cachedResultUrl,
    __regex: regex,
  };
}
