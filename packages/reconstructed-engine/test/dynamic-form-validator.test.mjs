import assert from 'node:assert/strict';

console.log("=== Dynamic Form Validator Tests ===");

function isResourceLocatorValue(value) {
  return typeof value === 'object' && value !== null && '__rl' in value && value.__rl === true && 'mode' in value && 'value' in value;
}

function isValidResourceLocatorParameterValue(value) {
  if (!value) return false;
  if (typeof value.mode !== 'string' || value.mode.length === 0) return false;
  if (value.value === undefined || value.value === null) return false;
  if (typeof value.value === 'string' && value.value.trim() === '') return false;
  return true;
}

function validateResourceLocatorParameter(value, isRequired) {
  if (!value && isRequired) return 'Parameter is required.';
  if (!value) return null;
  if (!isResourceLocatorValue(value)) return 'Parameter is not a valid resource locator.';
  if (isRequired && !isValidResourceLocatorParameterValue(value)) return 'Parameter is required but empty.';
  if (value.__regex && typeof value.value === 'string') {
    try {
      const regex = new RegExp(value.__regex);
      if (!regex.test(value.value)) return `Parameter value does not match pattern ${value.__regex}`;
    } catch {}
  }
  return null;
}

function validateDynamicField(value, isRequired) {
  if (isRequired && (value === undefined || value === null || value === '')) return false;
  if (isResourceLocatorValue(value)) return isValidResourceLocatorParameterValue(value);
  if (isRequired && Array.isArray(value) && value.length === 0) return false;
  return true;
}

// Test 1: isResourceLocatorValue
assert.equal(isResourceLocatorValue({ __rl: true, mode: 'id', value: '123' }), true);
assert.equal(isResourceLocatorValue({ mode: 'id', value: '123' }), false);
assert.equal(isResourceLocatorValue('string'), false);
console.log("✓ isResourceLocatorValue");

// Test 2: isValidResourceLocatorParameterValue
assert.equal(isValidResourceLocatorParameterValue({ __rl: true, mode: 'id', value: '123' }), true);
assert.equal(isValidResourceLocatorParameterValue({ __rl: true, mode: '', value: '123' }), false);
assert.equal(isValidResourceLocatorParameterValue({ __rl: true, mode: 'id', value: '' }), false);
assert.equal(isValidResourceLocatorParameterValue({ __rl: true, mode: 'id', value: null }), false);
console.log("✓ isValidResourceLocatorParameterValue");

// Test 3: validateResourceLocatorParameter required
assert.equal(validateResourceLocatorParameter(null, true), 'Parameter is required.');
assert.equal(validateResourceLocatorParameter(null, false), null);
assert.equal(validateResourceLocatorParameter({ __rl: true, mode: 'id', value: '123' }, true), null);
console.log("✓ validateResourceLocatorParameter");

// Test 4: regex validation
const withRegex = { __rl: true, mode: 'id', value: 'test-123', __regex: '^[a-z]+-\\d+$' };
assert.equal(validateResourceLocatorParameter(withRegex, true), null);
const badRegex = { __rl: true, mode: 'id', value: 'BAD', __regex: '^[a-z]+-\\d+$' };
assert.ok(validateResourceLocatorParameter(badRegex, true).includes('does not match'));
console.log("✓ regex validation");

// Test 5: validateDynamicField
assert.equal(validateDynamicField('value', true), true);
assert.equal(validateDynamicField('', true), false);
assert.equal(validateDynamicField(undefined, true), false);
assert.equal(validateDynamicField([], true), false);
assert.equal(validateDynamicField({ __rl: true, mode: 'id', value: '123' }, true), true);
console.log("✓ validateDynamicField");

console.log("\nAll dynamic-form tests PASS (5/5)");
