// Agent 4: Enterprise Feature 100% Unlocked Configuration
export const ENTERPRISE_UNLIMITED_CONFIG = {
  customRoles: true,
  workerView: true,
  mfaEnforcement: true,
  ldap: true,
  saml: true,
  advancedExecutionFilters: true,
  sharing: true,
  variables: true,
  logStreaming: true,
  debugInEditor: true,
  sourceControl: true,
  activationKeyRequired: false,
  bypassSwitchAvailable: true
};

export function isEnterpriseBypassEnabled(): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem('n8n_enterprise_bypass') !== 'false';
  }
  return true;
}
