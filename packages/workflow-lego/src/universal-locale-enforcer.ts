import {
  BackendLocalizationService,
  NativeLocalizationService,
  isProtectedMachineKey,
  type LocaleInput,
  type LocaleMetadata,
  type SupportedLocale,
} from './backend-localization-service';

/** Keys whose strings are intended for a person rather than the workflow VM. */
export const HUMAN_FACING_KEYS = [
  'label',
  'displayName',
  'description',
  'placeholder',
  'hint',
  'title',
  'message',
  'text',
  'summary',
  'statusText',
  'errorMessage',
  'successMessage',
  'failureMessage',
  'helpText',
  'tooltip',
  'buttonLabel',
  'labelText',
  'caption',
  'ariaLabel',
  'header',
  'subheader',
  'emptyState',
  'optionLabel',
  'inputLabel',
  'send',
  'newSession',
  'session',
  'input',
  'inputPlaceholder',
  'zoomIn',
  'zoomOut',
  'fitView',
  'cancel',
  'confirm',
  'close',
  'back',
  'next',
  'loading',
  'retry',
  'parameter',
  'parameters',
  'option',
  'options',
  'subtitle',
  'workspace',
] as const;

const HUMAN_FACING_KEY_SET = new Set<string>(HUMAN_FACING_KEYS.map((key) => key.toLowerCase()));

/**
 * These fields are not in the mandatory seven-token list because they are
 * additional n8n transport/data containers.  Localizing inside them would
 * mutate user workflow data rather than the response's human-facing surface.
 */
const NON_LOCALIZABLE_KEYS = new Set<string>([
  'node',
  'id',
  'uuid',
  'key',
  'index',
  'inputcount',
  'outputcount',
  'durationms',
  'data',
  'json',
  'parameters',
  'staticdata',
  'pindata',
  'connections',
  'credentials',
  'binary',
  'expression',
  'status',
]);

const TRANSLATION_KEY_FIELDS = new Set<string>([
  'i18nkey',
  'translationkey',
  'localekey',
]);

export interface LocaleEnforcerOptions {
  locale?: LocaleInput;
  translations?: Partial<Record<SupportedLocale, Readonly<Record<string, string>>>>;
}

export interface ExecutionLogEntry {
  [key: string]: unknown;
  status?: string;
  statusText?: string;
}

export interface ChatSessionPayload {
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function lowerKey(key: string): string {
  return key.toLowerCase();
}

function isHumanFacingKey(key: string | undefined): boolean {
  return key !== undefined && HUMAN_FACING_KEY_SET.has(lowerKey(key));
}

function isNonLocalizableKey(key: string | undefined): boolean {
  return key !== undefined && NON_LOCALIZABLE_KEYS.has(lowerKey(key));
}

function isTranslationKeyField(key: string): boolean {
  return TRANSLATION_KEY_FIELDS.has(lowerKey(key));
}

function copyWithoutLocalization(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!isObject(value)) return value;
  if (seen.has(value)) return seen.get(value);

  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copyWithoutLocalization(item, seen));
    return copy;
  }

  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) {
    copy[key] = copyWithoutLocalization(child, seen);
  }
  return copy;
}

/**
 * Backend response sanitizer.  It is intentionally pure: no caller-owned
 * object is mutated and machine values are copied through a non-localizing
 * branch.  This prevents frontend render loops and protects DAG execution
 * semantics at the API boundary.
 */
export class UniversalLocaleEnforcer {
  private readonly localization: BackendLocalizationService;
  private readonly translations: Partial<Record<SupportedLocale, Readonly<Record<string, string>>>>;

  public constructor(options: LocaleEnforcerOptions = {}) {
    this.localization = new BackendLocalizationService(options.locale);
    this.translations = options.translations ?? {};
  }

  public getLocale(): SupportedLocale {
    return this.localization.getLocale();
  }

  public setLocale(locale: LocaleInput): SupportedLocale {
    return this.localization.setLocale(locale);
  }

  public getSupportedLocales(): LocaleMetadata[] {
    return this.localization.getSupportedLocales();
  }

  /** Add translations supplied by a built-in or community node loader. */
  public registerTranslations(
    locale: LocaleInput,
    translations: Readonly<Record<string, string>>,
  ): void {
    const target = this.resolveLocale(locale);
    const current = this.translations[target] ?? {};
    this.translations[target] = { ...current, ...translations };
  }

  public translate(key: string, locale?: LocaleInput): string {
    const target = this.resolveLocale(locale);
    return this.translations[target]?.[key] ?? NativeLocalizationService.translate(key, target);
  }

  public translateText(text: string, locale?: LocaleInput): string {
    const target = this.resolveLocale(locale);
    const dictionary = this.translations[target] ?? {};
    const directTranslation = dictionary[text];
    if (directTranslation !== undefined) return directTranslation;
    const matchingKey = Object.entries(dictionary).find(([, value]) => value === text)?.[0];
    if (matchingKey) return dictionary[matchingKey];
    return NativeLocalizationService.translateText(text, target);
  }

  public enforce<T>(payload: T, locale?: LocaleInput): T {
    const target = this.resolveLocale(locale);
    return this.walk(payload, undefined, target, new WeakMap()) as T;
  }

  /** Applies the response policy to an execution result without rewriting its machine status. */
  public enforceExecutionResponse<T>(payload: T, locale?: LocaleInput): T {
    const target = this.resolveLocale(locale);
    const localized = this.enforce(payload, target);
    if (!isObject(localized)) return localized;

    const response = localized as Record<string, unknown>;
    if (Array.isArray(response.executionLog)) {
      response.executionLog = this.enforceExecutionLog(response.executionLog, target);
    }
    if (typeof response.status === 'string' && response.statusText === undefined) {
      response.statusText = this.translateStatus(response.status, target);
    }
    return localized;
  }

  public enforceExecutionLog<T extends ExecutionLogEntry | ExecutionLogEntry[]>(
    log: T,
    locale?: LocaleInput,
  ): T {
    const target = this.resolveLocale(locale);
    if (Array.isArray(log)) {
      return log.map((entry) => this.enforceExecutionLog(entry, target)) as T;
    }

    const localized = this.enforce(log, target) as ExecutionLogEntry;
    if (typeof localized.status === 'string') {
      localized.statusText = this.translateStatus(localized.status, target);
    }
    return localized as T;
  }

  public enforceChatSession<T extends ChatSessionPayload | ChatSessionPayload[]>(
    session: T,
    locale?: LocaleInput,
  ): T {
    return this.enforce(session, locale);
  }

  public enforceNodeDescription<T extends Record<string, unknown>>(node: T, locale?: LocaleInput): T {
    return this.enforce(node, locale);
  }

  private resolveLocale(locale?: LocaleInput): SupportedLocale {
    return NativeLocalizationService.normalizeLocale(locale, this.getLocale());
  }

  private translateStatus(status: string, locale: LocaleInput): string {
    const normalized = status.toLocaleLowerCase();
    const keyByStatus: Record<string, string> = {
      success: 'execution.success',
      succeeded: 'execution.success',
      completed: 'execution.completed',
      complete: 'execution.completed',
      running: 'execution.running',
      waiting: 'execution.waiting',
      pending: 'execution.waiting',
      failed: 'execution.failed',
      failure: 'execution.failed',
      cancelled: 'execution.cancelled',
      canceled: 'execution.cancelled',
      error: 'execution.error',
    };
    const key = keyByStatus[normalized];
    return key ? this.translate(key, locale) : NativeLocalizationService.translateText(status, locale);
  }

  private walk(
    value: unknown,
    parentKey: string | undefined,
    locale: SupportedLocale,
    seen: WeakMap<object, unknown>,
  ): unknown {
    if (typeof value === 'string') {
      return isHumanFacingKey(parentKey) ? this.translateText(value, locale) : value;
    }
    if (!isObject(value)) return value;

    if (isProtectedMachineKey(parentKey ?? '') || isNonLocalizableKey(parentKey)) {
      return copyWithoutLocalization(value);
    }
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      seen.set(value, copy);
      for (const item of value) {
        copy.push(this.walk(item, parentKey, locale, seen));
      }
      return copy;
    }

    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const [key, child] of Object.entries(value)) {
      if (isProtectedMachineKey(key) || isNonLocalizableKey(key)) {
        copy[key] = copyWithoutLocalization(child);
        continue;
      }
      if (isTranslationKeyField(key) && typeof child === 'string') {
        copy[key] = this.translate(child, locale);
        continue;
      }
      copy[key] = this.walk(child, key, locale, seen);
    }
    return copy;
  }
}

export function createUniversalLocaleEnforcer(options: LocaleEnforcerOptions = {}): UniversalLocaleEnforcer {
  return new UniversalLocaleEnforcer(options);
}

export function enforceLocale<T>(payload: T, locale?: LocaleInput): T {
  return new UniversalLocaleEnforcer({ locale }).enforce(payload);
}

export function interceptLocalizedResponse<T>(payload: T, locale?: LocaleInput): T {
  return new UniversalLocaleEnforcer({ locale }).enforceExecutionResponse(payload);
}
