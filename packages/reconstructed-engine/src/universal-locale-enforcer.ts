// AGENT-5: ZERO CROSS-LANGUAGE LEAK CONTROLLER
export class UniversalLocaleEnforcer {
  public static readonly SUPPORTED_LOCALES = ['id', 'en', 'jv', 'ar', 'zh', 'ru'];

  public static enforce(requestedLocale: string): string {
    return this.SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : 'id';
  }

  public static cleanText(text: string, currentLocale: string, dict: Record<string, string>): string {
    if (currentLocale === 'en') {
      return text;
    }
    return dict[text.trim()] || text;
  }
}
