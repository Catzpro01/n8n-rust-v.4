# LEGO Contract: Localization (Native Multi-Language Runtime)

| | |
|---|---|
| Owner | Agent 5 (integration), Phase 4C continuation of the Phase 4A/4B line |
| LEGO | `localization` — locale resolution, direction, interpolation, engine status messages |
| Reference | n8n 2.9.4 (`reference/n8n`) for **boundary discipline only**: no runtime behavior of the reference is replaced or re-interpreted here |
| Implementation | `packages/workflow-lego/src/localization-runtime.ts` (4C) + `localization-envelope.ts` (4E) + `localization-vocabulary.ts` / `execution-log-record.ts` / `api-error-response.ts` (4F), with `settings-localization-adapter.ts` (4A) and `backend-localization-service.ts` (4B) as injected collaborators |
| Blueprint | `docs/isolation/localization.md` |
| Tests | `06-localization-runtime.test.ts` (33) + `07-localization-envelope.test.ts` (17) + `08-localization-run-path.test.ts` (27) — **77/77 PASS** |
| Gate / evidence | `tools/localization-gate.mjs` → `docs/isolation/evidence/localization-gate.json` — **15/15 PASS** |
| Surface | promoted in Phase 4D/4E/4F: `src/index.ts` re-exports 57 runtime + 26 type symbols (`LocalizationRuntime`, `LOCALE_CATALOG`, `buildRunEnvelope`, `buildExecutionLogRecord`, `buildApiErrorResponse`, …) |
| Runnable view | `node tools/localization-inspect.mjs [--lang … --key …] [--envelope] [--record] [--api-error <code>]` |
| Status | **TESTED** (no reference path touched, UI untouched) |

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
| Node run result | `{ nodeName, status, itemCount?, durationMs? }` (plain data) | execution engine / run data |
| API error code | `'badRequest' \| 'unauthorized' \| 'notFound' \| 'conflict' \| 'internal'`, any other string, or a numeric code (reference `errorCode \|\| httpStatusCode`) | API layer |
| Run identity | `{ executionId, workflowName, status, nodes?, itemCount?, durationMs?, locale? }` | execution logger |
| Overlay | `Record<locale, Record<key, string>>` | product/engine additions, tests |
| Execution status | `'success' \| 'error' \| 'running' \| 'waiting' \| 'cancelled'` | engine per-node run |
| Run record input | `{ executionId, workflowId, workflowName, mode, status, startedAt, stoppedAt?, durationMs?, itemCount?, nodes?, locale? }` (plain data) | execution logger |
| Run mode | `'manual' \| 'webhook' \| 'schedule'` (`RUN_MODES`) | trigger layer |
| Error payload extras | `{ params?, meta?, stacktrace?, rawMessage?, httpStatusCode? }` | API layer (route-specific detail) |

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
| `buildRunEnvelope(input, runtime)` | `RunEnvelope` — locale, direction, `message`, 5 `messages`, `labels`, `nodeStatusLines`/`nodeLines`, `diagnostics.missingKeys`; deterministic and JSON-safe |
| `localizeNodeStatus(result, runtime, locale?)` | `{ statusText, itemsText?, durationText?, line }` — `line` renders `[Node] Status (n item, m ms)` |
| `localizeApiError(code, runtime, params?, locale?)` | `{ code, messageKey, message, fallbackUsed }` — unknown codes echo the raw code and record diagnostics |
| `createProductRuntime(options?)` | `LocalizationRuntime` composed of the frozen 4B catalogue, the engine/API overlay (4E) and `PRODUCT_DICTIONARY_EXTENSION` (4F) — the runtime the backend run path actually uses |
| `productKeys(locale?)` | the 12 product keys of that locale, or `[]` for an unknown locale (never throws) |
| `runSummary(status, parts, runtime, locale?)` | `{ text, isSummary, messageKey, droppedParts }` — localized sentence only when duration **and** node count **and** item count are present; otherwise the lifecycle text with `isSummary: false` |
| `triggerLabel(mode, runtime, locale?)` | localized trigger label for `RUN_MODES`; an unknown mode is echoed and diagnosed |
| `nodeStateLabel(state, runtime, locale?)` | localized `skipped`/`disabled`; anything else falls back to the engine status text (diagnosed) |
| `buildExecutionLogRecord(input, runtime?)` | `ExecutionLogRecord` — `id`, `workflowId`, `workflowName`, `mode`, `status`, `startedAt`, `stoppedAt`, `durationMs`, `totalItems`, `nodeRuns[]`, `localized` block, `redacted` — JSON-safe and deterministic |
| `durationBetween(startedAt, stoppedAt?)` | non-negative `number` or `null` (unparseable, missing, or negative input is refused — never clamped) |
| `formatExecutionLogLine(record)` | one console/log line: `ID NAME [mode] summary-or-message` |
| `buildApiErrorResponse(input, runtime?)` | `{ statusCode, body, localized }` with `body = { code, message, hint?, meta?, stacktrace? }` per `contracts/api.contract.md` §3 — known code → localized envelope, unknown string → `{ code: 0 }`, numeric code → passed through (`{ code: 401, message: rawMessage }` reproduces the reference login payload byte-for-byte) |
| `buildApiSuccessResponse(data, statusCode?)` | `{ statusCode, body: { data } }` — the reference success wrapper, nothing added |
| `buildHealthResponse(state, runtime?, locale?)` | `{ statusCode: 200 \| 503, body: { status: 'ok' \| 'error', label } }` — the machine field stays untranslated |

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
9. **Consumer seam (Phase 4E, `localization-envelope.ts`).** Assemble the values the backend actually
   persists or returns: the **run envelope** (`buildRunEnvelope()` — execution id, workflow name,
   status, locale, direction, five lifecycle messages, item/node/duration labels, per-node status
   lines, diagnostics), the **node status line** (`localizeNodeStatus()`), and the **API error
   mapping** (`localizeApiError()` over `API_ERROR_CODES`). It also owns the engine/API **vocabulary
   extension** (`ENVELOPE_DICTIONARY_EXTENSION`, 14 keys × 6 locales) instead of editing the frozen
   Phase 4B catalogue — the parity rules of §11.2 apply to it unchanged.
10. **Product vocabulary (Phase 4F, `localization-vocabulary.ts`).** Own the product-side
   vocabulary that neither 4B (user-visible shell strings) nor 4E (engine/API vocabulary) claims:
   **run summaries**, **trigger labels**, the two extra **node states** and the **API hint** keys —
   `PRODUCT_DICTIONARY_EXTENSION`, 12 keys × 6 locales. `createProductRuntime()` is the single
   composition point (frozen 4B catalogue + 4E overlay + this overlay); nobody else may stack
   overlays, so "which runtime does the backend use?" has exactly one answer. `runSummary()` is the
   only summary formatter and refuses to emit half a sentence: without duration, node count **and**
   item count it returns the localized lifecycle text with `isSummary: false` and names what was
   missing in `droppedParts`. `triggerLabel()` covers exactly `RUN_MODES`; an unknown mode is echoed
   and diagnosed (`execution.trigger.<mode>`), never guessed.
11. **Run-path seam (Phase 4F, `execution-log-record.ts` + `api-error-response.ts`).** Turn the
   envelope into the two things the run path actually hands out:
   * the **persisted execution record** (`buildExecutionLogRecord()`) carrying the execution-row field
     names (`id`, `workflowId`, `workflowName`, `mode`, `status`, `startedAt`, `stoppedAt`,
     `durationMs`, `totalItems`, `nodeRuns`) plus a **localized block resolved at write time**
     (`locale`, `direction`, `message`, `summary`, `trigger`, `labels`, `nodeLines`, `missingKeys`).
     Labels and node lines come from `buildRunEnvelope()`, never re-formatted here, so the log and the
     envelope cannot disagree. Timestamps arrive as ISO strings and the duration is *derived*
     (`durationBetween()`); an unusable or negative span becomes `null` — never `0`, never clamped.
     The clock is not read: the record is reproducible from its input alone.
   * the **localized HTTP payloads** (`buildApiErrorResponse()`, `buildApiSuccessResponse()`,
     `buildHealthResponse()`) that reproduce `contracts/api.contract.md` §3 1:1: known error codes map
     through `HTTP_STATUS_BY_ERROR_CODE` to `{ code, message, hint? }` (+`meta`/`stacktrace` when the
     route supplied them), an **unknown** code degrades to the reference generic shape
     `500 { code: 0, message }` while the raw code survives in `localized.rawCode`, success is exactly
     `{ data }`, and health is `{ status, label }` with the machine field (`ok`/`error`, 200/503)
     never translated. These are **shapers, not transports**: no status code is chosen for a route
     here, no body is serialized to a socket, and `rawMessage` always wins because the caller owns
     that text.

## 5. Non-responsibilities

1. **Not a transport or a logger.** The envelope layer *shapes* run data and error payloads; it
   never writes them. Persisting run data, emitting logs and sending HTTP responses belong to the
   persistence/API LEGOs — they consume the envelope, they are not replaced by it.
2. **Not a UI feature.** `editor-ui`, `@n8n/i18n`, `@n8n/design-system` and every Vue bundle in
   `reference/n8n` stay byte-identical (PROJECT_RULES #2). This module produces **backend** message
   strings and direction metadata only; it ships no bundle, no CSS and no template.
3. **Not the dictionary owner.** The canonical language table, the native names and the product
   strings belong to Phase 4B (`backend-localization-service.ts`). This module consumes them through
   a port and never imports, re-exports or mutates them.
4. **Not the settings owner.** Which language the operator picked, where it is persisted and when it
   is updated belongs to Phase 4A / the settings API. The runtime only *reads* through a port.
5. **Not the reference behavior.** n8n 2.9.4 has no equivalent module; nothing in
   `reference/n8n/packages/workflow` is replaced, wrapped or re-interpreted, and the isolation
   invariants (`boundary audit`, `reference integrity 15050 / f8da35180669`) are untouched.
6. **No execution semantics.** This module never decides whether a node succeeds, retries or fails;
   it only phrases what already happened.
7. **Not a database, a router or a serializer.** The run-path seam (Phase 4F) shapes records and
   payloads; writing rows, choosing routes, registering middleware, serializing to a socket and
   redacting secrets stay with the persistence/API LEGOs. The `redacted` field of a record is a
   placeholder the owner of that data fills — this module never inspects payloads.

## 6. Dependencies

| Dependency | Direction | How it is bound |
|---|---|---|
| Phase 4B `NativeLocalizationService` | consumed | injected as `dictionaries` port (structural, no import) |
| Phase 4A `SettingsLocalizationAdapter` | consumed | injected as `localeSource` port via `fromSettingsState()` |
| Environment (`N8N_DEFAULT_LOCALE`, `LANG`) | consumed | injected via `fromEnvironment(env)` — **no `process.env` read inside the module** |
| Execution engine / API / logger | consumed | **data only** — `NodeRunResult`, error codes and run identity are plain values passed in |
| `node:` core modules | **none** | zero imports: the runtime is pure TypeScript; the envelope imports only the two modules above |

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
| API error code without vocabulary | `fallbackUsed: true`, `message` = the raw code, diagnostics record `api.error.<code>` |
| Node run without item count/duration | the corresponding label is omitted from the envelope (never a placeholder) |

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
| Execution logger / run data | `buildRunEnvelope(input, runtime)` — the block persisted per execution |
| Run log lines | `localizeNodeStatus(result, runtime)` |
| API error responses | `localizeApiError(code, runtime)` / `API_ERROR_CODES` |
| Health endpoint | `runtime.t('api.health.ok')` |
| CLI / worker bootstrap | `fromEnvironment(env)` / `fromConstant(code)` / `firstResolvingSource(...)` |
| Evidence tooling | `tools/localization-gate.mjs` (imports the module directly; `--json` for CI) |
| Execution logger (records) | `buildExecutionLogRecord(input, runtime)` / `formatExecutionLogLine(record)` |
| Run-path re-render | `relocalizeNodeLine(nodeRun, runtime, locale)` — view a stored run in another locale |
| API router (error) | `buildApiErrorResponse(input, runtime)` / `HTTP_STATUS_BY_ERROR_CODE` |
| API router (success) | `buildApiSuccessResponse(data, statusCode?)` |
| Health/readiness probe | `buildHealthResponse('ready' \| 'not-ready', runtime?, locale?)` |
| Backend bootstrap | `createProductRuntime(options)` — the composed runtime used by the run path |
| Manual inspection | `tools/localization-inspect.mjs --record` / `--api-error <code>` |

## 11. Compatibility requirements

1. **Catalog parity (drift gate):** `LOCALE_CATALOG` must remain field-identical to Phase 4B
   `SUPPORTED_LOCALES` — asserted by test L5 and gate check G2.
2. **Dictionary parity:** every locale carries the same key set as `en`, with no empty values —
   asserted by test L4 and gate check G4.
3. **Status coverage:** all five engine statuses resolve in all six locales — gate check G7.
4. **Additive only:** existing 4A/4B files may gain behavior, but existing signatures, exported
   names and dictionary contents must not change. This module never edits them at runtime. New
   vocabulary goes into `ENVELOPE_DICTIONARY_EXTENSION` (4E), never into the frozen 4B catalogue.
5. **Envelope stability:** the `RunEnvelope` field set is additive-only; consumers may rely on
   `executionId`, `status`, `locale`, `direction`, `message`, `messages`, `labels` and
   `nodeLines` always being present, and on the envelope being JSON round-trippable.
6. **Erasable-syntax TypeScript:** no enums, namespaces or parameter properties, so the module runs
   unchanged under `node --test` (Node ≥ 22) and under `tsc`.
7. **Surface promotion (Phase 4D/4E).** `src/index.ts` re-exports every runtime symbol of
   `localization-runtime.ts` and `backend-localization-service.ts`, and those two modules import
   nothing — so the promotion adds surface without adding a dependency edge (the port-surface
   manifest is unchanged because the *consumed* port set is unchanged). The UI-owned Phase 4A module
   (`settings-localization-adapter.ts`) is deliberately **not** promoted (PROJECT_RULES #2).
   Gate checks G8 (symbol/type parity, UI module excluded) and G9 (the surface is runnable from a
   checkout via `tools/localization-inspect.mjs`) enforce this on every run.
8. **Reference-exact API payloads.** The wire shapes are fixed by `contracts/api.contract.md` §3 and
   must not drift: success is exactly `{ data }` (no `status`, no `message` added), a known error code
   keeps its HTTP status (`400/401/404/409/500` for `badRequest/unauthorized/notFound/conflict/internal`)
   and its `{ code, message, hint? }` body, an unknown code degrades to `500 { code: 0, … }` with the
   raw code preserved in `localized.rawCode`, and health keeps `status` untranslated while adding
   `label`. The localized text lives in `message`/`hint`/`label` only — a client that ignores
   localization sees the same payload a reference client does. Asserted by test 08 (F8/F9) and gate
   check G13 (`5 codes × 6 locales` + success + health).
9. **Run-path module boundary.** `localization-vocabulary.ts`, `execution-log-record.ts` and
   `api-error-response.ts` import **only** in-package `.ts` specifiers, read no environment variable,
   read no clock (`Date.now()`/`new Date()` are forbidden — every timestamp is passed in) and use no
   global mutable state, so a record is reproducible from its input and the run path stays unit-
   testable. The 4B catalogue and the 4E overlay are never mutated, and product keys may not collide
   with keys of either earlier phase. Asserted by test 08 (F10) and gate check G14; the vocabulary
   parity rules of §11.2 apply to `PRODUCT_DICTIONARY_EXTENSION` unchanged (test 08 F1/F2, gate G14).
10. **One summary, one truth.** Run summaries are produced by `runSummary()` only — no caller
   concatenates its own "finished in …" string — and the record's `localized` block is the 4E
   envelope verbatim, so a re-rendered line (`relocalizeNodeLine()`) and the stored line cannot
   disagree. Asserted by test 08 (F5/F6).
