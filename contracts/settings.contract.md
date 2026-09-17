# LEGO Contract: Settings & Localization

| Field | Value |
| :--- | :--- |
| Owner | Agent 1 — Settings Domain Engineer (Phase 4B i18n) |
| LEGO | `settings` — Localization, personal settings, 6-language support |
| Status | Phase 4B — `VERIFIED`, 6 languages ID/EN/JV/AR/ZH/RU, RTL support, tsc 0 errors |
| Reference | n8n `2.9.4` — `reference/n8n/packages/frontend/editor-ui/src/stores/settings.store.ts` + i18n implementation |
| Isolation record | `docs/isolation/reconstructed-engine.md` |
| Rust | **NOT STARTED** |

## 1. Purpose
Own personal settings and localization: locale switching, translation, direction (LTR/RTL), native dictionaries, 6-language support (ID, EN, JV, AR, ZH, RU).

## 2. Data Schema
```typescript
type SupportedLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';

interface LocaleMetadata {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
}

const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleMetadata> = {
  id: { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr' },
  en: { code: 'en', name: 'English', nativeName: 'English (US)', direction: 'ltr' },
  jv: { code: 'jv', name: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr' },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  zh: { code: 'zh', name: 'Chinese', nativeName: '中文 (简体)', direction: 'ltr' },
  ru: { code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr' },
};

const NATIVE_DICTIONARIES: Record<SupportedLocale, Record<string, string>>;

class NativeLocalizationService {
  static setLocale(locale: SupportedLocale): void;
  static getLocale(): SupportedLocale;
  static t(key: string, params?: Record<string, any>): string;
  static getDirection(): 'ltr' | 'rtl';
  static isRTL(): boolean;
}
```

## 3. Responsibilities
1. **Locale management**: setLocale, getLocale, active locale tracking (default 'id')
2. **Translation**: t(key, params?) → translated string from NATIVE_DICTIONARIES
3. **Direction**: getDirection() → 'ltr'/'rtl', isRTL() for Arabic
4. **Dictionaries**: 6 languages with keys: execute.workflow, test.step, save.workflow, add.step, settings.title, settings.personal, settings.language, node.success, node.error
5. **Integration**: SettingsLocalizationAdapter for editor-ui, workflow settings store

## 4. Non-responsibilities
| Not owned | Owner |
| :--- | :--- |
| Workflow structure | workflow LEGO |
| Node model | node LEGO |
| Execution engine | execution-engine LEGO |
| API/HTTP | api LEGO |
| Persistence | persistence LEGO |
| Frontend Vue Canvas / editor-ui | 100% untouched per PROJECT_RULES |

## 5. Invariants
| Invariant | Enforced? | Evidence |
| :--- | :--- | :--- |
| Supported locales exactly 6: id, en, jv, ar, zh, ru | YES | SUPPORTED_LOCALES |
| Default locale 'id' (Indonesian) | YES | activeLocale = 'id' |
| RTL only for 'ar' | YES | direction 'rtl' only for ar |
| t() returns key if translation missing (fallback) | YES | NativeLocalizationService.t |
| Dictionaries contain at least 9 keys per locale | YES | NATIVE_DICTIONARIES |

## 6. Dependencies (ports consumed)
None — pure leaf, no external deps, only Node.js.

## 7. Tests
- `packages/settings-lego/` tsc 0 errors
- `test-enhanced.mjs` 6 locales PASS (id, en, jv, ar, zh, ru)
- `verify:fast` 10/10 PASS
- Verified in main @ 8f3f1af4: feat(i18n): implement 6-language NativeLocalizationService

## 8. Provenance
Reference: n8n 2.9.4 `settings.store.ts` + Phase 4B i18n, implemented 1:1 in `packages/settings-lego/src/settings.ts`, integrated in `reconstructed-engine/src/settings/` with locale switching, translation, direction.
