# TASK RESULT: PHASE3B-CONNECTION-GATE — gate diferensial Connection LEGO (P-CONNECTION-GRAPH)

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0b104-n8n-rust-v-4`)
- **LEGO COMPONENT**: `connection` (port `P-CONNECTION-GRAPH`, Phase 3)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Pekerjaan "Continue per arahan" di branch ini mengklaim `connection-lego 5/5 PASS`, tetapi
   `packages/connection-lego/package.json` menunjuk dua tool (`extract`, `verify`) yang **belum ada** —
   jadi klaim "1:1 dari n8n 2.9.4" belum pernah diuji oleh apa pun selain 5 tes dangkalnya sendiri.
2. Saya membangun gate diferensial yang menjalankan **oracle asli** (`n8n-workflow@2.9.1`, set
   dependensi n8n 2.9.4 di `.runtime`) dan engine rekonstruksi berdampingan atas korpus 12 graf, lalu
   membandingkan **1.246 hasil pemanggilan** — urutan traversal ikut dibandingkan, bukan hanya isinya.
3. Jalankan pertama pada kode yang di-push: **35/223 pemanggilan analisis graf berbeda** dan
   **20 divergensi kembar** antara sumber TypeScript dan twin ESM-nya; dua di antaranya semantik —
   `getRootNodes` ikut menghitung edge masuk dari luar seleksi, dan `parseExtractableSubgraphSelection`
   mengembalikan `{start,end}` di kasus yang di referensi mengembalikan `{}`.
4. Saya menjadikan `connection-routing-engine.ts` sebagai port tepat dari `graph/graph-utils.ts`
   (termasuk helper `union/intersection/difference`, urutan iterasi, dan payload error persis),
   mengimplementasikan `getInputEdges`/`getOutputEdges` yang hilang, dan **menggenerasi twin ESM** dari
   sumber TS (`--emit-esm`) sehingga dua salinan itu tidak bisa lagi menyimpang diam-diam.
5. Bukti akhir: `npm run connection:check` **7/7 check, 1.246 panggilan diferensial, 0 divergensi**;
   suite connection-lego 5/5; `npm run i18n:check` 5/5; `npm run isolation:check` PASS; bukan Rust,
   `reference/n8n/**` tidak tersentuh.

---

## 1. Sebelum vs sesudah (bukti mesin)

| Check | Cakupan | Sebelum (`da1654a8`) | Sesudah |
| :--- | :--- | :--- | :--- |
| `C01` | 13 simbol `P-CONNECTION-GRAPH` ada di referensi + kandidat | **FAIL** — 2 simbol hilang (`getInputEdges`, `getOutputEdges`) | PASS |
| `C02` | engine tidak mengimpor apa pun | PASS | PASS |
| `C03` | traversal: `mapConnectionsByDestination`, `getConnected/Child/ParentNodes` | PASS (969 panggilan) | PASS (969) |
| `C04` | adjacency, input/output edges, roots, leaves, `hasPath`, extractable | **FAIL — 35/223 berbeda** | PASS (271) |
| `C05` | `compareConnections` atas pasangan korpus | PASS (6 pasangan) | PASS (6) |
| `C06` | twin TS == twin ESM (anti-drift) | **FAIL — 20 divergensi** | PASS (12 graf) |
| `C07` | `packages/connection-lego/test/*.test.mjs` | PASS (5/5, dangkal) | PASS (**13/13**) |
| **Total** | | **4/7 check** | **7/7 · 1.246 panggilan · 0 divergensi** |

Contoh divergensi nyata yang tertangkap (tersimpan di evidence):

```text
G01-linear buildAdjacencyList(connections)
  reference: [["A",[{index:0,node:"B",type:"main"}]], ["B",[{index:0,node:"C",type:"main"}]]]
  candidate: […, ["C",[]]]                      ← kandidat mengarang key tujuan kosong
G01-linear parseExtractableSubgraphSelection(all)
  reference: {}                                  ← start/end hanya untuk root∩input / leaf∩output
  candidate: {start:"A", end:"C"}
```

## 2. Artefak

| Artefak | Isi |
| :--- | :--- |
| `tools/connection-isolation-gate.mjs` | gate C01–C07, korpus 12 graf, penulisan evidence, exit≠0 bila divergen |
| `tools/connection-isolation-extract.mjs` | kompilasi twin TS → ESM (`--emit-esm`), penjaga anti-drift |
| `packages/reconstructed-engine/src/connection-routing-engine.ts` | port tepat `graph/graph-utils.ts` + `common/*` + `connections-diff.ts` |
| `packages/reconstructed-engine/src/connection-routing-engine.mjs` | **dihasilkan** dari sumber TS (banner + `C06` menjaganya) |
| `docs/isolation/evidence/connection-lego-gate.json` | verdict, korpus, 1.246 perbandingan, contoh divergensi |
| `packages/connection-lego/test/02-routing-graph.test.mjs` | 8 tes analisis graf, seluruh ekspektasinya dibaca dari oracle lebih dulu |
| `docs/isolation/connection.md` §12, `contracts/connection.contract.md` §7 | catatan gate + tabel verifikasi |

## 3. Perintah verifikasi

```bash
scripts/setup-reference-runtime.sh          # oracle: n8n-workflow/core/nodes-base 2.9.1
npm run connection:check                    # C01–C07 → docs/isolation/evidence/connection-lego-gate.json
node tools/connection-isolation-extract.mjs --emit-esm   # regenerasi twin ESM (setelah edit TS)
npm --prefix packages/connection-lego test   # suite LEGO (5/5)
npm run i18n:check && npm run verify         # gate 4B + 11/11 regresi repositori
```

## 4. Catatan terbuka (bukan bagian task ini)

- `getNodeConnectionIndexes`/`getHighestNode` masih hidup sebagai salinan di engine, padahal manifest
  `connection-lego` menugaskannya ke **LEGO 01 (Workflow)** (`doesNotOwn`). Gate ini tidak
  membandingkannya; keputusan memindahkan/menghapus ada di orchestrator.
- Suite `packages/connection-lego/test` diperluas dari 5 → 13 tes (`02-routing-graph.test.mjs`):
  `buildAdjacencyList`, `getInputEdges`/`getOutputEdges`, roots/leaves dengan edge eksternal, self-loop &
  siklus, edge multi-tipe, lima payload `parseExtractableSubgraphSelection`, dangling, dan banner twin generatif.
