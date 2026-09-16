use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct INodeParameters(pub serde_json::Value);

impl Default for INodeParameters {
    fn default() -> Self {
        Self(serde_json::json!({}))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct INode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(rename = "typeVersion")]
    pub type_version: f64,
    pub position: [f64; 2],
    #[serde(default)]
    pub parameters: INodeParameters,
    #[serde(default)]
    pub disabled: Option<bool>,
    /// Unknown fields (`credentials`, `webhookId`, `notesInFlow`, `alwaysOutputData`, …) are kept
    /// verbatim: a workflow must survive a load/save round-trip untouched. Without this,
    /// deserialising a real n8n workflow silently drops data (see the Phase-3 review, R2).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeTypeDescription {
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub version: f64,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}
