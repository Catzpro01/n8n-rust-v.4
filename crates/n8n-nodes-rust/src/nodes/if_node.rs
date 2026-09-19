use crate::traits::{
    INodeExecutionData, N8nNode, NodeExecutionContext, NodeExecutionError, NodeTypeDescription,
};
use async_trait::async_trait;

pub struct IfNode;

#[async_trait]
impl N8nNode for IfNode {
    fn description(&self) -> NodeTypeDescription {
        NodeTypeDescription {
            name: "n8n-nodes-base.if".to_string(),
            display_name: "If Condition [Rust Native]".to_string(),
            description: "Route items conditionally in sub-millisecond Rust speed".to_string(),
            version: 1.0,
            inputs: vec!["main".to_string()],
            outputs: vec!["true".to_string(), "false".to_string()],
            translation: None,
        }
    }

    async fn execute(
        &self,
        context: &NodeExecutionContext,
        input_data: Vec<INodeExecutionData>,
    ) -> Result<Vec<Vec<INodeExecutionData>>, NodeExecutionError> {
        let mut true_branch = Vec::new();
        let mut false_branch = Vec::new();

        let condition_key = context
            .parameters
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("active");

        for item in input_data {
            let is_true = item
                .json
                .get(condition_key)
                .map(|v| v.as_bool().unwrap_or(!v.is_null()))
                .unwrap_or(false);

            if is_true {
                true_branch.push(item);
            } else {
                false_branch.push(item);
            }
        }

        Ok(vec![true_branch, false_branch])
    }
}
