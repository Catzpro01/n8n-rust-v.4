/**
 * Backend API response interceptor.
 *
 * API handlers can use this module without importing or knowing anything about
 * the workflow runner.  It is intentionally a pure boundary adapter: the
 * returned payload is a localized copy and machine/data fields remain intact.
 */

import { UniversalLocaleEnforcer, normalizeSupportedLocale } from './localization.mjs';

export class ApiResponseInterceptor {
  constructor({ locale = 'id', translations } = {}) {
    this.enforcer = new UniversalLocaleEnforcer({
      locale: normalizeSupportedLocale(locale),
      translations,
    });
  }

  setLocale(locale) {
    return this.enforcer.setLocale(locale);
  }

  getLocale() {
    return this.enforcer.getLocale();
  }

  intercept(payload, locale = this.getLocale()) {
    return this.enforcer.enforceExecutionResponse(payload, locale);
  }

  interceptChat(payload, locale = this.getLocale()) {
    return this.enforcer.enforceChatSession(payload, locale);
  }

  interceptNode(payload, locale = this.getLocale()) {
    return this.enforcer.enforceNodeDescription(payload, locale);
  }
}

export function interceptApiResponse(payload, locale = 'id', translations) {
  return new ApiResponseInterceptor({ locale, translations }).intercept(payload, locale);
}
