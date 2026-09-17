use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type IDataObject = serde_json::Map<String, serde_json::Value>;

/// `IBinaryData` in default (in-memory) mode.
///
/// Field order matters: `tests/reference/execution-data/06-binary-reference/expected.json`
/// records the reference emitting
/// `{mimeType, fileType, fileExtension, data, fileName, fileSize, bytes}` in exactly that order,
/// and `runData` is compared byte-for-byte.
///
/// The trailing `extra` is the same rule the port already applies to `INode`: fields this struct
/// does not model must survive a load/save round trip. Without it, deserialising a real
/// `IBinaryData` silently drops `fileType`/`fileSize`/`bytes` — and in `filesystem` mode the
/// `id` that `getBinaryDataBuffer` needs to resolve the payload at all.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BinaryData {
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "fileType", skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(rename = "fileExtension", skip_serializing_if = "Option::is_none")]
    pub file_extension: Option<String>,
    /// Base64 payload in in-memory mode; the literal `"filesystem-v2"` marker in filesystem mode.
    pub data: String,
    #[serde(rename = "fileName", skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    /// Human-readable size as the reference formats it (`"7 B"`), not a number.
    #[serde(rename = "fileSize", skip_serializing_if = "Option::is_none")]
    pub file_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    /// Filesystem-mode `id` and anything else the runtime adds later.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
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
