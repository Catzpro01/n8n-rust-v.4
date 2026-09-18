use crate::traits::{INodeExecutionData, N8nNode, NodeExecutionContext, NodeExecutionError, NodeTypeDescription};
use async_trait::async_trait;
use serde_json::json;

pub struct SetNode;

#[async_trait]
impl N8nNode for SetNode {
    fn description(&self) -> NodeTypeDescription {
        NodeTypeDescription {
            name: "n8n-nodes-base.set".to_string(),
            display_name: "Edit Fields (Set) [Rust Native]".to_string(),
            description: "Set values on items in high-speed native Rust".to_string(),
            version: 1.0,
            inputs: vec!["main".to_string()],
            outputs: vec!["main".to_string()],
            translation: None,
        }
    }

    async fn execute(
        &self,
        context: &NodeExecutionContext,
        input_data: Vec<INodeExecutionData>,
    ) -> Result<Vec<Vec<INodeExecutionData>>, NodeExecutionError> {
        let mut output_items = Vec::with_capacity(input_data.len());
        let assignments = context.parameters.get("values").cloned().unwrap_or(json!({}));

        for mut item in input_data {
            if let Some(obj) = item.json.as_object_mut() {
                if let Some(assign_obj) = assignments.as_object() {
                    for (k, v) in assign_obj {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            }
            output_items.push(item);
        }

        Ok(vec![output_items])
    }
}
