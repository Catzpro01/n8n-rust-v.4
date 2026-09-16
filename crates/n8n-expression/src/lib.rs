use regex::Regex;
use serde_json::Value;

pub fn is_expression(val: &str) -> bool {
    val.starts_with("={{") || (val.contains("{{") && val.contains("}}"))
}

pub fn evaluate_simple_json_path<'a>(json: &'a Value, path: &str) -> Option<&'a Value> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = json;
    for part in parts {
        if part == "" {
            continue;
        }
        match current {
            Value::Object(map) => {
                current = map.get(part)?;
            }
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

pub fn resolve_template(template: &str, current_json: &Value) -> String {
    let re = Regex::new(r"\{\{\s*(\$json\.[a-zA-Z0-9_\.]+)\s*\}\}").unwrap();
    let mut result = template.to_string();
    if result.starts_with('=') {
        result = result[1..].to_string();
    }

    let mut output = String::new();
    let mut last_match = 0;
    for cap in re.captures_iter(&result) {
        let m = cap.get(0).unwrap();
        output.push_str(&result[last_match..m.start()]);
        let path = &cap[1];
        if let Some(val) = evaluate_simple_json_path(current_json, path) {
            match val {
                Value::String(s) => output.push_str(s),
                other => output.push_str(&other.to_string()),
            }
        }
        last_match = m.end();
    }
    output.push_str(&result[last_match..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_is_expression() {
        assert!(is_expression("={{ $json.myVar }}"));
        assert!(is_expression("Hello {{ $json.name }}!"));
        assert!(!is_expression("Plain string without tags"));
    }

    #[test]
    fn test_resolve_template() {
        let data = json!({
            "user": {
                "name": "Alice",
                "id": 42
            }
        });

        let rendered = resolve_template("Hello {{ $json.user.name }} (ID: {{ $json.user.id }})", &data);
        assert_eq!(rendered, "Hello Alice (ID: 42)");
    }
}
