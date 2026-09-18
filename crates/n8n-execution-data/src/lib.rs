use n8n_common::{BinaryDataMap, INodeExecutionData};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub struct DataRecord {
    pub json: Arc<Value>,
    pub binary: Option<Arc<BinaryDataMap>>,
    pub paired_item: Option<u32>,
}

impl DataRecord {
    pub fn new(json: Value) -> Self {
        Self {
            json: Arc::new(json),
            binary: None,
            paired_item: None,
        }
    }

    pub fn from_arc(json: Arc<Value>) -> Self {
        Self {
            json,
            binary: None,
            paired_item: None,
        }
    }

    pub fn to_node_execution_data(&self) -> INodeExecutionData {
        INodeExecutionData {
            json: (*self.json).clone(),
            binary: self.binary.as_ref().map(|b| (**b).clone()),
            paired_item: self.paired_item.map(|p| serde_json::json!({ "item": p })),
        }
    }

    pub fn from_node_execution_data(d: INodeExecutionData) -> Self {
        let paired = d.paired_item.and_then(|v| {
            if let Some(i) = v.as_u64() {
                Some(i as u32)
            } else if let Some(obj) = v.as_object() {
                obj.get("item").and_then(|item| item.as_u64().map(|i| i as u32))
            } else {
                None
            }
        });
        Self {
            json: Arc::new(d.json),
            binary: d.binary.map(Arc::new),
            paired_item: paired,
        }
    }
}

/// Zero/Minimal-copy batch item buffer for the runtime execution hot-path
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ItemBuffer {
    items: Vec<DataRecord>,
}

impl ItemBuffer {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self { items: Vec::with_capacity(capacity) }
    }

    pub fn from_records(items: Vec<DataRecord>) -> Self {
        Self { items }
    }

    pub fn from_json_values(values: impl IntoIterator<Item = Value>) -> Self {
        let items = values.into_iter().map(DataRecord::new).collect();
        Self { items }
    }

    pub fn from_execution_data(data: Vec<INodeExecutionData>) -> Self {
        let items = data.into_iter().map(DataRecord::from_node_execution_data).collect();
        Self { items }
    }

    pub fn to_execution_data(&self) -> Vec<INodeExecutionData> {
        self.items.iter().map(|r| r.to_node_execution_data()).collect()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn push(&mut self, record: DataRecord) {
        self.items.push(record);
    }

    pub fn get(&self, index: usize) -> Option<&DataRecord> {
        self.items.get(index)
    }

    pub fn as_slice(&self) -> &[DataRecord] {
        &self.items
    }

    pub fn iter(&self) -> std::slice::Iter<'_, DataRecord> {
        self.items.iter()
    }

    /// Shallow clone: clones only Arc pointers without duplicating JSON heap memory
    pub fn shallow_clone(&self) -> Self {
        Self {
            items: self.items.clone(),
        }
    }
}

impl IntoIterator for ItemBuffer {
    type Item = DataRecord;
    type IntoIter = std::vec::IntoIter<DataRecord>;

    fn into_iter(self) -> Self::IntoIter {
        self.items.into_iter()
    }
}

impl<'a> IntoIterator for &'a ItemBuffer {
    type Item = &'a DataRecord;
    type IntoIter = std::slice::Iter<'a, DataRecord>;

    fn into_iter(self) -> Self::IntoIter {
        self.items.iter()
    }
}

// Backward-compatible utility functions
pub fn wrap_data(value: Value) -> Vec<INodeExecutionData> {
    match value {
        Value::Array(arr) => arr
            .into_iter()
            .map(|item| INodeExecutionData {
                json: item,
                binary: None,
                paired_item: None,
            })
            .collect(),
        single => vec![INodeExecutionData {
            json: single,
            binary: None,
            paired_item: None,
        }],
    }
}

pub fn extract_json(data: &[INodeExecutionData]) -> Vec<Value> {
    data.iter().map(|d| d.json.clone()).collect()
}

pub fn pair_items(source_count: usize, dest_count: usize) -> Vec<usize> {
    if source_count == 0 {
        return vec![];
    }
    (0..dest_count).map(|i| i % source_count).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_wrap_and_extract() {
        let input = json!([{"id": 1, "name": "foo"}, {"id": 2, "name": "bar"}]);
        let wrapped = wrap_data(input);
        assert_eq!(wrapped.len(), 2);
        assert_eq!(wrapped[0].json["name"], "foo");

        let extracted = extract_json(&wrapped);
        assert_eq!(extracted.len(), 2);
        assert_eq!(extracted[1]["name"], "bar");
    }

    #[test]
    fn test_pairing() {
        let pairs = pair_items(2, 4);
        assert_eq!(pairs, vec![0, 1, 0, 1]);
    }

    #[test]
    fn test_item_buffer_minimal_copy() {
        let mut buf = ItemBuffer::new();
        buf.push(DataRecord::new(json!({"count": 42})));
        buf.push(DataRecord::new(json!({"count": 99})));

        assert_eq!(buf.len(), 2);
        assert_eq!(buf.get(0).unwrap().json["count"], 42);

        // Test shallow clone
        let cloned_buf = buf.shallow_clone();
        assert_eq!(cloned_buf.len(), 2);
        // Verify underlying Arc points to identical memory
        assert!(Arc::ptr_eq(&buf.get(0).unwrap().json, &cloned_buf.get(0).unwrap().json));
    }
}
