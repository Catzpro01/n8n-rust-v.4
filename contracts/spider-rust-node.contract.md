# LEGO Node Contract: Spider Full-Stack Rust Web Scraper (`n8n-nodes-base.spiderRust`)

| Field | Value |
| :--- | :--- |
| Node Type ID | `n8n-nodes-base.spiderRust` |
| Category | Data Transformation / Web Scraping / Networking |
| Core Engine | Rust Tokio Async Multi-threaded Spider Crawler + Chromium Headless IPC |
| Owner LEGO | LEGO 02 (`node`) & LEGO 10 (`webhook/scraping`) |
| Version | 1.0.0 |
| Status | CONTRACT DRAFTED & SPECIFIED |

---

## 1. Tujuan & Keunggulan Komparatif (Why This Node?)
Node ini menggantikan ketergantungan Puppeteer / Cheerio / HTTP Request biasa yang sering:
1. Memakan RAM raksasa di server (Puppeteer memakan ~300MB per tab).
2. Rusak (*broken*) jika CSS selector atau class div di website target berubah.
3. Lambat saat mengekstrak puluhan halaman bertingkat.

Dengan **Spider Full-Stack Rust Engine**:
- Kecepatan ekstraksi hingga **100x lebih cepat** (benchmark Rust sub-second).
- Konsumsi memori sangat rendah (< 15MB per 1.000 request).
- **Semantic Anti-Breakage**: Otomatis mengekstrak data berdasarkan makna semantik (konten artikel, tabel, harga produk) bukan tag HTML kaku.

---

## 2. Parameter Input Node (INodeProperties Specification)

```typescript
export const nodeProperties: INodeProperties[] = [
  {
    displayName: 'Mode Eksekusi / Operation Mode',
    name: 'operationMode',
    type: 'options',
    options: [
      { name: 'Fast HTTP Stream (Sub-second / No Browser)', value: 'fastStream' },
      { name: 'Full-Stack Headless (Render JavaScript / SPA)', value: 'headlessRender' },
      { name: 'Deep Recursive Crawler (Multi-Page)', value: 'recursiveCrawl' }
    ],
    default: 'fastStream',
    description: 'Pilih mode kecepatan tinggi tanpa browser atau render JS penuh.'
  },
  {
    displayName: 'URL Target',
    name: 'url',
    type: 'string',
    default: '',
    placeholder: 'https://example.com/products',
    required: true,
    description: 'Alamat website yang akan dirayapi/diekstrak datanya.'
  },
  {
    displayName: 'Strategi Ekstraksi Konten / Extraction Strategy',
    name: 'extractionStrategy',
    type: 'options',
    options: [
      { name: 'Semantic Anti-Breakage (Otomatis & Tahan Perubahan Layout)', value: 'semantic' },
      { name: 'Structured JSON-LD / Microdata / Meta', value: 'metadata' },
      { name: 'Custom CSS / XPath Selector', value: 'customSelector' },
      { name: 'Full Clean Markdown (Untuk LLM RAG Ingestion)', value: 'markdown' }
    ],
    default: 'semantic',
    description: 'Metode penarikan data dari halaman web.'
  },
  {
    displayName: 'Batas Kedalaman Rayapan (Max Depth)',
    name: 'maxDepth',
    type: 'number',
    default: 1,
    displayOptions: {
      show: { operationMode: ['recursiveCrawl'] }
    },
    description: 'Seberapa dalam spider mengikuti link ke sub-halaman.'
  },
  {
    displayName: 'Batas Maksimum Halaman (Max Pages Limit)',
    name: 'maxPages',
    type: 'number',
    default: 50,
    displayOptions: {
      show: { operationMode: ['recursiveCrawl'] }
    },
    description: 'Jumlah maksimum halaman yang boleh dirayapi.'
  }
];
```

---

## 3. Format Output Node (`INodeExecutionData[]`)

Data yang dikembalikan ke alur kerja berbentuk JSON terstruktur bersih:
```json
[
  {
    "json": {
      "url": "https://example.com/products/item-1",
      "status": 200,
      "title": "Nama Produk / Judul Artikel",
      "content": "Isi teks bersih tanpa iklan atau footer...",
      "metadata": {
        "description": "Deskripsi meta...",
        "language": "id",
        "publishedTime": "2026-09-18T00:00:00Z"
      },
      "entities": {
        "prices": ["Rp 150.000"],
        "links": ["https://example.com/products/item-2"],
        "images": ["https://example.com/img/item-1.jpg"]
      },
      "performance": {
        "fetchTimeMs": 142,
        "engine": "spider-rust-tokio"
      }
    }
  }
]
```
