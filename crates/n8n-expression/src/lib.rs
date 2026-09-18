pub mod ast;
pub mod evaluator;
pub mod parser;

pub use ast::{BinaryOperator, ExprAst, PathSegment, TemplateSegment, UnaryOperator};
pub use evaluator::StandardExpressionEvaluator;
pub use parser::parse;

use n8n_common::expression_contract::ExpressionEvaluator;
use serde_json::Value;

/// Checks if a string has expression markers.
pub fn is_expression(val: &str) -> bool {
    let trimmed = val.trim();
    trimmed.starts_with("={{") || (trimmed.contains("{{") && trimmed.contains("}}"))
}

/// Convenience standalone evaluation against a single Value payload.
pub fn evaluate_simple_json_path<'a>(json: &'a Value, path: &str) -> Option<&'a Value> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = json;
    for part in parts {
        if part == "$json" || part.is_empty() {
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

/// Convenience string template resolver.
pub fn resolve_template(template: &str, current_json: &Value) -> String {
    let evaluator = StandardExpressionEvaluator::new();
    let context = n8n_common::expression_contract::SimpleEvaluationContext::new()
        .with_json(current_json.clone());
    evaluator
        .evaluate(template, &context)
        .map(|v| match v {
            Value::String(s) => s,
            other => other.to_string(),
        })
        .unwrap_or_else(|_| template.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use n8n_common::expression_contract::{ExpressionError, SimpleEvaluationContext};
    use serde_json::json;

    #[test]
    fn test_is_expression() {
        assert!(is_expression("={{ $json.myVar }}"));
        assert!(is_expression("Hello {{ $json.name }}!"));
        assert!(!is_expression("Plain string without tags"));
    }

    #[test]
    fn test_evaluator_json_lookup() {
        let evaluator = StandardExpressionEvaluator::new();
        let context = SimpleEvaluationContext::new().with_json(json!({
            "user": {
                "id": 101,
                "name": "Bob",
                "active": true
            },
            "scores": [95, 88, 72]
        }));

        let r1 = evaluator.evaluate("={{ $json.user.name }}", &context).unwrap();
        assert_eq!(r1, json!("Bob"));

        let r2 = evaluator.evaluate("={{ $json.scores[1] }}", &context).unwrap();
        assert_eq!(r2, json!(88));

        let r3 = evaluator.evaluate("={{ $json.user.active }}", &context).unwrap();
        assert_eq!(r3, json!(true));
    }

    #[test]
    fn test_evaluator_template_interpolation() {
        let evaluator = StandardExpressionEvaluator::new();
        let context = SimpleEvaluationContext::new().with_json(json!({
            "user": { "name": "Alice" },
            "status": "Online"
        }));

        let rendered = evaluator
            .evaluate("User: {{ $json.user.name }} is {{ $json.status }}", &context)
            .unwrap();
        assert_eq!(rendered, json!("User: Alice is Online"));
    }

    #[test]
    fn test_evaluator_node_lookup() {
        let evaluator = StandardExpressionEvaluator::new();
        let context = SimpleEvaluationContext::new()
            .with_json(json!({ "current": 1 }))
            .with_node_output("TriggerNode", vec![json!({ "json": { "token": "abc-123" } })]);

        let res = evaluator
            .evaluate("={{ $node['TriggerNode'].json.token }}", &context)
            .unwrap();
        assert_eq!(res, json!("abc-123"));
    }

    #[test]
    fn test_evaluator_arithmetic_and_logic() {
        let evaluator = StandardExpressionEvaluator::new();
        let context = SimpleEvaluationContext::new().with_json(json!({
            "a": 10,
            "b": 25,
            "valid": true
        }));

        let r_math = evaluator.evaluate("={{ $json.a * 2 + $json.b }}", &context).unwrap();
        assert_eq!(r_math, json!(45));

        let r_cmp = evaluator.evaluate("={{ $json.b > $json.a }}", &context).unwrap();
        assert_eq!(r_cmp, json!(true));

        let r_logic = evaluator.evaluate("={{ $json.valid && $json.a == 10 }}", &context).unwrap();
        assert_eq!(r_logic, json!(true));
    }

    #[test]
    fn test_evaluator_strict_error_model_no_panic() {
        let evaluator = StandardExpressionEvaluator::new();
        let context = SimpleEvaluationContext::new().with_json(json!({ "foo": "bar" }));

        // Missing field
        let err_field = evaluator.evaluate("={{ $json.nonexistent.nested }}", &context).unwrap_err();
        match err_field {
            ExpressionError::UnresolvedReference { path } => {
                assert!(path.contains("nonexistent"));
            }
            _ => panic!("Expected UnresolvedReference"),
        }

        // Missing node
        let err_node = evaluator.evaluate("={{ $node['GhostNode'].json.val }}", &context).unwrap_err();
        match err_node {
            ExpressionError::NodeNotFound { node_name } => {
                assert_eq!(node_name, "GhostNode");
            }
            _ => panic!("Expected NodeNotFound"),
        }

        // Division by zero
        let err_div = evaluator.evaluate("={{ 10 / 0 }}", &context).unwrap_err();
        match err_div {
            ExpressionError::TypeError { actual, .. } => {
                assert!(actual.contains("division by zero"));
            }
            _ => panic!("Expected division by zero TypeError"),
        }

        // Malformed syntax (unclosed delimiter) -> strictly returns SyntaxError, zero panic!
        let err_syntax = evaluator.evaluate("={{ $json.foo + }}", &context).unwrap_err();
        match err_syntax {
            ExpressionError::SyntaxError { .. } => {}
            _ => panic!("Expected SyntaxError"),
        }
    }
}
