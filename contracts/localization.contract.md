# LEGO Contract: Localization (Backend i18n / Phase 4B)

**Derived from:** Phase 4B directive (commit `8f3f1af4` on `main`,
`packages/workflow-lego/src/backend-localization-service.ts`) and the n8n 2.9.4
error/`continueOnFail` semantics in
`reference/n8n/packages/core/src/execution-engine/workflow-execute.ts:1823-1899`.
**Owner:** agent-9 lineage (Arena session `arena/01a0b100-n8n-rust-v-4`)
**Status:** TESTED (12/12 unit tests, see `results/SWARM-PHASE4-11.md`)

---

## 1. Boundary — apa yang dimiliki modul ini

| dimiliki | TIDAK dimiliki |
| :--- | :--- |
| kamus 6 bahasa (`id`, `en`, `jv`, `ar`, `zh`, `ru`) | seluruh UI / Vue SPA `editor-ui` (DILARANG disentuh) |
| metadata locale (`name`, `nativeName`, `direction` ltr/rtl) | pemilihan bahasa di frontend (tetap milik UI asli n8n) |
| rantai fallback terjemahan + substitusi `{placeholder}` | kredensial, ekspresi `{{ }}`, persistensi |
| kalimat status eksekusi milik mesin (sukses / gagal / berhenti) | semantik DAG (milik `workflow` LEGO) |

## 2. Provided surface

```typescript
// packages/workflow-lego/src/backend-localization-service.ts  (kanonik Phase 4B)
type SupportedLocale = 'id' | 'en' | 'jv' | 'ar' | 'zh' | 'ru';
SUPPORTED_LOCALES: Record<SupportedLocale, LocaleMetadata>;   // incl. direction
NATIVE_DICTIONARIES: Record<SupportedLocale, Record<string, string>>;
class NativeLocalizationService {
  static setLocale(locale: SupportedLocale): void;
  static getLocale(): SupportedLocale;                        // default 'id'
  static getSupportedLocales(): LocaleMetadata[];
  static translate(key: string, locale?: SupportedLocale): string;
}

// packages/reconstructed-engine/src/engine-i18n.ts  (lapisan mesin, aditif)
ENGINE_DICTIONARIES: Record<SupportedLocale, Record<string, string>>;
resolveLocale(input?: string | null): SupportedLocale;         // 'id-ID' | 'ar_SA' | null -> locale
getTextDirection(locale: SupportedLocale): 'ltr' | 'rtl';
translateEngine(key: string, params?: TranslationParams, locale?: SupportedLocale): string;
getEngineLocales(): LocaleMetadata[];

// packages/reconstructed-engine/src/localized-run-reporter.ts
renderRunReport(result: EngineRunResult, durationMs?: number): RunReport;
```

### Key milik mesin

| key | placeholder |
| :--- | :--- |
| `engine.node.success` | `{node}` |
| `engine.node.error` | `{node}`, `{error}` |
| `engine.node.continued` | `{node}` |
| `engine.run.completed` | `{nodes}`, `{durationMs}` |
| `engine.run.stopped` | `{node}` |
| `engine.run.empty` | — |

## 3. Jaminan perilaku (diuji)

1. **Fallback deterministik** — `ENGINE_DICTIONARIES[locale]` → `NATIVE_DICTIONARIES[locale]`
   → kamus `en` → key mentah. Key yang tidak dikenal **tidak pernah** melempar.
2. **Placeholder tanpa nilai dibiarkan apa adanya** (`{error}`), tidak menjadi `"undefined"`.
3. **`resolveLocale`** menerima tag BCP-47 (`id-ID`, `ar_SA`, `zh-CN`); input tak dikenal
   kembali ke locale aktif service (default `id`).
4. **RTL** hanya untuk `ar`; lima lainnya `ltr`.
5. **Service kanonik tidak diubah** (sha256 `4de13bd3…` identik dengan `main`), sehingga
   merge antar garis keturunan agen bebas konflik.

## 4. Dampak pada hasil eksekusi (`runner.mjs`)

Setiap hasil `runWorkflow()` kini membawa `locale` dan `message`; setiap entri
`executionLog` membawa `label` (key kanonik `node.success`/`node.error`) dan `message`
(kalimat lengkap). Kolom lama (`node`, `type`, `inputCount`, `outputCount`,
`durationMs`, `status`) **tidak berubah** — perubahan bersifat aditif.

Semantik kegagalan mengikuti n8n 2.9.4:

- node gagal **dicatat** dengan `status: 'error'` + `error` (pesan asli dipertahankan);
- eksekusi **dilanjutkan** hanya bila `node.continueOnFail === true` atau
  `node.onError ∈ {continueRegularOutput, continueErrorOutput}` — data masukan node
  diteruskan ke hilir dan entri log diberi `note`;
- selain itu eksekusi **berhenti**: `{ status: 'ERROR', finished: false, error }`,
  node hilir tidak dijalankan;
- alur kerja tanpa node melempar `Error` ber-`code: 'NO_NODES'` dengan pesan terlokalisasi.

## 5. Larangan

- **TIDAK ADA** perubahan pada `reference/n8n/**`, tema/CSS/icon, atau bundle Vue `editor-ui`.
- **TIDAK ADA** kode Rust (`crates/**`, `apps/**`) untuk LEGO ini.
- Service kanonik Phase 4B hanya boleh diperluas lewat lapisan mesin, tidak diedit langsung.
