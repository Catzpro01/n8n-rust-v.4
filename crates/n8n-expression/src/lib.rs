//! Expression LEGO shell — exact port of the first-party evaluation SHELL.
//!
//! Normative sources: `reference/n8n/packages/workflow/src/expression.ts`
//! (`resolveSimpleParameterValue`, `renderExpression`,
//! `convertObjectValueToString`, `getParameterValue`),
//! `expressions/expression-helpers.ts` (`isExpression`), and the observed
//! outcomes in `tests/reference/expression/**`. Contract:
//! `contracts/expression.contract.md` (invariant E1 in particular).
//!
//! ## What is ported, and what is not
//!
//! The reference evaluates `{{ … }}` spans as JavaScript through the
//! third-party `@n8n/tournament` evaluator over a `WorkflowDataProxy`
//! (run data, graph, extensions, luxon dates). Neither the JS evaluator
//! nor the proxy is portable to pure Rust — so this crate ports the SHELL
//! that surrounds them, with the evaluator injected:
//!
//! * [`is_expression`] — the exact one-line gate (contract E1).
//! * [`resolve_leaf`] — the `resolveSimpleParameterValue` shape: identity
//!   for non-expressions, strip `=`, constructor-regex rejection,
//!   function-return errors, string passthrough, `returnObjectAsString`.
//! * [`classify_render_outcome`] — the `renderExpression` catch ladder.
//! * [`convert_object_value_to_string`] — the plain-object/array branch
//!   (`[Object: …]` / `[Array: …]`); the luxon `Date`/`DateTime` branches
//!   need a datetime library and are a documented boundary.
//! * [`resolve_value`] — the `getParameterValue` recursive walk (arrays
//!   mapped, objects rebuilt key-by-key in order, scalars identical).
//!
//! The previous regex backend ([`resolve_template`],
//! [`evaluate_simple_json_path`]) is kept as the documented LIMITED
//! backend behind the injected evaluator ([`simple_backend_evaluate`]):
//! `$json.path` interpolation only. Every runtime probe it cannot
//! reproduce is recorded with a classified reason in
//! `tests/expression_fixtures.rs` — see the probe audit there.

use regex::Regex;
use serde_json::Value;
use thiserror::Error;

/// Mirrors `isExpression` (`expressions/expression-helpers.ts`):
/// an expression is a string whose first character is `=`.
///
/// `charAt(0)` reads the first UTF-16 code unit; `=` is BMP, so
/// `starts_with('=')` is the faithful port — no brace-sniffing.
pub fn is_expression(value: &str) -> bool {
    value.starts_with('=')
}

/// The error taxonomy the shell owns, with `ApplicationError` /
/// `ExpressionError` name parity and verbatim messages.
///
/// The `context` fields the reference attaches (`runIndex`, `itemIndex`,
/// `parameter`, `descriptionKey`, …) are engine-supplied — `parameter` is
/// even added by n8n-core *after* evaluation (contract §6) — so they stay
/// out of this pure layer, exactly like the engine-owned pairing context
/// in `n8n-execution-data`.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ExpressionError {
    /// `ExpressionError('Expression contains invalid constructor function
    /// call')` — the `/\.\s*constructor/` pre-check.
    #[error("Expression contains invalid constructor function call")]
    ConstructorCall,
    /// `ApplicationError('invalid syntax')` — a `SyntaxError` from the
    /// evaluator (contract E14; `05` "syntax error" probe).
    #[error("invalid syntax")]
    InvalidSyntax,
    /// `ApplicationError('this is a function, please add ()')` — the
    /// evaluator returned a function value.
    #[error("this is a function, please add ()")]
    FunctionValue,
    /// `ApplicationError('this is a DateTime, please access its methods')`
    /// — the evaluator returned the `DateTime` class itself.
    #[error("this is a DateTime, please access its methods")]
    DateTimeValue,
    /// `ApplicationError('invalid DateTime')` — the luxon branch of
    /// `convertObjectValueToString`; raised through the passthrough by
    /// backends that can see `DateTime` values (this crate cannot).
    #[error("invalid DateTime")]
    InvalidDateTime,
    /// Any other `ExpressionError` the backend raises (data, node,
    /// pairing, sandbox problems — contract §6): rethrown verbatim.
    #[error("{0}")]
    Evaluation(String),
}

impl ExpressionError {
    /// The reference error-class name (`ExpressionError` vs
    /// `ApplicationError`).
    pub fn error_name(&self) -> &'static str {
        match self {
            ExpressionError::ConstructorCall | ExpressionError::Evaluation(_) => "ExpressionError",
            ExpressionError::InvalidSyntax
            | ExpressionError::FunctionValue
            | ExpressionError::DateTimeValue
            | ExpressionError::InvalidDateTime => "ApplicationError",
        }
    }
}

/// What the injected evaluator may return for one `=`-stripped body.
///
/// `Value` covers the whole JSON domain the fixtures observe (numbers,
/// booleans, objects, arrays, strings, null). `undefined` is
/// unrepresentable in JSON and maps to `Value::Null` here — the same
/// convention `n8n-execution-data` uses (TASK-405 N6/P2) — and the
/// harness compares it against the fixtures' `{"undefined": true}`
/// marker. `Function` carries the JS `typeof`-function value's `name`,
/// which is all `resolveSimpleParameterValue` inspects.
#[derive(Debug, Clone, PartialEq)]
pub enum EvalValue {
    Value(Value),
    Function(String),
}

/// How the injected evaluator may fail, as `renderExpression` classifies
/// it: an `ExpressionError` is rethrown, a syntax error becomes
/// `ApplicationError('invalid syntax')`, and anything else yields `null`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalFault {
    Expression(ExpressionError),
    Syntax,
    Other,
}

/// Ports the `renderExpression` catch ladder over an already-computed
/// evaluator outcome.
///
/// The frontend-only branch (`IS_FRONTEND && TypeError … 'is not a
/// function'`) is dead on the backend and intentionally not modelled:
/// on the backend every non-`ExpressionError`, non-syntax failure falls
/// through to `null`.
pub fn classify_render_outcome(
    result: Result<EvalValue, EvalFault>,
) -> Result<EvalValue, ExpressionError> {
    match result {
        Ok(value) => Ok(value),
        Err(EvalFault::Expression(error)) => Err(error),
        Err(EvalFault::Syntax) => Err(ExpressionError::InvalidSyntax),
        Err(EvalFault::Other) => Ok(EvalValue::Value(Value::Null)),
    }
}

/// The constructor pre-check (`expression.ts`, before `extendSyntax` and
/// evaluation): `/\.\s*constructor/` over the `=`-stripped body.
///
/// Faithful quirks: the match is unanchored, so `x.constructors` (with a
/// trailing `s`) is also rejected, and `\s*` lets `. constructor` match.
/// The `m` flag is irrelevant (no `^`/`$`) and not modelled.
fn rejects_constructor_call(body: &str) -> bool {
    Regex::new(r"\.\s*constructor")
        .expect("static regex")
        .is_match(body)
}

/// Ports the plain-object/array branch of `convertObjectValueToString`
/// (`expression.ts`): `` `[${typeName}: ${spaced JSON}]` `` where the
/// spacing replacements are `,"` → `, "` then `":` → `": `, applied in
/// that order.
///
/// `typeName` is the JS `constructor.name`: `Object` for plain objects,
/// `Array` for arrays. The `Date`/`DateTime` branches need luxon and are
/// the documented boundary; `null` maps to `"null"` per the defensive
/// branch (unreachable through the shell, which guards on `is_object`).
pub fn convert_object_value_to_string(value: &Value) -> String {
    if value.is_null() {
        return "null".to_owned();
    }
    let type_name = if value.is_array() { "Array" } else { "Object" };
    let json = serde_json::to_string(value).expect("Value serialises");
    let spaced = json.replace(",\"", ", \"").replace("\":", "\": ");
    format!("[{type_name}: {spaced}]")
}

/// Ports `resolveSimpleParameterValue` with the evaluator injected.
///
/// Non-expressions (including every non-string — `isExpression` is false
/// for those) are returned unchanged; otherwise the leading `=` is
/// stripped (`substr(1)`; `=` is one byte), constructor calls are
/// rejected, and the body goes to `evaluate`. A returned function is an
/// error (`DateTime` by name, anything else generic); strings pass
/// through; objects render via [`convert_object_value_to_string`] when
/// `return_object_as_string` is set; everything else is returned as-is.
///
/// `extendSyntax` (extension-method rewriting) lives between the
/// constructor check and evaluation in the reference; it needs the
/// extensions library, so the injected evaluator owns whatever syntax it
/// accepts.
pub fn resolve_leaf<F>(
    leaf: &Value,
    return_object_as_string: bool,
    evaluate: &F,
) -> Result<Value, ExpressionError>
where
    F: Fn(&str) -> Result<EvalValue, EvalFault>,
{
    let Value::String(text) = leaf else {
        return Ok(leaf.clone());
    };
    if !is_expression(text) {
        return Ok(leaf.clone());
    }
    let body = &text[1..];
    if rejects_constructor_call(body) {
        return Err(ExpressionError::ConstructorCall);
    }
    match classify_render_outcome(evaluate(body))? {
        EvalValue::Function(name) if name == "DateTime" => Err(ExpressionError::DateTimeValue),
        EvalValue::Function(_) => Err(ExpressionError::FunctionValue),
        EvalValue::Value(Value::String(text)) => Ok(Value::String(text)),
        EvalValue::Value(value) if value.is_object() && return_object_as_string => {
            Ok(Value::String(convert_object_value_to_string(&value)))
        }
        EvalValue::Value(value) => Ok(value),
    }
}

/// Ports the `getParameterValue` recursive walk with the evaluator
/// injected: arrays are mapped, objects are rebuilt key-by-key (order
/// preserved — `serde_json::Map` keeps insertion order in this
/// workspace), every other value goes to [`resolve_leaf`].
///
/// Two structural notes from the transcription. First, the reference
/// threads `siblingParameters` (`{}` for array items, the object itself
/// for entries), but siblings only feed `$parameter` inside the proxy —
/// unobservable through the injected evaluator — so they are not
/// threaded. Second, the `typeof parameterValue !== 'object'` → `{}`
/// line is dead (every non-object returns through the early
/// `!isComplexParameter` branch) and has no JSON counterpart; `null`
/// passes through [`resolve_leaf`] identity instead. Errors propagate
/// to the caller, which owns the `parameter` context (contract §6).
pub fn resolve_value<F>(
    value: &Value,
    return_object_as_string: bool,
    evaluate: &F,
) -> Result<Value, ExpressionError>
where
    F: Fn(&str) -> Result<EvalValue, EvalFault>,
{
    match value {
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(resolve_value(item, return_object_as_string, evaluate)?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (key, entry) in map {
                out.insert(key.clone(), resolve_value(entry, return_object_as_string, evaluate)?);
            }
            let rebuilt = Value::Object(out);
            if return_object_as_string {
                Ok(Value::String(convert_object_value_to_string(&rebuilt)))
            } else {
                Ok(rebuilt)
            }
        }
        _ => resolve_leaf(value, return_object_as_string, evaluate),
    }
}

/// Looks up a dotted `$json.…` path in a payload — the path half of the
/// limited backend. `$json` segments and empty segments are skipped;
/// objects descend by key, arrays by index; anything missing yields
/// `None`. Unchanged by TASK-406.
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

/// Interpolates `{{ $json.path }}` spans over a payload — the template
/// half of the limited backend. Missing paths substitute `""`, strings
/// substitute verbatim, anything else substitutes its compact JSON, and
/// spans the pattern does not match stay literal. Unchanged by TASK-406.
fn interpolate(body: &str, current_json: &Value) -> String {
    let re = Regex::new(r"\{\{\s*(\$json\.[a-zA-Z0-9_\.]+)\s*\}\}").unwrap();
    let mut output = String::new();
    let mut last_match = 0;
    for cap in re.captures_iter(body) {
        let m = cap.get(0).unwrap();
        output.push_str(&body[last_match..m.start()]);
        let path = &cap[1];
        if let Some(val) = evaluate_simple_json_path(current_json, path) {
            match val {
                Value::String(s) => output.push_str(s),
                other => output.push_str(&other.to_string()),
            }
        }
        last_match = m.end();
    }
    output.push_str(&body[last_match..]);
    output
}

/// Renders a template over the current item's payload: a leading `=` is
/// stripped, then the backend fills the `{{ $json.path }}` spans.
/// Behaviour identical to before TASK-406 — the expression gate moved
/// into [`resolve_leaf`]; this stays the ungated backend.
pub fn resolve_template(template: &str, current_json: &Value) -> String {
    let body = template.strip_prefix('=').unwrap_or(template);
    interpolate(body, current_json)
}

/// Adapts the limited backend to the injected-evaluator shape: the
/// `=`-stripped body interpolates over `current_json` and always yields
/// a string — single-span type preservation is the recorded gap, not a
/// silent coercion the harness could mistake for fidelity.
pub fn simple_backend_evaluate(
    body: &str,
    current_json: &Value,
) -> Result<EvalValue, EvalFault> {
    Ok(EvalValue::Value(Value::String(interpolate(
        body,
        current_json,
    ))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_is_expression_is_the_first_char_gate() {
        // Exact port of `charAt(0) === '='`: brace-sniffing is gone.
        assert!(is_expression("={{ $json.a }}"));
        assert!(is_expression("="));
        assert!(is_expression("=just text"));
        assert!(!is_expression("Hello {{ $json.name }}!"));
        assert!(!is_expression("Plain string without tags"));
        assert!(!is_expression(""));
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

    #[test]
    fn test_convert_object_spacing_and_type_names() {
        assert_eq!(
            convert_object_value_to_string(&json!({"a": 1})),
            "[Object: {\"a\": 1}]"
        );
        // Note `[true,null]` keeps no space: the reference only spaces `,"`
        // (comma-quote), never a bare comma.
        assert_eq!(
            convert_object_value_to_string(&json!({"a": 1, "b": [true, null]})),
            "[Object: {\"a\": 1, \"b\": [true,null]}]"
        );
        assert_eq!(
            convert_object_value_to_string(&json!([1, "x"])),
            "[Array: [1, \"x\"]]"
        );
        assert_eq!(convert_object_value_to_string(&Value::Null), "null");
    }

    #[test]
    fn test_render_ladder_maps_faults() {
        assert_eq!(
            classify_render_outcome(Ok(EvalValue::Value(json!(7)))),
            Ok(EvalValue::Value(json!(7)))
        );
        assert_eq!(
            classify_render_outcome(Err(EvalFault::Expression(ExpressionError::Evaluation(
                "custom".to_owned()
            )))),
            Err(ExpressionError::Evaluation("custom".to_owned()))
        );
        assert_eq!(
            classify_render_outcome(Err(EvalFault::Syntax)),
            Err(ExpressionError::InvalidSyntax)
        );
        assert_eq!(
            classify_render_outcome(Err(EvalFault::Other)),
            Ok(EvalValue::Value(Value::Null))
        );
    }

    #[test]
    fn test_leaf_rejects_constructor_calls() {
        let boom = |_: &str| -> Result<EvalValue, EvalFault> {
            panic!("the evaluator must not run once the constructor check fires")
        };
        for body in ["{{ ''.constructor }}", "{{ x.constructor }}", "{{ a. constructor }}"] {
            let err = resolve_leaf(&Value::String(format!("={body}")), false, &boom)
                .expect_err("constructor call rejected");
            assert_eq!(err, ExpressionError::ConstructorCall);
            assert_eq!(err.error_name(), "ExpressionError");
        }
        // Unanchored-substring quirk, ported as observed: `x.constructors`
        // also trips the reference check.
        assert!(resolve_leaf(&Value::String("={{ x.constructors }}".to_owned()), false, &boom)
            .is_err());
        // …while the bare word without a dot passes the gate.
        let echo = |body: &str| -> Result<EvalValue, EvalFault> {
            Ok(EvalValue::Value(Value::String(body.to_owned())))
        };
        assert!(resolve_leaf(&Value::String("=constructor".to_owned()), false, &echo).is_ok());
    }

    #[test]
    fn test_leaf_maps_function_returns_and_strings() {
        let date_time = |_: &str| -> Result<EvalValue, EvalFault> {
            Ok(EvalValue::Function("DateTime".to_owned()))
        };
        let err = resolve_leaf(&Value::String("=x".to_owned()), false, &date_time)
            .expect_err("DateTime class rejected");
        assert_eq!(err.to_string(), "this is a DateTime, please access its methods");
        assert_eq!(err.error_name(), "ApplicationError");

        let plain = |_: &str| -> Result<EvalValue, EvalFault> {
            Ok(EvalValue::Function("foo".to_owned()))
        };
        let err = resolve_leaf(&Value::String("=x".to_owned()), false, &plain)
            .expect_err("function value rejected");
        assert_eq!(err.to_string(), "this is a function, please add ()");

        let string = |_: &str| -> Result<EvalValue, EvalFault> {
            Ok(EvalValue::Value(Value::String("done".to_owned())))
        };
        assert_eq!(
            resolve_leaf(&Value::String("=x".to_owned()), false, &string),
            Ok(Value::String("done".to_owned()))
        );
    }

    #[test]
    fn test_leaf_identity_and_object_flag() {
        let boom = |_: &str| -> Result<EvalValue, EvalFault> {
            panic!("non-expressions must never reach the evaluator")
        };
        assert_eq!(
            resolve_leaf(&json!("hello"), false, &boom),
            Ok(json!("hello"))
        );
        assert_eq!(resolve_leaf(&json!(7), false, &boom), Ok(json!(7)));
        assert_eq!(resolve_leaf(&Value::Null, false, &boom), Ok(Value::Null));

        let object = |_: &str| -> Result<EvalValue, EvalFault> {
            Ok(EvalValue::Value(json!({"a": 1})))
        };
        assert_eq!(
            resolve_leaf(&Value::String("=x".to_owned()), true, &object),
            Ok(Value::String("[Object: {\"a\": 1}]".to_owned()))
        );
        assert_eq!(
            resolve_leaf(&Value::String("=x".to_owned()), false, &object),
            Ok(json!({"a": 1}))
        );
    }
}
