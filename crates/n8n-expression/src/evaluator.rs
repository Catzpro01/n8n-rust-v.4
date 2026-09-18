//! Deterministic tree-walking evaluator for n8n expressions.
//!
//! Contract anchors (`contracts/expression.contract.md`):
//! * §3   — type preservation for whole-string `={{ ... }}`, JS string
//!          interpolation semantics for mixed templates
//!          (`null` → `""`, objects → `[object Object]`).
//! * E2   — evaluation happens against the per-item context handed in.
//! * E3/E4 — missing properties / unknown nodes fail closed with the
//!          structured `ExpressionError` model (no panics, no `undefined`
//!          leaking into resolved parameters).
//! * E12  — extension methods are dispatched through `extensions.rs`.
//!
//! Internal note: `$('Node')` evaluates to a `NodeRef` runtime handle that
//! only becomes a JSON value after a member access (`.json`, `.first()`,
//! …), mirroring the upstream data-proxy object.

use crate::ast::{BinaryOperator, ExprAst, PathSegment, TemplateSegment, UnaryOperator};
use crate::extensions::{call_method, eval_extended_function, js_stringify, js_truthy};
use crate::parser::parse;
use n8n_common::expression_contract::{EvaluationContext, ExpressionError, ExpressionEvaluator};
use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct StandardExpressionEvaluator;

/// Runtime evaluation product. `NodeRef` can only materialise into a
/// `serde_json::Value` through a member access (see `node_property` /
/// `node_method`).
#[derive(Debug, Clone, PartialEq)]
enum RuntimeValue {
    Json(Value),
    NodeRef(String),
}

impl RuntimeValue {
    /// Extracts the JSON value or fails with a descriptive error.
    fn as_value(&self) -> Result<&Value, ExpressionError> {
        match self {
            RuntimeValue::Json(v) => Ok(v),
            RuntimeValue::NodeRef(name) => Err(ExpressionError::UnresolvedReference {
                path: format!("$('{name}') requires a member access (e.g. .json, .first())"),
            }),
        }
    }
}

impl StandardExpressionEvaluator {
    pub fn new() -> Self {
        Self
    }

    pub fn evaluate_ast(
        &self,
        ast: &ExprAst,
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError> {
        let value = self.eval_runtime(ast, context)?;
        match value {
            RuntimeValue::Json(v) => Ok(v),
            RuntimeValue::NodeRef(name) => Err(ExpressionError::UnresolvedReference {
                path: format!("$('{name}') requires a member access (e.g. .json, .first())"),
            }),
        }
    }

    fn eval_runtime(
        &self,
        ast: &ExprAst,
        context: &dyn EvaluationContext,
    ) -> Result<RuntimeValue, ExpressionError> {
        match ast {
            ExprAst::Literal(v) => Ok(RuntimeValue::Json(v.clone())),

            ExprAst::ItemIndex => Ok(RuntimeValue::Json(Value::Number(
                context.get_item_index().into(),
            ))),

            ExprAst::Variable(k) => context
                .get_variable(k)
                .cloned()
                .map(RuntimeValue::Json)
                .ok_or_else(|| ExpressionError::UnresolvedReference {
                    path: format!("$vars.{k}"),
                }),

            ExprAst::JsonPath(path) => {
                let root = context
                    .get_json()
                    .ok_or_else(|| ExpressionError::UnresolvedReference {
                        path: "$json".to_string(),
                    })?;
                navigate_path(root, path, "$json").map(RuntimeValue::Json)
            }

            ExprAst::NodeLookup { node_name, path } => {
                self.eval_node_lookup(node_name, path, context).map(RuntimeValue::Json)
            }

            ExprAst::NodeHandle(node_name) => Ok(RuntimeValue::NodeRef(node_name.clone())),

            ExprAst::UnaryOp { op, expr } => {
                let val = self.eval_runtime(expr, context)?;
                let val = val.as_value()?;
                match op {
                    UnaryOperator::Not => Ok(RuntimeValue::Json(Value::Bool(!js_truthy(val)))),
                    UnaryOperator::Neg => negate(val).map(RuntimeValue::Json),
                }
            }

            ExprAst::BinaryOp { left, op, right } => {
                // JS-compatible short-circuiting for && / ||: the right
                // side never evaluates when the outcome is already known
                // (this also guards right-hand lookups from surfacing
                // errors, exactly like upstream n8n).
                let l_val = self.eval_runtime(left, context)?;
                let l_val = l_val.as_value()?;
                match op {
                    BinaryOperator::And if !js_truthy(l_val) => {
                        Ok(RuntimeValue::Json(l_val.clone()))
                    }
                    BinaryOperator::Or if js_truthy(l_val) => {
                        Ok(RuntimeValue::Json(l_val.clone()))
                    }
                    _ => {
                        let r_val = self.eval_runtime(right, context)?;
                        let r_val = r_val.as_value()?;
                        eval_binary_op(l_val, *op, r_val).map(RuntimeValue::Json)
                    }
                }
            }

            ExprAst::Template(segments) => {
                let mut out = String::new();
                for seg in segments {
                    match seg {
                        TemplateSegment::Text(t) => out.push_str(t),
                        TemplateSegment::Expression(expr) => {
                            let val = self.eval_runtime(expr, context)?;
                            let val = val.as_value()?;
                            match val {
                                // Contract §3: inside templates null /
                                // undefined render as empty text, objects
                                // as `[object Object]`.
                                Value::String(s) => out.push_str(s),
                                Value::Null => {}
                                other => out.push_str(&js_stringify(other)),
                            }
                        }
                    }
                }
                Ok(RuntimeValue::Json(Value::String(out)))
            }

            ExprAst::Ternary { cond, then_expr, else_expr } => {
                let cond_val = self.eval_runtime(cond, context)?;
                let cond_val = cond_val.as_value()?;
                if js_truthy(cond_val) {
                    self.eval_runtime(then_expr, context)
                } else {
                    self.eval_runtime(else_expr, context)
                }
            }

            ExprAst::ArrayLiteral(elements) => {
                let mut out = Vec::with_capacity(elements.len());
                for el in elements {
                    let v = self.eval_runtime(el, context)?;
                    out.push(v.as_value()?.clone());
                }
                Ok(RuntimeValue::Json(Value::Array(out)))
            }

            ExprAst::ObjectLiteral(pairs) => {
                let mut map = serde_json::Map::new();
                for (key, value_ast) in pairs {
                    let v = self.eval_runtime(value_ast, context)?;
                    map.insert(key.clone(), v.as_value()?.clone());
                }
                Ok(RuntimeValue::Json(Value::Object(map)))
            }

            ExprAst::GetProperty { object, property } => {
                let obj = self.eval_runtime(object, context)?;
                match obj {
                    RuntimeValue::NodeRef(name) => {
                        self.node_property(&name, property, context).map(RuntimeValue::Json)
                    }
                    RuntimeValue::Json(v) => {
                        get_property(&v, property).map(RuntimeValue::Json)
                    }
                }
            }

            ExprAst::GetIndex { object, index } => {
                let obj = self.eval_runtime(object, context)?;
                let idx = self.eval_runtime(index, context)?;
                let idx = idx.as_value()?;
                match obj {
                    RuntimeValue::NodeRef(name) => Err(ExpressionError::TypeError {
                        expected: format!("member access on $('{name}') via .json / .first() / …"),
                        actual: format!("indexed access on node handle '{name}'"),
                    }),
                    RuntimeValue::Json(v) => get_index(&v, idx).map(RuntimeValue::Json),
                }
            }

            ExprAst::MethodCall { target, name, args } => {
                let mut evaluated_args: Vec<Value> = Vec::with_capacity(args.len());
                for arg in args {
                    let v = self.eval_runtime(arg, context)?;
                    evaluated_args.push(v.as_value()?.clone());
                }
                let target_rt = self.eval_runtime(target, context)?;
                match target_rt {
                    RuntimeValue::NodeRef(node_name) => self
                        .node_method(&node_name, name, &evaluated_args, context)
                        .map(RuntimeValue::Json),
                    RuntimeValue::Json(v) => {
                        call_method(&v, name, &evaluated_args).map(RuntimeValue::Json)
                    }
                }
            }

            ExprAst::FunctionCall { name, args } => {
                let mut evaluated_args: Vec<Value> = Vec::with_capacity(args.len());
                for arg in args {
                    let v = self.eval_runtime(arg, context)?;
                    evaluated_args.push(v.as_value()?.clone());
                }
                eval_extended_function(name, &evaluated_args).map(RuntimeValue::Json)
            }
        }
    }

    /// `$node['Name'](.path…)` — positional item lookup (contract §4).
    fn eval_node_lookup(
        &self,
        node_name: &str,
        path: &[PathSegment],
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError> {
        let outputs = context
            .get_node_output(node_name)
            .ok_or_else(|| ExpressionError::NodeNotFound {
                node_name: node_name.to_string(),
            })?;

        let item_idx = context.get_item_index();
        let item = outputs.get(item_idx).or_else(|| outputs.first()).ok_or_else(|| {
            ExpressionError::IndexOutOfBounds {
                node_name: node_name.to_string(),
                index: item_idx,
                total: outputs.len(),
            }
        })?;

        // Skip a leading `json` segment (`$node['X'].json.field`).
        let effective_path = if let Some(PathSegment::Field(f)) = path.first() {
            if f == "json" {
                &path[1..]
            } else {
                &path[..]
            }
        } else {
            &path[..]
        };

        let root = item.get("json").unwrap_or(item);
        navigate_path(root, effective_path, &format!("$node['{node_name}']"))
    }

    /// `$('Name').<property>` — node-handle property access.
    fn node_property(
        &self,
        node_name: &str,
        property: &str,
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError> {
        let outputs = context
            .get_node_output(node_name)
            .ok_or_else(|| ExpressionError::NodeNotFound {
                node_name: node_name.to_string(),
            })?;

        match property {
            "isExecuted" => Ok(Value::Bool(true)),
            "json" | "item" => {
                let item_idx = context.get_item_index();
                let item =
                    outputs.get(item_idx).or_else(|| outputs.first()).ok_or_else(|| {
                        ExpressionError::IndexOutOfBounds {
                            node_name: node_name.to_string(),
                            index: item_idx,
                            total: outputs.len(),
                        }
                    })?;
                if property == "item" {
                    Ok(item.clone())
                } else {
                    Ok(item.get("json").cloned().unwrap_or_else(|| item.clone()))
                }
            }
            "params" => {
                // Node parameters are not part of the ratified
                // `EvaluationContext` trait (they belong to the workflow
                // graph LEGO); fail closed until the trait exposes them.
                Err(ExpressionError::UnresolvedReference {
                    path: format!("$('{node_name}').params"),
                })
            }
            other => Err(ExpressionError::UnresolvedReference {
                path: format!("$('{node_name}').{other}"),
            }),
        }
    }

    /// `$('Name').method(args)` — node-handle methods (`first/last/all`).
    fn node_method(
        &self,
        node_name: &str,
        method: &str,
        args: &[Value],
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError> {
        let outputs = context
            .get_node_output(node_name)
            .ok_or_else(|| ExpressionError::NodeNotFound {
                node_name: node_name.to_string(),
            })?;

        if !args.is_empty() {
            return Err(ExpressionError::TypeError {
                expected: format!("method '{method}' on $('{node_name}') with no arguments"),
                actual: format!("{} argument(s) given", args.len()),
            });
        }

        match method {
            "first" => outputs.first().cloned().ok_or(ExpressionError::IndexOutOfBounds {
                node_name: node_name.to_string(),
                index: 0,
                total: 0,
            }),
            "last" => outputs.last().cloned().ok_or(ExpressionError::IndexOutOfBounds {
                node_name: node_name.to_string(),
                index: 0,
                total: 0,
            }),
            "all" => Ok(Value::Array(outputs.to_vec())),
            other => Err(ExpressionError::TypeError {
                expected: format!("known method on node handle $('{node_name}')"),
                actual: format!("'{other}'"),
            }),
        }
    }
}

impl ExpressionEvaluator for StandardExpressionEvaluator {
    fn is_expression(&self, input: &str) -> bool {
        let trimmed = input.trim();
        // Contract E1: a leading '=' marks an expression context. The
        // handlebars heuristic is kept for the ratified graph contract
        // (string interpolation without a leading '=').
        trimmed.starts_with('=') || (trimmed.contains("{{") && trimmed.contains("}}"))
    }

    fn evaluate(
        &self,
        expression: &str,
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError> {
        let ast = parse(expression)?;
        self.evaluate_ast(&ast, context)
    }
}

/// `.property` on a resolved JSON value (generic, non-path expressions).
fn get_property(value: &Value, property: &str) -> Result<Value, ExpressionError> {
    match value {
        Value::Object(map) => map
            .get(property)
            .cloned()
            .ok_or_else(|| ExpressionError::UnresolvedReference {
                path: format!(".{property}"),
            }),
        Value::Array(arr) if property == "length" => {
            Ok(Value::Number((arr.len() as i64).into()))
        }
        Value::String(s) if property == "length" => {
            Ok(Value::Number((s.encode_utf16().count() as i64).into()))
        }
        _ => Err(ExpressionError::UnresolvedReference {
            path: format!(".{property}"),
        }),
    }
}

/// `expr[dynamic]` on a resolved JSON value.
fn get_index(value: &Value, index: &Value) -> Result<Value, ExpressionError> {
    match (value, index) {
        (Value::Array(arr), Value::Number(n)) => {
            let idx = n.as_u64().ok_or_else(|| ExpressionError::UnresolvedReference {
                path: format!("[{n}]"),
            })? as usize;
            arr.get(idx)
                .cloned()
                .ok_or_else(|| ExpressionError::UnresolvedReference {
                    path: format!("[{idx}]"),
                })
        }
        (Value::Object(map), Value::String(key)) => {
            map.get(key)
                .cloned()
                .ok_or_else(|| ExpressionError::UnresolvedReference {
                    path: format!("[\"{key}\"]"),
                })
        }
        (Value::String(s), Value::Number(n)) => {
            let idx = n.as_u64().ok_or_else(|| ExpressionError::UnresolvedReference {
                path: format!("[{n}]"),
            })? as usize;
            s.chars()
                .nth(idx)
                .map(|c| Value::String(c.to_string()))
                .ok_or_else(|| ExpressionError::UnresolvedReference {
                    path: format!("[{idx}]"),
                })
        }
        (other, idx) => Err(ExpressionError::UnresolvedReference {
            path: format!("<{}>[{}]", type_name(other), js_stringify(idx)),
        }),
    }
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn negate(val: &Value) -> Result<Value, ExpressionError> {
    match val {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Value::Number((-i).into()))
            } else if let Some(f) = n.as_f64() {
                serde_json::Number::from_f64(-f)
                    .map(Value::Number)
                    .ok_or_else(|| ExpressionError::TypeError {
                        expected: "finite number".into(),
                        actual: "NaN or Infinity".into(),
                    })
            } else {
                Err(ExpressionError::TypeError {
                    expected: "number".into(),
                    actual: format!("{val}"),
                })
            }
        }
        other => Err(ExpressionError::TypeError {
            expected: "number".into(),
            actual: format!("{other}"),
        }),
    }
}

fn navigate_path(
    root: &Value,
    path: &[PathSegment],
    base_name: &str,
) -> Result<Value, ExpressionError> {
    let mut current = root;
    let mut traversed = base_name.to_string();

    for seg in path {
        match seg {
            PathSegment::Field(f) => {
                traversed.push_str(&format!(".{f}"));
                match current {
                    Value::Object(map) => {
                        current = map.get(f).ok_or_else(|| {
                            ExpressionError::UnresolvedReference {
                                path: traversed.clone(),
                            }
                        })?;
                    }
                    // JS surface: `.length` is available on arrays and
                    // strings even through plain property access.
                    Value::Array(arr) if f == "length" => {
                        return Ok(Value::Number((arr.len() as i64).into()));
                    }
                    Value::String(s) if f == "length" => {
                        return Ok(Value::Number((s.encode_utf16().count() as i64).into()));
                    }
                    _ => {
                        return Err(ExpressionError::UnresolvedReference {
                            path: traversed.clone(),
                        });
                    }
                }
            }
            PathSegment::Index(idx) => {
                traversed.push_str(&format!("[{idx}]"));
                match current {
                    Value::Array(arr) => {
                        current = arr.get(*idx).ok_or_else(|| {
                            ExpressionError::UnresolvedReference {
                                path: traversed.clone(),
                            }
                        })?;
                    }
                    Value::String(s) => {
                        let ch = s.chars().nth(*idx).ok_or_else(|| {
                            ExpressionError::UnresolvedReference {
                                path: traversed.clone(),
                            }
                        })?;
                        return Ok(Value::String(ch.to_string()));
                    }
                    _ => {
                        return Err(ExpressionError::UnresolvedReference {
                            path: traversed.clone(),
                        });
                    }
                }
            }
        }
    }

    Ok(current.clone())
}

fn eval_binary_op(
    left: &Value,
    op: BinaryOperator,
    right: &Value,
) -> Result<Value, ExpressionError> {
    match op {
        BinaryOperator::Eq => Ok(Value::Bool(left == right)),
        BinaryOperator::NotEq => Ok(Value::Bool(left != right)),
        BinaryOperator::And => {
            if !js_truthy(left) {
                Ok(left.clone())
            } else {
                Ok(right.clone())
            }
        }
        BinaryOperator::Or => {
            if js_truthy(left) {
                Ok(left.clone())
            } else {
                Ok(right.clone())
            }
        }
        BinaryOperator::Add => {
            if let (Value::String(s1), Value::String(s2)) = (left, right) {
                return Ok(Value::String(format!("{s1}{s2}")));
            }
            if let (Some(n1), Some(n2)) = (val_as_f64(left), val_as_f64(right)) {
                return num_result(n1 + n2);
            }
            // If one operand is a string, JS performs concatenation.
            if let Value::String(s1) = left {
                return Ok(Value::String(format!("{s1}{}", js_stringify(right))));
            }
            if let Value::String(s2) = right {
                return Ok(Value::String(format!("{}{s2}", js_stringify(left))));
            }
            Err(ExpressionError::TypeError {
                expected: "numbers or strings for addition".into(),
                actual: format!("{left} + {right}"),
            })
        }
        BinaryOperator::Sub => {
            let (n1, n2) = extract_numbers(left, right)?;
            num_result(n1 - n2)
        }
        BinaryOperator::Mul => {
            let (n1, n2) = extract_numbers(left, right)?;
            num_result(n1 * n2)
        }
        BinaryOperator::Div => {
            let (n1, n2) = extract_numbers(left, right)?;
            if n2 == 0.0 {
                return Err(ExpressionError::TypeError {
                    expected: "non-zero divisor".into(),
                    actual: "division by zero".into(),
                });
            }
            num_result(n1 / n2)
        }
        BinaryOperator::Mod => {
            let (n1, n2) = extract_numbers(left, right)?;
            if n2 == 0.0 {
                return Err(ExpressionError::TypeError {
                    expected: "non-zero divisor".into(),
                    actual: "modulo by zero".into(),
                });
            }
            // Rust f64 % matches JS %: the sign follows the dividend.
            num_result(n1 % n2)
        }
        // Ordered comparisons: JS compares two strings lexicographically,
        // otherwise numerically.
        BinaryOperator::Lt | BinaryOperator::Lte | BinaryOperator::Gt | BinaryOperator::Gte => {
            if let (Value::String(s1), Value::String(s2)) = (left, right) {
                let ord = s1.cmp(s2);
                return Ok(Value::Bool(match op {
                    BinaryOperator::Lt => ord.is_lt(),
                    BinaryOperator::Lte => ord.is_le(),
                    BinaryOperator::Gt => ord.is_gt(),
                    BinaryOperator::Gte => ord.is_ge(),
                    _ => unreachable!(),
                }));
            }
            let (n1, n2) = extract_numbers(left, right)?;
            Ok(Value::Bool(match op {
                BinaryOperator::Lt => n1 < n2,
                BinaryOperator::Lte => n1 <= n2,
                BinaryOperator::Gt => n1 > n2,
                BinaryOperator::Gte => n1 >= n2,
                _ => unreachable!(),
            }))
        }
    }
}

fn val_as_f64(val: &Value) -> Option<f64> {
    match val {
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

fn extract_numbers(left: &Value, right: &Value) -> Result<(f64, f64), ExpressionError> {
    let n1 = val_as_f64(left).ok_or_else(|| ExpressionError::TypeError {
        expected: "number".into(),
        actual: format!("{left}"),
    })?;
    let n2 = val_as_f64(right).ok_or_else(|| ExpressionError::TypeError {
        expected: "number".into(),
        actual: format!("{right}"),
    })?;
    Ok((n1, n2))
}

fn num_result(f: f64) -> Result<Value, ExpressionError> {
    if f.fract() == 0.0 && f >= (i64::MIN as f64) && f <= (i64::MAX as f64) {
        Ok(Value::Number((f as i64).into()))
    } else {
        serde_json::Number::from_f64(f)
            .map(Value::Number)
            .ok_or_else(|| ExpressionError::TypeError {
                expected: "finite float".into(),
                actual: "NaN or Infinite".into(),
            })
    }
}
