// AGENT-4: ENTERPRISE FEATURE UNBLOCKER & LOCALE INTEGRATION
export const N8N_ENTERPRISE_UNLIMITED = {
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
  activationKeyRequired: false
};

export function isEnterpriseBypassActive(): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem('n8n_enterprise_bypass') !== 'false';
  }
  return true;
}
