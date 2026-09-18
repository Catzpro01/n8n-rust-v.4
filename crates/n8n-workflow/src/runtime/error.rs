use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq)]
pub enum ExecutionError {
    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Invalid port: node '{node}', port {port}")]
    InvalidPort { node: String, port: usize },

    #[error("Cycle detected in execution graph")]
    CycleDetected,

    #[error("Memory budget exceeded: limit {limit} bytes, attempted {attempted} bytes")]
    MemoryBudgetExceeded { limit: usize, attempted: usize },

    #[error("Node execution failed: {0}")]
    NodeExecutionFailed(String),

    #[error("Internal runtime error: {0}")]
    Internal(String),
}
