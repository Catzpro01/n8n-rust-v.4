# LEGO Contract: Localization (Native Multi-Language Runtime)

| | |
|---|---|
| Owner | Agent 5 (integration), Phase 4C continuation of the Phase 4A/4B line |
| LEGO | `localization` — locale resolution, direction, interpolation, engine status messages |
| Reference | n8n 2.9.4 (`reference/n8n`) for **boundary discipline only**: no runtime behavior of the reference is replaced or re-interpreted here |
| Implementation | `packages/workflow-lego/src/localization-runtime.ts` (Phase 4C), with `settings-localization-adapter.ts` (4A) and `backend-localization-service.ts` (4B) as injected collaborators |
| Blueprint | `docs/isolation/localization.md` |
| Tests | `packages/workflow-lego/test/06-localization-runtime.test.ts` — **31/31 PASS** |
| Gate / evidence | `tools/localization-gate.mjs` → `docs/isolation/evidence/localization-gate.json` — **7/7 PASS** |
| Status | **TESTED** (no reference path touched, UI untouched, opt-in module) |

## 1. Purpose

Give the reconstructed backend **one deterministic way to speak the operator's language**: turn an
untrusted locale tag coming from settings, environment or a request into a canonical language,
resolve the correct text for a message key, expose the script direction (RTL/LTR) that downstream
serializers need, and record every key that could not be translated — **without ever making an
execution fail because of a translation**.

## 2. Inputs

| Input | Type | Producer |
|---|---|---|
| Message key | `string` (dotted, e.g. `settings.title`, `node.error`) | engine, API envelope, execution logger |
| Interpolation params | `Record<string, string \| number \| boolean \| null \| undefined>` | engine run data |
| Explicit locale | `string \| null \| undefined` (any BCP-47-ish tag) | caller (API payload, per-run override) |
| Locale source | `{ getLocale(): string \| null \| undefined }` (port) | Phase 4A settings adapter, request context, `fromEnvironment()` |
| Dictionaries | `{ translate(key, locale?): string }` (port) | Phase 4B `NativeLocalizationService` |
| Overlay | `Record<locale, Record<key, string>>` | product/engine additions, tests |
| Execution status | `'success' \| 'error' \| 'running' \| 'waiting' \| 'cancelled'` | engine per-node run |

## 3. Outputs

| Output | Shape |
|---|---|
| `normalizeLocale(tag)` | canonical code (`'id' \| 'en' \| 'jv' \| 'ar' \| 'zh' \| 'ru'`) or `null` — **never a guess** |
| `directionOf(tag)` | `'ltr' \| 'rtl'`; unknown input → `'ltr'` (never throws) |
| `interpolate(template, params)` | `string` with `{x}` / `{{ x }}` filled; unknown placeholders left verbatim |
| `LocalizationRuntime#t(key, params?, locale?)` | translated + interpolated `string`; missing key → the key itself, recorded in diagnostics |
| `LocalizationRuntime#tStatus(status)` | localized status text (`success` → "Execution succeeded" / "Berhasil dieksekusi") |
| `LocalizationRuntime#snapshot()` | `{ locale, direction, fallbackLocale, supportedLocales, missingKeys }` — per-run audit payload |
| `dictionaryParity(dictionaries, ref)` | `{ consistent, missingByLocale, extraByLocale, emptyValues }` |

## 4. Responsibilities

1. **Locale normalization.** Fold case, `_`/`-` separators and script/region subtags
   (`ID_id`, `zh-Hans-CN`, `ar-SA`, `ru_RU`); resolve ISO-639-1 legacy codes (`in` → `id`,
   `jw` → `jv`, `cmn` → `zh`) and endonyms (`bahasa`, `mandarin`). Anything outside the catalog
   resolves to `null` — the runtime never invents a language.
2. **Resolution chain.** `explicit argument` → `locale source` → `fallbackLocale` (default `en`).
   An explicit `setLocale()` value outranks the sources until `clearLocale()`.
3. **Fail-safe degradation.** A source that throws, or supplies an unknown tag, degrades to the next
   link in the chain. Resolution failures are **never** propagated to an execution.
4. **Direction exposure.** `rtl` for Arabic, `ltr` for the other five, derived from the single
   catalog table that is also the drift gate against Phase 4B.
5. **Interpolation.** `{name}` and `{{ name }}`; numbers/booleans stringified; `null`/`undefined`
   params (and missing params) leave the placeholder visible instead of producing an empty string.
6. **Engine status mapping.** Exactly five statuses map to message keys; `success`/`error` resolve
   from the Phase 4B dictionaries, `running`/`waiting`/`cancelled` from the engine overlay owned by
   this module. An unmapped status is echoed and *diagnosed*, never invented.
7. **Diagnostics.** Every key that fell through to itself is collected once, sorted, and exposed via
   `getMissingKeys()` / `snapshot()`; `resetDiagnostics()` scopes the collection to a single run.
8. **Determinism.** The active locale is instance state; the Phase 4B static `activeLocale` is never
   read or written, so two runtimes cannot influence each other.

## 5. Non-responsibilities

1. **Not a UI feature.** `editor-ui`, `@n8n/i18n`, `@n8n/design-system` and every Vue bundle in
   `reference/n8n` stay byte-identical (PROJECT_RULES #2). This module produces **backend** message
   strings and direction metadata only; it ships no bundle, no CSS and no template.
2. **Not the dictionary owner.** The canonical language table, the native names and the product
   strings belong to Phase 4B (`backend-localization-service.ts`). This module consumes them through
   a port and never imports, re-exports or mutates them.
3. **Not the settings owner.** Which language the operator picked, where it is persisted and when it
   is updated belongs to Phase 4A / the settings API. The runtime only *reads* through a port.
4. **Not the reference behavior.** n8n 2.9.4 has no equivalent module; nothing in
   `reference/n8n/packages/workflow` is replaced, wrapped or re-interpreted, and the isolation
   invariants (`boundary audit`, `reference integrity 15050 / f8da35180669`) are untouched.
5. **No execution semantics.** This module never decides whether a node succeeds, retries or fails;
   it only phrases what already happened.

## 6. Dependencies

| Dependency | Direction | How it is bound |
|---|---|---|
| Phase 4B `NativeLocalizationService` | consumed | injected as `dictionaries` port (structural, no import) |
| Phase 4A `SettingsLocalizationAdapter` | consumed | injected as `localeSource` port via `fromSettingsState()` |
| Environment (`N8N_DEFAULT_LOCALE`, `LANG`) | consumed | injected via `fromEnvironment(env)` — **no `process.env` read inside the module** |
| `node:` core modules | **none** | zero imports: the module is pure TypeScript |

The module deliberately has **no imports at all**, so it cannot create a hidden LEGO edge; the
`tools/workflow-boundary-map.mjs --check` result is unchanged.

## 7. Error behavior

| Situation | Behavior |
|---|---|
| `normalizeLocale` receives a non-string, empty or unknown tag | returns `null` (no throw) |
| `setLocale('de-DE')` (explicit, programmatic) | throws `UnsupportedLocaleError` carrying `input` and `supported` |
| Locale source throws | swallowed → next link in the chain (`fallbackLocale` last) |
| Dictionary port throws | swallowed → key fallback + diagnostics entry |
| Key not present in any dictionary/overlay | returns the **key** (visible defect) and records it once |
| Placeholder without a param | placeholder is preserved verbatim |
| `tStatus` receives an unmapped status | returns the status string and records `status.<status>` |
| Unknown locale passed to `directionOf` | `'ltr'` (never throws; renderers cannot crash on it) |

## 8. Lifecycle

```text
construct(runtime)  →  optional setLocale(override)  →  getLocale()/resolveLocale() on every read
    │
    ├─ per message: t() / tStatus()  →  overlay → dictionary → en-overlay → en dictionary → key
    │                                    └── miss → diagnostics (deduplicated)
    └─ per run: snapshot() into run data  →  resetDiagnostics() between executions
```

No filesystem, database or network access at any point; the object is a plain in-memory runtime.

## 9. Data ownership

* **Owned here:** catalog table (`LOCALE_CATALOG`), alias table, engine status keys/overlay,
  diagnostics set, interpolation semantics.
* **Borrowed (read-only):** Phase 4B dictionaries and `SUPPORTED_LOCALES`; Phase 4A settings state.
* **Never written:** `NATIVE_DICTIONARIES`, `SUPPORTED_LOCALES`, `ENGINE_STATUS_OVERLAY`
  (overlays are deep-copied before merge), the 4A adapter state, `reference/n8n/**`, `results/**`.

## 10. External interfaces

| Consumer | Interface used |
|---|---|
| Execution logger / run data | `runtime.snapshot()` |
| API envelope / error payloads | `runtime.t(key, params)` |
| Per-node status line | `runtime.tStatus(status)` |
| Settings API (read path) | `fromSettingsState(adapter)` as `localeSource` |
| CLI / worker bootstrap | `fromEnvironment(env)` / `fromConstant(code)` / `firstResolvingSource(...)` |
| Evidence tooling | `tools/localization-gate.mjs` (imports the module directly; `--json` for CI) |

## 11. Compatibility requirements

1. **Catalog parity (drift gate):** `LOCALE_CATALOG` must remain field-identical to Phase 4B
   `SUPPORTED_LOCALES` — asserted by test L5 and gate check G2.
2. **Dictionary parity:** every locale carries the same key set as `en`, with no empty values —
   asserted by test L4 and gate check G4.
3. **Status coverage:** all five engine statuses resolve in all six locales — gate check G7.
4. **Additive only:** existing 4A/4B files may gain behavior, but existing signatures, exported
   names and dictionary contents must not change. This module never edits them at runtime.
5. **Erasable-syntax TypeScript:** no enums, namespaces or parameter properties, so the module runs
   unchanged under `node --test` (Node ≥ 22) and under `tsc`.
6. **LEGO surface untouched:** `src/index.ts` and the port-surface manifest are intentionally
   unchanged in Phase 4C (the 4A/4B modules are equally unexported); promoting the line into the
   public surface is a separate phase with its own manifest update.
