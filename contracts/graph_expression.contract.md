# CONTRACT SPECIFICATION: Workflow Graph ? Expression Evaluator

**Version**: `1.0.0-phase3`  
**Parties**:
- Producer / Orchestrator: **Agent-01** (`workflow.graph`, `crates/n8n-workflow`)
- Consumer / Evaluator: **Agent-04** (`expression.*`, `crates/n8n-expression`)
**Status**: RATIFIED CONTRACT BASELINE (Phase 1 Pilot)

---

## 1. Executive Summary & Boundaries

Kontrak ini mendefinisikan interface batas (*boundary*) eksplisit antara domain **Workflow Graph** (struktur DAG, metadata parameter, referensi ekstraksi) dan domain **Expression Engine** (parser AST, evaluasi ekspresi, context lookup).

### Pemisahan Wewenang (Separation of Concerns):
1. **Workflow Graph (`agent-01`) bertanggung jawab atas**:
   - Memodelkan DAG (`Workflow`, `Node`, `Connection`).
   - Validasi topologi graf (siklus, keterjangkauan, node yatim).
   - Serialisasi dan deserialisasi format n8n JSON wire standard.
   - Ekstraksi referensi ekspresi (`ExpressionRef`) dari parameter node tanpa mengetahui engine internal ekspresi.
   - Menyediakan interface data konteks (`EvaluationContext`) saat eksekusi node berjalan.
2. **Expression Evaluator (`agent-04`) bertanggung jawab atas**:
   - Menentukan apakah suatu parameter merupakan ekspresi (`is_expression(val)`).
   - Parsing ekspresi ke AST terkompilasi (`ExpressionAst`).
   - Mengevaluasi ekspresi secara aman (*safe evaluation*, sandboxed, tanpa eksekusi kode biner arbitrary).
   - Melakukan resolusi context lookup (`$json`, `$node["..."]`, `$item(...)`).
   - Mengembalikan `Result<serde_json::Value, ExpressionError>` tanpa panik runtime.

---

## 2. Definisi Rust Trait Interface & Data Schema

Trait interface ditempatkan pada shared crate `crates/n8n-common/src/expression_contract.rs` agar dapat diakses oleh kedua crate tanpa circular dependency:

```rust
use serde_json::Value;

/// Referensi lokasi ekspresi yang diekstrak oleh workflow graph dari parameter node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpressionRef {
    pub node_name: String,
    pub parameter_path: String,
    pub raw_expression: String,
}

/// Konteks evaluasi yang disediakan oleh runtime / workflow graph kepada evaluator.
pub trait EvaluationContext {
    /// Akses ke payload $json dari item aktif saat ini.
    fn get_json(&self) -> Option<&Value>;

    /// Akses ke output data dari node pendahulu ($node["NodeName"].json).
    fn get_node_output(&self, node_name: &str) -> Option<&[Value]>;

    /// Indeks item aktif saat ini ($itemIndex / $item).
    fn get_item_index(&self) -> usize;

    /// Parameter lokal atau variabel eksekusi ($vars / $env).
    fn get_variable(&self, key: &str) -> Option<&Value>;
}

/// Interface Evaluator yang wajib diimplementasikan oleh Agent-04 (crates/n8n-expression).
pub trait ExpressionEvaluator: Send + Sync {
    /// Mengidentifikasi apakah string merupakan ekspresi n8n ("={{ ... }}" atau "{{ ... }}").
    fn is_expression(&self, input: &str) -> bool;

    /// Mengevaluasi ekspresi terhadap konteks runtime.
    fn evaluate(
        &self,
        expression: &str,
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError>;
}

/// Error model terstruktur dan strict (fail-closed, no panic).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExpressionError {
    #[error("Syntax error in expression at position {pos}: {message}")]
    SyntaxError { pos: usize, message: String },

    #[error("Unresolved reference: path '{path}' not found in context")]
    UnresolvedReference { path: String },

    #[error("Node '{node_name}' referenced in expression was not found in workflow context")]
    NodeNotFound { node_name: String },

    #[error("Item index {index} out of bounds for node '{node_name}' (total items: {total})")]
    IndexOutOfBounds { node_name: String, index: usize, total: usize },

    #[error("Type error: cannot cast {expected} from {actual}")]
    TypeError { expected: String, actual: String },

    #[error("Evaluation timeout exceeded limit of {limit_ms}ms")]
    Timeout { limit_ms: u64 },
}
```

---

## 3. Alur Koordinasi (Execution Flow)

```text
[ Workflow DAG / Node ] (Agent-01)
       ?
       ? 1. Extract parameter values
       ?    node.extract_expressions() -> Vec<ExpressionRef>
       ?
[ Expression Evaluator ] (Agent-04)
       ?
       ? 2. Compile / parse to AST:
       ?    evaluator.evaluate(raw_expr, &context)
       ?
       ????> Query context: context.get_json()
       ????> Query context: context.get_node_output("PreviousNode")
       ?
       ?
[ Evaluated Result / Value ] ??> Masuk ke ExecutionFrame Node (Shared Runtime)
```

---

## 4. Test Matrix & Acceptance Criteria (Definition of Done)

1. **Unit Test (Independent)**:
   - Agent-01: Graph DAG validation (acyclic, reachability, orphan nodes, extraction of expressions from complex nested JSON).
   - Agent-04: AST Parser, path evaluation (`$json.user.id`), error propagation for missing paths, no panic on malformed expressions.
2. **Contract Test**:
   - Trait verification: `ExpressionEvaluator` menerima implementasi `EvaluationContext` dan mengembalikan `Result<Value, ExpressionError>`.
3. **Integration Test**:
   - `workflow.graph` membangun DAG 3 node ("Trigger" -> "Transform" -> "Output").
   - Parameter dinamis diekstrak dari node "Transform" dan diserahkan ke `expression.evaluator`.
   - Hasil evaluasi divalidasi end-to-end tanpa runtime/daemon terpisah.
4. **Resource Benchmark**:
   - Uji alokasi memori pada loop 10.000 evaluasi ekspresi (RSS delta < 15 MB).
