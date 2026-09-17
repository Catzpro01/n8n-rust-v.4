# LEGO Isolation Blueprint: Localization (Phase 4B — Backend Native Localization Hub)

**Agent:** Agent 1 — Workflow Engineer (settings-ui line, branch `arena/01a0b104-n8n-rust-v-4`)
**Reference:** n8n 2.9.4 — `reference/n8n/packages/frontend/@n8n/i18n` (`@n8n/i18n@2.9.2`, pinned tree `f8da35180669d798`)
**Contract:** `contracts/i18n.contract.md`
**Gate:** `npm run i18n:check` → `docs/isolation/evidence/localization-hub.json`
**Status:** TESTED — 26/26 behaviour tests (Phase 4C adds the two validator tests) · L01–L05 PASS · repository gate 11/11 unaffected

---

## 1. Boundary

| | Path | Role |
|---|---|---|
| OWNED (implemented) | `packages/workflow-lego/src/backend-localization-service.ts` | six-locale registry, dictionaries, resolution |
| OWNED (implemented) | `packages/workflow-lego/src/settings-localization-adapter.ts` | settings state projection (Phase 4A, now derived) |
| OWNED (verification) | `packages/workflow-lego/test/06-localization.test.mjs`, `tools/localization-hub-check.mjs`, `tools/localization-module-loader.mjs` | behaviour suite + Phase 4B gate |
| GENERATED | `docs/isolation/evidence/localization-hub.json` | machine-readable verdict, locales, parity, digests |
| FORBIDDEN (read-only) | `reference/n8n/**` — in particular the Vue `editor-ui` bundle | UI must stay 100% identical (PROJECT_RULES §2, `L04`) |
| FORBIDDEN | `crates/**`, `apps/**` | ZERO RUST in this phase (PROJECT_RULES §1) |

**Import hygiene (verified by `L03`):** `backend-localization-service.ts` imports nothing at all — no n8n
runtime, no port, no external package. `settings-localization-adapter.ts` imports exactly one relative
module (the hub). The Vue editor bundle was not touched: `L04` re-runs the reference manifest check
(15,050 files, root `f8da35180669d798…`).

## 2. Reference grounding (what is mirrored, what is not)

The isolation copies the **mechanism** of the reference i18n module, not its Vue bindings:

| Reference (`@n8n/i18n`) | This LEGO |
|---|---|
| `createI18n({ legacy:false, locale:'en', fallbackLocale:'en', messages:{ en } })` | `FALLBACK_LOCALE = 'en'`; English base text terminates every chain (`LOCALE_ORDER`, `fallbackChain()`) |
| `warnHtmlMessage: false` | interpolation inserts values verbatim; HTML is never escaped (test 11) |
| `I18nClass.t(key, { interpolate })` | `translate(key, { interpolate })` — `{name}` placeholders, unknown ones stay visible |
| `adjustToNumber` call sites (plural handling) | `translate(key, { count })` → `one \| many` choice + `{count}` |
| `LocaleMessages = typeof englishBaseText & { numberFormats }` | `NATIVE_NUMBER_FORMATS` per locale + `formatNumber()` |
| `GetBaseTextKey<T> = T extends \`_${string}\` ? never : T` | `isTranslatableKey()`; `_`-keys excluded from `listKeys()`/parity |
| `src/locales/en.json` (English only) | `BASE_LOCALE_MESSAGES`; the six translations are product-supplied |
| reactive `i18nVersion` ref | `onLocaleChange(listener)` (backend equivalent, no Vue) |

Not reconstructed (out of scope, still reference-owned): vue-i18n itself, `INodeTranslationHeaders`
(node-model LEGO), the editor's `<i18n-t>` components, and the REST layer that will serve the payload.

## 3. Locale set and fallback chains

| Locale | Native name | Direction | Declared chain | Accepted input tags |
|---|---|---|---|---|
| `id` | Bahasa Indonesia | ltr | — | `id-ID`, `in`, `ID_id`, `bahasa` |
| `en` | English (US) | ltr | — (base text) | `en-US`, `en_GB`, `english` |
| `jv` | Basa Jawa | ltr | `→ id → en` | `jw`, `jv-ID`, `jav` |
| `ar` | العربية | **rtl** | `→ en` | `ar-SA`, `arb`, `ar_EG` |
| `zh` | 中文 (简体) | ltr | `→ en` | `zh-CN`, `zh_Hans`, `zh-TW`, `zho`, `chi`, `cmn` |
| `ru` | Русский | ltr | `→ en` | `ru-RU` |

Anything else (`de-DE`, `klingon`, `42`, `null`) normalises to `en`, matching the reference
`fallbackLocale` behaviour; `matchLocale()` exposes the *unresolved* answer for callers that must know.

## 4. What changed in Phase 4B (compared to the first implementation)

The first cut of the hub shipped the six dictionaries but left five production gaps; all five are closed here:

1. **No parity enforcement** → every locale is now proven key-identical to the English base
   (`parityReport()`, `L01`, tests 2–3), and an injected locale-only key fails the gate.
2. **API could only translate** → interpolation (`{name}`), plural choice (`one | many`), `defaultValue`
   and `fallback: false` are implemented with reference semantics.
3. **Silent locale handling** → `normalizeLocale`/`matchLocale`/`resolveAcceptLanguage` handle BCP-47
   tags, legacy codes (`in`, `jw`, `zho`, `chi`, `cmn`, `arb`), `q`-weighted negotiation and wildcards.
4. **RTL metadata unused** → `getDirection()` / `isRtl()` expose it (Arabic only), so a consumer cannot
   guess.
5. **Two competing language lists** → the Phase 4A adapter now derives its list from `SUPPORTED_LOCALES`
   (no second list, `L05`), and the hub gained change notification plus an injectable persistence port so
   the stored user preference is honoured without the hub knowing about a database.

### 4.1 The Phase 4B seed merge (24 keys surface, browser storage)

The branch also carried a second Phase 4B pass (`da1654a8`) that widened the dictionaries from
9 to **23 keys per locale**, added `isRTL`/`getDirection`, `formatExecutionMessage`, an update-banner
suppression flag and `localStorage` reads. That work is merged here rather than replaced:

| Seed behaviour | Kept as |
|---|---|
| 23 keys x 6 locales | the dictionaries are merged verbatim; `parityReport()` proved 23 keys at merge time (27 after Phase 4C below) |
| (Phase 4C) `param.*` validation keys | four keys added per locale (27 total) so `NodeParameterValidator` (Phase 3C) renders its issues through the hub; the Indonesian default output stays byte-identical to Phase 3C |
| `localStorage.getItem('n8n_locale')` inside `getLocale()` | `attachBrowserStorage()` → persistence port + `hydrate()` (the hub stays free of globals in Node) |
| `suppressUpdateBanner()` writing the flag directly | same name, writes through browser storage when present |
| `isRTL()` | kept as an alias of `isRtl()` |
| `formatExecutionMessage(key, params)` with `String.replace` (first occurrence only) | re-implemented on `translate(key, { interpolate })` — every occurrence is replaced, HTML/unknown placeholders preserved |
| `getState().supportedLanguages[].label` = native name | `label` = English name, `nativeLabel`/`nativeName` = native name (both call shapes work) |

### 4.2 Phase 4C — the parameter validator joins the hub (27 keys)

`NodeParameterValidator` (Phase 3C, `parameter-issues.ts`) was the last Phase 3/4 module with
hardcoded monolingual strings. It now renders every issue through the hub:

* four keys per locale — `param.required`, `param.invalid_number`, `param.below_min`,
  `param.above_max` — take the dictionaries from 23 to **27 keys**, key parity still proven by
  `parityReport()` / `L01`;
* the messages are resolved with `translate(key, { interpolate })`, so they follow the active
  locale, the declared fallback chains and the adapter's `setLanguage()` (single entry point);
* the Indonesian default output is **byte-identical to Phase 3C** (pinned by test 25), so no
  existing consumer sees a behaviour change;
* the boundary is unchanged: the validator imports only the hub (`L03` extended to prove it),
  and `tools/localization-module-loader.mjs` compiles it alongside the hub and the adapter so
  the offline suite covers the whole Phase 4 stack.

## 5. How to verify

```bash
npm install --prefix packages/workflow-lego     # typescript (the gate compiles the TS on the fly)
npm run i18n:check                              # L01–L05 → docs/isolation/evidence/localization-hub.json
node --test packages/workflow-lego/test/06-localization.test.mjs   # behaviour suite (offline)
npm run isolation:check                         # boundary/kernel/port/reference unaffected
npm run verify                                  # full 11-gate repository regression
```

## 6. Risks / open points

- **Translations are product text, not reference text.** The suite never asserts wording; a bad
  translation must be caught by review, not by this gate.
- **Locale coverage is six by product decision.** Adding a seventh locale is a data change
  (`SUPPORTED_LOCALES` + dictionaries + `NATIVE_NUMBER_FORMATS`); the parity gate then fails until the
  new locale is complete, which is the intended pressure.
- **`accept-language` negotiation is stand-alone.** When the REST settings layer is reconstructed it must
  call `resolveAcceptLanguage()` instead of parsing the header itself.
- **`reconstructed-engine/src/settings-localization.ts` still holds the old two-language manager.** That
  package is quarantined by `ISSUE-022` (nothing imports it, it is unbuilt and untested); this hub is the
  canonical implementation and the quarantine must not be built on until `ISSUE-021/022` are resolved.
