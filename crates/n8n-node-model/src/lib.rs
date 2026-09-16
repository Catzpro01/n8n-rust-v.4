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
