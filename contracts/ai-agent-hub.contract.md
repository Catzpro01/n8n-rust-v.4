# LEGO Node Contract: Universal AI Agent Hub Node (`n8n-nodes-base.aiAgentHub`)

| Field | Value |
| :--- | :--- |
| Node Type ID | `n8n-nodes-base.aiAgentHub` |
| Category | Advanced AI / Multi-Agent Swarm / LLM Orchestration |
| Architecture Standard | ADR 0061 (6 Typed Subports Architecture) |
| Engine | Hermes Rust Engine / Mirofish Protocol / OpenAI-compatible / Ollama / Claude |
| Owner LEGO | LEGO 02 (`node`) & LEGO 11 (`ai-hub`) |
| Version | 1.0.0 |
| Status | CONTRACT SPECIFIED |

---

## 1. Arsitektur 6 Typed Subports (ADR 0061)

Node AI Agent Hub bukan sekadar wrapper prompt sederhana, melainkan simpul orkestrasi agen otonom yang memiliki **6 Subport Input/Output Bertipe**:

```text
┌───────────────────────────────────────────────────────────┐
│              n8n AI AGENT HUB (ADR 0061)                  │
├───────────────────────────────────────────────────────────┤
│ [Subport 1: Engine]  ──► Hermes Rust / Mirofish / Ollama   │
│ [Subport 2: Memory]  ──► Sliding Window + Vector DB       │
│ [Subport 3: Skill]   ──► Skill Package Manifests / Hub    │
│ [Subport 4: Tool/MCP]──► Model Context Protocol Endpoints │
│ [Subport 5: Policy]  ──► Guardrails & Token Budget Caps   │
│ [Subport 6: Output]  ──► Structured Validated JSON Schema │
└───────────────────────────────────────────────────────────┘
```

1. **Subport 1 (Engine)**: Driver LLM dengan failover otomatis berurutan (fallback chain).
2. **Subport 2 (Memory)**: Memori semantik hibrida (gabungan percakapan kontekstual jangka pendek dan retrieval vector jangka panjang).
3. **Subport 3 (Skill)**: Penyematan kapabilitas modular dari Skill Hub n8n.
4. **Subport 4 (MCP Tool)**: Panggilan tool eksternal yang aman melalui Model Context Protocol.
5. **Subport 5 (Policy & Governance)**: Pembatasan token budget, sandboxing, dan aturan eksekusi otonom.
6. **Subport 6 (Typed Output)**: Format output deterministik yang tervalidasi skema sebelum diteruskan ke node hilir.
