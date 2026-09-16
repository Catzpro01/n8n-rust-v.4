use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type IDataObject = serde_json::Map<String, serde_json::Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BinaryData {
    pub data: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "fileName", skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(rename = "fileExtension", skip_serializing_if = "Option::is_none")]
    pub file_extension: Option<String>,
}

pub type BinaryDataMap = HashMap<String, BinaryData>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct INodeExecutionData {
    pub json: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary: Option<BinaryDataMap>,
    #[serde(rename = "pairedItem", skip_serializing_if = "Option::is_none")]
    pub paired_item: Option<serde_json::Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum CommonError {
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("General error: {0}")]
    Message(String),
}
