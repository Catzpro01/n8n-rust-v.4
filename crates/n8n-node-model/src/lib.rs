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
    /// A `Number` (not `f64`) so the representation survives a round-trip:
    /// `1` stays `1` (an `f64` would serialise it as `1.0`). Real nodes use
    /// both (`1`, `4.6`, …) — see the corpus fixtures.
    #[serde(rename = "typeVersion")]
    pub type_version: serde_json::Number,
    /// `Number` pair for the same round-trip reason as `type_version`.
    pub position: [serde_json::Number; 2],
    #[serde(default)]
    pub parameters: INodeParameters,
    /// Absent stays absent on serialisation (`skip_serializing_if`), matching
    /// TS `disabled?: boolean` — required for load/save round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// Unknown fields (`credentials`, `webhookId`, `notesInFlow`, `alwaysOutputData`, …) are kept
    /// verbatim: a workflow must survive a load/save round-trip untouched. Without this,
    /// deserialising a real n8n workflow silently drops data (see the Phase-3 review, R2).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Rewrites `parameters.formFields.values[*].html` where `fieldType === 'html'`,
/// mutating the node in place — ported from
/// `reference/n8n/packages/workflow/src/node-parameters/rename-node-utils.ts`
/// (`renameFormFields`, contract P-NODE-RENAME).
///
/// Every guard is reproduced: a missing/non-object `formFields`, a
/// missing/non-array `values`, and null/non-object entries are all no-ops;
/// entries whose `fieldType` is not exactly `"html"`, or that lack an `html`
/// key, are left untouched. The callback receives the `html` value as-is
/// (whatever JSON type it holds) and its return value replaces it.
pub fn rename_form_fields(
    node: &mut INode,
    mut rename_field: impl FnMut(serde_json::Value) -> serde_json::Value,
) {
    let Some(values) = node
        .parameters
        .0
        .get_mut("formFields")
        .and_then(|ff| ff.as_object_mut())
        .and_then(|ff| ff.get_mut("values"))
        .and_then(|v| v.as_array_mut())
    else {
        return;
    };
    for entry in values {
        let Some(obj) = entry.as_object_mut() else {
            continue;
        };
        if obj.get("fieldType").and_then(|v| v.as_str()) != Some("html") {
            continue;
        }
        if let Some(html) = obj.get_mut("html") {
            let owned = std::mem::replace(html, serde_json::Value::Null);
            *html = rename_field(owned);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_deserialize() {
        let json_str = r#"{
            "id": "node-1",
            "name": "HTTP Request",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 1,
            "position": [250.0, 300.0],
            "parameters": {
                "url": "https://api.example.com"
            }
        }"#;

        let node: INode = serde_json::from_str(json_str).expect("Failed to deserialize INode");
        assert_eq!(node.name, "HTTP Request");
        assert_eq!(node.node_type, "n8n-nodes-base.httpRequest");
        assert_eq!(
            node.position,
            [
                serde_json::Number::from_f64(250.0).expect("finite"),
                serde_json::Number::from_f64(300.0).expect("finite")
            ]
        );
        assert_eq!(node.type_version, serde_json::Number::from(1));
    }

    fn base_node() -> serde_json::Value {
        serde_json::json!({
            "id": "node-1",
            "name": "N",
            "type": "n8n-nodes-base.noOp",
            "typeVersion": 1,
            "position": [0, 0],
            "parameters": {}
        })
    }

    #[test]
    fn test_strict_boundary_required_fields_reject() {
        for missing in ["id", "name", "type", "typeVersion", "position"] {
            let mut v = base_node();
            v.as_object_mut().expect("object").remove(missing);
            assert!(
                serde_json::from_value::<INode>(v).is_err(),
                "missing `{missing}` must fail (contract §2 required)"
            );
        }
        let mut wrong_type = base_node();
        wrong_type["typeVersion"] = serde_json::json!("1");
        assert!(serde_json::from_value::<INode>(wrong_type).is_err());
        let mut bad_position = base_node();
        bad_position["position"] = serde_json::json!([0]);
        assert!(serde_json::from_value::<INode>(bad_position).is_err());
    }

    #[test]
    fn test_missing_parameters_defaults_and_float_version_survives() {
        let mut v = base_node();
        v.as_object_mut().expect("object").remove("parameters");
        v["typeVersion"] = serde_json::json!(4.6);
        let node = serde_json::from_value::<INode>(v).expect("parameters defaults");
        assert_eq!(node.parameters.0, serde_json::json!({}));
        assert_eq!(node.type_version, serde_json::Number::from_f64(4.6).expect("finite"));
        assert!(node.type_version.is_f64());
    }

    #[test]
    fn test_disabled_absent_stays_absent() {
        let node = serde_json::from_value::<INode>(base_node()).expect("parses");
        assert_eq!(node.disabled, None);
        let back = serde_json::to_value(&node).expect("serialises");
        assert!(!back.as_object().expect("object").contains_key("disabled"));
        let mut v = base_node();
        v["disabled"] = serde_json::json!(false);
        let node = serde_json::from_value::<INode>(v).expect("parses");
        assert_eq!(node.disabled, Some(false));
    }

    #[test]
    fn test_unknown_fields_land_in_extra_verbatim() {
        let mut v = base_node();
        v["credentials"] = serde_json::json!({"npmApi": {"id": "1"}});
        v["webhookId"] = serde_json::json!("abc");
        let node = serde_json::from_value::<INode>(v.clone()).expect("parses");
        assert_eq!(node.extra.get("credentials"), v.get("credentials"));
        assert_eq!(node.extra.get("webhookId"), v.get("webhookId"));
        assert_eq!(serde_json::to_value(&node).expect("serialises"), v);
    }

    fn form_node(values: serde_json::Value) -> INode {
        let mut v = base_node();
        v["parameters"] = serde_json::json!({ "formFields": { "values": values } });
        serde_json::from_value(v).expect("parses")
    }

    #[test]
    fn test_rename_form_fields_rewrites_html_only() {
        let mut node = form_node(serde_json::json!([
            { "fieldType": "html", "html": "={{ $json.a }}" },
            { "fieldType": "text", "html": "must-not-touch" },
            { "fieldType": "html" },
            null,
            "junk",
            { "fieldType": "html", "html": 7 }
        ]));
        let mut seen = Vec::new();
        rename_form_fields(&mut node, |v| {
            seen.push(v.clone());
            serde_json::json!("X")
        });
        // Callback saw exactly the two present `html` values, as-is (string + number).
        assert_eq!(seen, vec![serde_json::json!("={{ $json.a }}"), serde_json::json!(7)]);
        let values = node.parameters.0["formFields"]["values"].clone();
        assert_eq!(values[0]["html"], serde_json::json!("X"));
        assert_eq!(values[1]["html"], serde_json::json!("must-not-touch"));
        assert!(!values[2].as_object().expect("object").contains_key("html"));
        assert_eq!(values[3], serde_json::Value::Null);
        assert_eq!(values[4], serde_json::json!("junk"));
        assert_eq!(values[5]["html"], serde_json::json!("X"));
    }

    #[test]
    fn test_rename_form_fields_guards_are_noops() {
        // Each malformed shape leaves the parameters untouched.
        let shapes = vec![
            serde_json::json!({}),
            serde_json::json!({ "formFields": null }),
            serde_json::json!({ "formFields": "nope" }),
            serde_json::json!({ "formFields": [] }),
            serde_json::json!({ "formFields": {} }),
            serde_json::json!({ "formFields": { "values": null } }),
            serde_json::json!({ "formFields": { "values": {} } }),
            serde_json::json!({ "formFields": { "values": "nope" } }),
            serde_json::json!({ "formFields": { "values": [] } }),
        ];
        for parameters in shapes {
            let mut v = base_node();
            v["parameters"] = parameters.clone();
            let mut node = serde_json::from_value::<INode>(v).expect("parses");
            let mut called = false;
            rename_form_fields(&mut node, |v| {
                called = true;
                v
            });
            assert!(!called, "callback must not run for {parameters}");
            assert_eq!(node.parameters.0, parameters);
        }
    }
}
