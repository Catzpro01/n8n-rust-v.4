# LEGO Node Contract: Universal Polyglot Code Node (`n8n-nodes-base.codeUniversal`)

| Field | Value |
| :--- | :--- |
| Node Type ID | `n8n-nodes-base.codeUniversal` |
| Category | Core / Logic / Polyglot Script Execution |
| Core Engine | Multi-Language Sandboxed Runner (V8, CPython, Rustc/Wasmtime, Yaegi Go, GCC/Clang, Sandboxed Bash) |
| Owner LEGO | LEGO 02 (`node`) & LEGO 04 (`expression/runner`) |
| Version | 1.0.0 |
| Status | CONTRACT SPECIFIED |

---

## 1. Tujuan & Arsitektur (Why Polyglot Code Node?)
Node Code bawaan n8n dibatasi hanya pada JavaScript dan Python standar. Di proyek rekonstruksi ini, node diperluas menjadi **Universal Polyglot Code Node** yang mendukung 6 bahasa eksekusi secara native:
1. **JavaScript / TypeScript**: Native V8 sandbox context isolation.
2. **Python 3**: CPython / PyPy runner dengan dukungan pustaka data science (NumPy, Pandas).
3. **Rust**: In-memory script compilation via cargo / Wasmtime sandboxing (kecepatan eksekusi tingkat rendah).
4. **Go**: In-memory Go script interpreter via Yaegi engine.
5. **C / C++**: Clang/GCC compiler runner dalam sandbox container / Wasm boundary.
6. **Bash / Shell**: Sandboxed command runner dengan proteksi restricted environment.

---

## 2. Parameter Input Node (`INodeProperties`)

```typescript
export const universalCodeNodeProperties: INodeProperties[] = [
  {
    displayName: 'Bahasa Pemrograman / Language',
    name: 'language',
    type: 'options',
    options: [
      { name: 'JavaScript (Node.js V8)', value: 'javascript' },
      { name: 'TypeScript', value: 'typescript' },
      { name: 'Python 3', value: 'python' },
      { name: 'Rust (Wasm / Native Sandbox)', value: 'rust' },
      { name: 'Go (Yaegi In-Memory)', value: 'go' },
      { name: 'C / C++ (Clang Sandbox)', value: 'cpp' },
      { name: 'Bash / Shell (Restricted)', value: 'bash' }
    ],
    default: 'javascript',
    description: 'Pilih bahasa pemrograman untuk mengeksekusi logika alur kerja.'
  },
  {
    displayName: 'Mode Eksekusi / Execution Mode',
    name: 'mode',
    type: 'options',
    options: [
      { name: 'Run Once for All Items (Array Input)', value: 'runOnceForAllItems' },
      { name: 'Run Once for Each Item', value: 'runOnceForEachItem' }
    ],
    default: 'runOnceForAllItems',
    description: 'Jalankan skrip satu kali untuk seluruh data atau berulang per-item.'
  },
  {
    displayName: 'Kode / Code Script',
    name: 'code',
    type: 'string',
    typeOptions: {
      editor: 'code',
      rows: 14
    },
    default: '// Masukkan kode Anda di sini\nreturn $input.all();',
    description: 'Kode sumber yang akan dieksekusi oleh runner sandboxed.'
  },
  {
    displayName: 'Batas Waktu Eksekusi (Timeout ms)',
    name: 'timeoutMs',
    type: 'number',
    default: 10000,
    description: 'Maksimum waktu eksekusi skrip sebelum dibatalkan oleh watchdog (default 10 detik).'
  },
  {
    displayName: 'Batas Memori (RAM Limit MB)',
    name: 'memoryLimitMb',
    type: 'number',
    default: 256,
    description: 'Batas alokasi memori sandboxed runner.'
  }
];
```

---

## 3. Protokol Pertukaran Data Universal (Data Exchange Protocol)

Seluruh runner bahasa wajib mematuhi format I/O standar:
- **Input**: Data `items` diinjeksi via variabel runtime lokal (`$input` / environment buffer / STDIN JSON).
- **Output**: Skrip mengembalikan array objek bertipe `INodeExecutionData[]` melalui return value atau output buffer STDOUT JSON terstruktur.
