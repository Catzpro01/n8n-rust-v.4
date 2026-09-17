# TASK RESULT: PHASE5-WEBHOOK-PORT — registry webhook 1:1 + gate W01–W07

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-3` (Arena session `arena/01a0b104-n8n-rust-v-4`) — hardening untuk LEGO 08
- **LEGO COMPONENT**: `webhook` (`WebhookService` + `NodeHelpers` path/URL + edge helper)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Layer webhook Phase 4 mengarang semantiknya sendiri: baris di-key `${method}:${path}`, konflik
   dilempar dengan pesan buatan `'There is a conflict with one of the webhooks.'`, pencocokan dinamis
   hanya `path.includes(webhookId)`, dan path tidak pernah disusun seperti CLI (`getNodeWebhookPath`).
2. Port baru mengikuti lima sumber referensi: `NodeHelpers.getNodeWebhookPath/Url`,
   `WebhookPathTakenError`, `WebhookService` (findStatic/findDynamic/findCached/getWebhookMethods/
   storeWebhook/deleteWorkflowWebhooks + `getNodeWebhooks`), `WebhookEntity` (cacheKey/staticSegments),
   serta sanitizer request, extractor `onReceived`, payload not-found, dan `WebhookResponseHeaders`.
3. Gate `npm run webhook:check` (W01–W07) memisahkan **dua kelas bukti** dan menuliskannya di evidence:
   `getNodeWebhookPath`/`getNodeWebhookUrl`/`WebhookPathTakenError` dibandingkan terhadap build
   **`n8n-workflow@2.9.1` yang benar-benar dieksekusi** (1.728 panggilan path+URL), sedangkan bagian
   CLI yang terikat DI/TypeORM/Redis dibandingkan terhadap **transkripsi sumber referensi** — tidak
   ada check yang mengklaim oracle yang tidak dimilikinya.
4. Facade kini memakai `WebhookRegistry` (salinan `InternalWebhookEngine` dihapus) dan menyusun path
   lewat `getNodeWebhookPath`; skenario integrasi 07 ditulis ulang untuk memaku semantik asli
   (**upsert**, pencocokan dinamis, penghapusan per workflow) — bukan lagi "harus melempar konflik".
5. Lima kontrol negatif menggigit (aturan `:var`, encoding nama node, level error, pencocokan
   posisional, cookie auth), suite webhook-lego naik **6/6 → 18/18**, dan seluruh baterai hijau:
   `verify` 12/12 · connection 9/9 · trigger 6/6 · i18n 5/5 · typecheck 0 error.

---

## 1. Sebelum vs sesudah

| Aspek | Sebelum | Sesudah |
| :--- | :--- | :--- |
| Penyimpanan baris | `Map` key `${method}:${path}` + error "conflict" buatan | upsert `(method, webhookPath)` seperti referensi + cache `webhook:${method}-${uniquePath}` |
| Pencocokan dinamis | `path.includes(webhookId)` | jumlah segmen harus sama, segmen statis dibandingkan sebagai **himpunan**, paling banyak menang, fallback `:var` |
| Komposisi path | `parameters.path \|\| name.toLowerCase()` | `getNodeWebhookPath` (workflow id + nama node ter-encode, atau `webhookId`) |
| URL publik | tidak ada | `getNodeWebhookUrl` termasuk aturan `:param` (memaksa prefix webhookId) |
| Error 404 | dua pesan lepas | `webhookNotFoundErrorMessage` + hint `default`/`production` (termasuk kuirk `pop()` yang memutasi array pemanggil) |
| Sanitasi request | versi allowlist buatan | `sanitizeWebhookRequest` (`n8n-auth` + `n8n-browserId`, header **dan** cookie terparse) |
| Header respons | tidak ada | `WebhookResponseHeaders` (lower-case, buang `content-security-policy`, validasi `node:http`) |
| Duplikasi kode | facade punya salinan kedua | satu port, dipakai facade |
| Cakupan tes | 6 tes boundary | 18 tes perilaku + 1.869 panggilan diferensial |

## 2. Gate `W01`–`W07`

| Check | Cakupan | Kelas bukti |
| :--- | :--- | :--- |
| `W01` | 16 export + konstanta tipe node | oracle eksekusi |
| `W02` | `getNodeWebhookPath` 3 id × 4 node × 8 path × 9 mode | **eksekusi** `n8n-workflow@2.9.1` (864 panggilan) |
| `W03` | `getNodeWebhookUrl` 3 base URL × … × 3 mode | **eksekusi** `n8n-workflow@2.9.1` (864 panggilan) |
| `W04` | message/name/level/`cause`/rantai prototipe `WebhookPathTakenError` | **eksekusi** `n8n-workflow@2.9.1` |
| `W05` | findStatic/findDynamic/findCached/getWebhookMethods + cache + upsert + delete | transkripsi `webhook.service.ts` |
| `W06` | sanitizer, extractor, not-found, `getNodeWebhooks` 9 node × 2, `WebhookResponseHeaders` | transkripsi + `node:http` |
| `W07` | `packages/webhook-lego/test/*.test.mjs` | 18/18 |

Kontrol negatif: aturan `:var` (W03 54/864) · encoding nama node (W02 288/864) · level error (W04) ·
pencocokan posisional (W05 9/92) · cookie auth tidak dibuang (W06 4/43).

## 3. Semantik referensi yang dipaku (sering mengejutkan)

- `WebhookService.storeWebhook` **upsert**; ia tidak pernah melempar. `WebhookPathTakenError`
  (level `warning`) milik pemeriksaan konflik saat aktivasi.
- Pencocokan dinamis: `webhookId` harus sama, `pathLength` harus sama, segmen statis diuji sebagai
  himpunan, dan baris `:var` murni menjadi fallback "cocok dengan apa saja".
- `findCached` hanya meng-cache hit **statis**.
- `webhookNotFoundErrorMessage` memutasi array method pemanggil (`pop()`), dan hint hanya muncul
  ketika tidak ada method yang cocok.
- `getNodeWebhooks` melewati webhook hanya bila field deskripsi benar-benar `true`; node disabled
  tidak mendaftarkan apa pun; `httpMethod` default `GET`; workflow belum tersimpan memakai `__UNSAVED__`.
- `WebhookResponseHeaders.set()` menyimpan nilai apa adanya (hanya `addFromObject` yang
  men-stringify) dan membuang nilai yang ditolak `node:http` dengan peringatan, bukan lemparan.
- `getNodeWebhookUrl` mengabaikan `isFullPath` untuk path `:param` bila node punya `webhookId`.

## 4. Perintah verifikasi

```bash
npm run webhook:check      # W01..W07 · 7/7 · 1,869 differential calls
node --test packages/webhook-lego/test/*.test.mjs     # 18/18
npm run engine:typecheck   # 0 errors (strict)
npm run verify             # 12 gates G01-G12 · live 7/7 · BEHAVIOR CHANGE NONE
npm run connection:check && npm run trigger:check && npm run i18n:check
```

## 5. Catatan terbuka (bukan bagian task ini)

- `webhook-helpers.ts` (`executeWebhook`, resolusi respons `lastNode`/`responseNode`, `responseData`)
  dan manager test/production (`live-webhooks`, `test-webhooks`, `waiting-*`) belum diport: keduanya
  butuh execution context, express response stream, dan penyimpanan waiting execution. Kandidat
  increment berikutnya setelah Scheduler/Persistence.
- Layer CLI (`webhook.service.ts` dkk.) hanya bisa diverifikasi lewat transkripsi offline; bila
  orchestrator kelak menyediakan runtime CLI (TypeORM + Redis), check W05/W06 dapat dinaikkan ke
  oracle eksekusi tanpa mengubah port.
