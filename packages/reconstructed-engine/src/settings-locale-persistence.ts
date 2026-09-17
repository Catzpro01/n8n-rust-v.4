// Settings & Native Locale Persistence Handler (PostgreSQL & Cookie)
export interface UserLocalePreference {
  userId: string;
  locale: 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';
  direction: 'ltr' | 'rtl';
  updatedAt: string;
}

export function buildLocaleCookieHeader(locale: string): string {
  return `n8n_locale=${locale}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

export function sanitizeUserLocale(inputLocale?: string): 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru' {
  const valid = ['id', 'en', 'jv', 'ar', 'zh', 'ru'];
  if (inputLocale && valid.includes(inputLocale)) {
    return inputLocale as any;
  }
  return 'id'; // Default native fallback
}
