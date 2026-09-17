use n8n_common::INodeExecutionData;
use serde_json::Value;

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
}
