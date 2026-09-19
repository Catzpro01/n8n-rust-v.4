pub mod nodes;
pub mod registry;
pub mod traits;

pub use nodes::*;
pub use registry::NodeRegistry;
pub use traits::*;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_set_node_execution() {
        let node = SetNode;
        let mut params = std::collections::HashMap::new();
        params.insert("values".to_string(), json!({"status": "PROCESSED_BY_RUST"}));

        let ctx = NodeExecutionContext {
            workflow_id: "wf-1".to_string(),
            execution_id: "exec-1".to_string(),
            node_name: "Set Test".to_string(),
            parameters: params,
        };

        let input = vec![INodeExecutionData::from_json(
            json!({"id": 100, "name": "Item A"}),
        )];
        let result = node
            .execute(&ctx, input)
            .await
            .expect("Execution should succeed");

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].len(), 1);
        assert_eq!(result[0][0].json["status"], "PROCESSED_BY_RUST");
        assert_eq!(result[0][0].json["id"], 100);
    }

    #[tokio::test]
    async fn test_if_node_branching() {
        let node = IfNode;
        let mut params = std::collections::HashMap::new();
        params.insert("key".to_string(), json!("passed"));

        let ctx = NodeExecutionContext {
            workflow_id: "wf-1".to_string(),
            execution_id: "exec-1".to_string(),
            node_name: "If Test".to_string(),
            parameters: params,
        };

        let input = vec![
            INodeExecutionData::from_json(json!({"id": 1, "passed": true})),
            INodeExecutionData::from_json(json!({"id": 2, "passed": false})),
            INodeExecutionData::from_json(json!({"id": 3, "passed": true})),
        ];

        let result = node
            .execute(&ctx, input)
            .await
            .expect("Execution should succeed");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].len(), 2); // true: id 1 and 3
        assert_eq!(result[1].len(), 1); // false: id 2
    }
}
