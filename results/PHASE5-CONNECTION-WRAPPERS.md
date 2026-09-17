# TASK RESULT: PHASE5-CONNECTION-WRAPPERS — dua anggota `Workflow` dipaku ke oracle

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-3` (Arena session `arena/01a0b104-n8n-rust-v-4`)
- **LEGO COMPONENT**: `connection` (P-CONNECTION-GRAPH) — sisa perilaku yang belum diperiksa
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. `runner.mjs` mengimpor `getNodeConnectionIndexes` dan `getHighestNode` dari modul routing engine,
   padahal manifest `connection-lego` menugaskan keduanya ke **LEGO 01 (Workflow)** — dan check `C01`
   hanya memeriksa `publicSurface`, sehingga salinan yang salah pada dua fungsi itu tidak bisa
   menggagalkan gate apa pun.
2. Saya tambah **C09**: gate membangun objek **`Workflow` asli** dari `n8n-workflow@2.9.1`
   (`new Workflow({ nodes, connections, nodeTypes })`) untuk tiap graf korpus dan membandingkan
   `getHighestNode` + `getNodeConnectionIndexes` — 686 panggilan, semuanya identik.
3. Cakupannya termasuk kasus yang mudah terlewat: node `disabled: true`, dan **nama yang bukan node**
   (target dangling `G07` serta fixture baru `G13-ghost-source`, sumber koneksi yang node-nya sudah
   dihapus dari workflow) — di sana referensi berhenti lebih awal karena `getNode(parent)` null.
4. Dua kontrol negatif membuktikan gate menggigit: menghapus guard `getNode(parent) === null` dan
   membuat `getHighestNode` mengusulkan node `disabled` — keduanya gagal dengan pesan yang presisi
   (`6/686 wrapper calls diverge`), lalu dipulihkan; 10 tes unit baru di suite LEGO memaku nilai yang
   sama secara offline.
5. Bug laten di reporter gate ikut tertutup (dump error saat nilai referensi `undefined`), manifest
   mencatat deviation `D-11`, dan seluruh verifikasi tetap hijau: gate koneksi **9/9 · 1.944
   panggilan**, suite **22/22**, `npm run verify` **12/12** (live 7/7, BEHAVIOR CHANGE NONE).

---

## 1. Sebelum vs sesudah

| Aspek | Sebelum | Sesudah |
| :--- | :--- | :--- |
| `getNodeConnectionIndexes` | tidak ada check yang menyentuh | `C09`: setiap node × kandidat parent × tipe koneksi, vs `Workflow` asli |
| `getHighestNode` | tidak ada check | `C09`: setiap node, dua pass (semua aktif, node ke-2 `disabled`) |
| Nama bukan node (ghost/dangling) | tidak diuji | fixture `G13-ghost-source` + target dangling `G07` |
| Tes unit suite | 20/20 | **22/22** (dua tes baru, ekspektasi dibaca dari oracle lebih dulu) |
| Reporter gate | crash bila nilai referensi `undefined` | menampilkan `<undefined>` lalu melanjutkan laporan |
| Manifest | tidak menyebut salinan engine | deviation `D-11` + baris evidence gate C01–C09 |
| Gate total | 8/8 · 1.258 panggilan | **9/9 · 1.944 panggilan** |

## 2. Semantik yang dipaku oracle (sering mengejutkan)

- `getHighestNode` berjalan ke hulu dan mengembalikan node aktif paling atas; ia **melewati** node
  disabled tetapi tidak pernah mengembalikannya, dan hanya menerima flag yang persis `false`
  (`disabled: undefined` bukan "aktif" — ada assertion khusus di suite).
- `getNodeConnectionIndexes` adalah **BFS pada indeks tujuan**, bukan pencarian langsung: pada
  `A → B → C`, permintaan `(C, A)` tetap mengembalikan edge milik A, dan `sourceIndex` adalah slot
  keluaran milik parent (kasus fan-out: `(C, A)` → `{ sourceIndex: 1 }`).
- Keduanya mengembalikan `undefined` untuk tipe koneksi yang tidak dipakai graf, dan tidak pernah
  melempar pada siklus, self-loop, maupun tujuan dangling.

## 3. Kontrol negatif

| Cacat yang disuntikkan | Tertangkap oleh |
| :--- | :--- |
| guard `getNode(parentNodeName) === null → undefined` dihapus | `C09` — `G13-ghost-source getNodeConnectionIndexes(A, Ghost, main)`, **6/686** divergen |
| `getHighestNode` mengusulkan node `disabled: true` | `C09` — `G05-cycle getHighestNode(A) (2nd node disabled)`, **6/686** divergen |

Keduanya dikembalikan; `npm run connection:check` kembali 9/9.

## 4. Perintah verifikasi

```bash
npm run connection:check    # C01..C09 · 9/9 · 1,944 differential calls · 0 divergences
node --test packages/connection-lego/test/*.test.mjs   # 22/22
npm run verify              # 12 gates G01-G12 · live 7/7 · BEHAVIOR CHANGE NONE
npm run i18n:check && npm run isolation:check          # 5/5 and PASS
```

## 5. Catatan terbuka (bukan bagian task ini)

- Salinan dua fungsi ini tetap hidup di dalam modul engine. Memindahkan/menghapusnya menyentuh
  `runner.mjs` dan keputusan handoff LEGO 01 (Agent 1) — sekarang minimal ia **terkunci** oleh `C09`
  dan deviation `D-11` sehingga perpindahan di masa depan tidak bisa menyimpang diam-diam.
- `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth` (juga milik LEGO 01) belum
  disalin ke engine sama sekali; kalau `runner.mjs` membutuhkannya, tambahkan sebagai port dengan
  gate yang sama polanya.
