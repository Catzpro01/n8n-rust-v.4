// Dynamic Form & Credentials Resource Locator Validator
export function validateDynamicField(value: unknown, isRequired: boolean): boolean {
  if (isRequired && (value === undefined || value === null || value === '')) {
    return false;
  }
  return true;
}
