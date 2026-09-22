use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

/// Structured execution error adhering to n8n standard runtime error schema.
#[derive(Debug, Error, Clone, PartialEq, Serialize, Deserialize)]
pub enum ExecutionError {
    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Executor not found for node type: {0}")]
    ExecutorNotFound(String),

    #[error("Invalid port: node '{node}', port {port}")]
    InvalidPort { node: String, port: usize },

    #[error("Cycle detected in execution graph")]
    CycleDetected,

    #[error("Execution was cancelled")]
    Cancelled,

    #[error("Memory budget exceeded: limit {limit} bytes, attempted {attempted} bytes")]
    MemoryBudgetExceeded { limit: usize, attempted: usize },

    #[error("Node execution failed: {0}")]
    NodeExecutionFailed(String),

    #[error("Internal runtime error: {0}")]
    Internal(String),
}

/// Standardized error output schema matching n8n error routing specifications.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StandardErrorOutput {
    pub message: String,
    pub description: Option<String>,
    pub error_code: String,
    pub timestamp: String,
    pub details: Value,
}

impl ExecutionError {
    /// Returns the standard alphanumeric error code string.
    pub fn error_code(&self) -> &'static str {
        match self {
            ExecutionError::NodeNotFound(_) => "ERR_NODE_NOT_FOUND",
            ExecutionError::ExecutorNotFound(_) => "ERR_EXECUTOR_NOT_FOUND",
            ExecutionError::InvalidPort { .. } => "ERR_INVALID_PORT",
            ExecutionError::CycleDetected => "ERR_CYCLE_DETECTED",
            ExecutionError::Cancelled => "ERR_EXECUTION_CANCELLED",
            ExecutionError::MemoryBudgetExceeded { .. } => "ERR_MEMORY_BUDGET_EXCEEDED",
            ExecutionError::NodeExecutionFailed(_) => "ERR_NODE_EXECUTION_FAILED",
            ExecutionError::Internal(_) => "ERR_INTERNAL_RUNTIME",
        }
    }

    /// Formats the error into standard n8n error workflow schema.
    pub fn to_standard_output(&self) -> StandardErrorOutput {
        StandardErrorOutput {
            message: self.to_string(),
            description: match self {
                ExecutionError::NodeNotFound(name) => {
                    Some(format!("Referenced node '{}' does not exist in workflow definition", name))
                }
                ExecutionError::ExecutorNotFound(typ) => {
                    Some(format!("No node executor registered for type '{}'", typ))
                }
                ExecutionError::InvalidPort { node, port } => {
                    Some(format!("Port index {} out of range for node '{}'", port, node))
                }
                ExecutionError::CycleDetected => {
                    Some("Workflow topology contains a circular dependency".to_string())
                }
                ExecutionError::Cancelled => {
                    Some("Workflow execution was explicitly aborted by user or timeout".to_string())
                }
                ExecutionError::MemoryBudgetExceeded { limit, attempted } => {
                    Some(format!("Exceeded memory ceiling: attempted {} bytes, limit was {} bytes", attempted, limit))
                }
                ExecutionError::NodeExecutionFailed(msg) => {
                    Some(format!("Execution failed during node processing: {}", msg))
                }
                ExecutionError::Internal(msg) => {
                    Some(format!("Runtime internal failure: {}", msg))
                }
            },
            error_code: self.error_code().to_string(),
            timestamp: "2026-09-20T00:00:00Z".to_string(),
            details: match self {
                ExecutionError::InvalidPort { node, port } => json!({ "node": node, "port": port }),
                ExecutionError::MemoryBudgetExceeded { limit, attempted } => json!({ "limit": limit, "attempted": attempted }),
                ExecutionError::NodeNotFound(node) => json!({ "node": node }),
                ExecutionError::ExecutorNotFound(typ) => json!({ "node_type": typ }),
                _ => json!({}),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_mapping() {
        let err = ExecutionError::NodeNotFound("HTTP Request".to_string());
        assert_eq!(err.error_code(), "ERR_NODE_NOT_FOUND");
        assert_eq!(err.to_string(), "Node not found: HTTP Request");

        let err_cycle = ExecutionError::CycleDetected;
        assert_eq!(err_cycle.error_code(), "ERR_CYCLE_DETECTED");
    }

    #[test]
    fn test_standard_error_output_formatting() {
        let err = ExecutionError::MemoryBudgetExceeded {
            limit: 1024,
            attempted: 2048,
        };
        let out = err.to_standard_output();
        assert_eq!(out.error_code, "ERR_MEMORY_BUDGET_EXCEEDED");
        assert!(out.message.contains("1024 bytes"));
        assert_eq!(out.details["limit"], 1024);
        assert_eq!(out.details["attempted"], 2048);
    }
}
