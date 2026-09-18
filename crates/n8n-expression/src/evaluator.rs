use crate::ast::{BinaryOperator, ExprAst, PathSegment, TemplateSegment, UnaryOperator};
use crate::parser::parse;
use n8n_common::expression_contract::{EvaluationContext, ExpressionError, ExpressionEvaluator};
use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct StandardExpressionEvaluator;

impl StandardExpressionEvaluator {
    pub fn new() -> Self {
        Self
    }

    pub fn evaluate_ast(
        &self,
        ast: &ExprAst,
        context: &dyn EvaluationContext,
    ) -> Result<Value, ExpressionError> {
        match ast {
            ExprAst::Literal(v) => Ok(v.clone()),
            ExprAst::ItemIndex => Ok(Value::Number(context.get_item_index().into())),
            ExprAst::Variable(k) => context
                .get_variable(k)
                .cloned()
                .ok_or_else(|| ExpressionError::UnresolvedReference {
                    path: format!("$vars.{k}"),
                }),
            ExprAst::JsonPath(path) => {
                let root = context
                    .get_json()
                    .ok_or_else(|| ExpressionError::UnresolvedReference {
                        path: "$json".to_string(),
                    })?;
                navigate_path(root, path, "$json")
            }
            ExprAst::NodeLookup { node_name, path } => {
                let outputs = context
                    .get_node_output(node_name)
                    .ok_or_else(|| ExpressionError::NodeNotFound {
                        node_name: node_name.clone(),
                    })?;

                let item_idx = context.get_item_index();
                let item = outputs.get(item_idx).or_else(|| outputs.first()).ok_or_else(|| {
                    ExpressionError::IndexOutOfBounds {
                        node_name: node_name.clone(),
                        index: item_idx,
                        total: outputs.len(),
                    }
                })?;

                // Skip leading "json" if path starts with "json"
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
            ExprAst::UnaryOp { op, expr } => {
                let val = self.evaluate_ast(expr, context)?;
                match op {
                    UnaryOperator::Not => Ok(Value::Bool(!val_is_truthy(&val))),
                    UnaryOperator::Neg => match val {
                        Value::Number(ref n) => {
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
                    },
                }
            }
            ExprAst::BinaryOp { left, op, right } => {
                let l_val = self.evaluate_ast(left, context)?;
                let r_val = self.evaluate_ast(right, context)?;
                eval_binary_op(&l_val, *op, &r_val)
            }
            ExprAst::Template(segments) => {
                let mut out = String::new();
                for seg in segments {
                    match seg {
                        TemplateSegment::Text(t) => out.push_str(t),
                        TemplateSegment::Expression(expr) => {
                            let val = self.evaluate_ast(expr, context)?;
                            match val {
                                Value::String(s) => out.push_str(&s),
                                Value::Null => {}
                                other => out.push_str(&other.to_string()),
                            }
                        }
                    }
                }
                Ok(Value::String(out))
            }
        }
    }
}

impl ExpressionEvaluator for StandardExpressionEvaluator {
    fn is_expression(&self, input: &str) -> bool {
        let trimmed = input.trim();
        trimmed.starts_with("={{") || (trimmed.contains("{{") && trimmed.contains("}}"))
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

fn val_is_truthy(val: &Value) -> bool {
    match val {
        Value::Bool(b) => *b,
        Value::Null => false,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        Value::Array(arr) => !arr.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
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
            if !val_is_truthy(left) {
                Ok(left.clone())
            } else {
                Ok(right.clone())
            }
        }
        BinaryOperator::Or => {
            if val_is_truthy(left) {
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
            // If one is string, string concatenation
            if let Value::String(s1) = left {
                return Ok(Value::String(format!("{s1}{right}")));
            }
            if let Value::String(s2) = right {
                return Ok(Value::String(format!("{left}{s2}")));
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
        BinaryOperator::Lt => {
            let (n1, n2) = extract_numbers(left, right)?;
            Ok(Value::Bool(n1 < n2))
        }
        BinaryOperator::Lte => {
            let (n1, n2) = extract_numbers(left, right)?;
            Ok(Value::Bool(n1 <= n2))
        }
        BinaryOperator::Gt => {
            let (n1, n2) = extract_numbers(left, right)?;
            Ok(Value::Bool(n1 > n2))
        }
        BinaryOperator::Gte => {
            let (n1, n2) = extract_numbers(left, right)?;
            Ok(Value::Bool(n1 >= n2))
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
