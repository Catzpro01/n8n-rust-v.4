use crate::ast::{BinaryOperator, ExprAst, PathSegment, TemplateSegment, UnaryOperator};
use n8n_common::ExpressionError;
use serde_json::Value;

pub fn parse(input: &str) -> Result<ExprAst, ExpressionError> {
    let trimmed = input.trim();

    // Case 1: Pure expression starting with `={{` and ending with `}}`
    if trimmed.starts_with("={{") && trimmed.ends_with("}}") {
        let inner = &trimmed[3..trimmed.len() - 2];
        return parse_single_expression(inner);
    }

    // Case 2: Interpolated template containing `{{ ... }}`
    if trimmed.contains("{{") && trimmed.contains("}}") {
        return parse_template(input);
    }

    // Case 3: Literal plain string
    Ok(ExprAst::Literal(Value::String(input.to_string())))
}

fn parse_template(input: &str) -> Result<ExprAst, ExpressionError> {
    let mut segments = Vec::new();
    let mut cursor = 0;

    while let Some(start_idx) = input[cursor..].find("{{") {
        let abs_start = cursor + start_idx;
        if abs_start > cursor {
            let text = &input[cursor..abs_start];
            segments.push(TemplateSegment::Text(text.to_string()));
        }

        let expr_start = abs_start + 2;
        if let Some(end_idx) = input[expr_start..].find("}}") {
            let abs_end = expr_start + end_idx;
            let expr_str = &input[expr_start..abs_end];
            let parsed_expr = parse_single_expression(expr_str)?;
            segments.push(TemplateSegment::Expression(Box::new(parsed_expr)));
            cursor = abs_end + 2;
        } else {
            return Err(ExpressionError::SyntaxError {
                pos: abs_start,
                message: "Unclosed expression delimiter '{{'".to_string(),
            });
        }
    }

    if cursor < input.len() {
        segments.push(TemplateSegment::Text(input[cursor..].to_string()));
    }

    Ok(ExprAst::Template(segments))
}

fn parse_single_expression(input: &str) -> Result<ExprAst, ExpressionError> {
    let tokens = tokenize(input)?;
    let mut parser = TokenParser::new(tokens);
    let ast = parser.parse_expression(0)?;
    if !parser.is_at_end() {
        return Err(ExpressionError::SyntaxError {
            pos: parser.current_pos(),
            message: format!("Unexpected token after expression: {:?}", parser.peek()),
        });
    }
    Ok(ast)
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64, usize),
    String(String, usize),
    Ident(String, usize),
    Plus(usize),
    Minus(usize),
    Star(usize),
    Slash(usize),
    EqEq(usize),
    BangEq(usize),
    Lt(usize),
    Lte(usize),
    Gt(usize),
    Gte(usize),
    And(usize),
    Or(usize),
    Bang(usize),
    LParen(usize),
    RParen(usize),
    LBracket(usize),
    RBracket(usize),
    Dot(usize),
}

impl Token {
    fn pos(&self) -> usize {
        match self {
            Token::Number(_, p)
            | Token::String(_, p)
            | Token::Ident(_, p)
            | Token::Plus(p)
            | Token::Minus(p)
            | Token::Star(p)
            | Token::Slash(p)
            | Token::EqEq(p)
            | Token::BangEq(p)
            | Token::Lt(p)
            | Token::Lte(p)
            | Token::Gt(p)
            | Token::Gte(p)
            | Token::And(p)
            | Token::Or(p)
            | Token::Bang(p)
            | Token::LParen(p)
            | Token::RParen(p)
            | Token::LBracket(p)
            | Token::RBracket(p)
            | Token::Dot(p) => *p,
        }
    }
}

fn tokenize(input: &str) -> Result<Vec<Token>, ExpressionError> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }

        match ch {
            '+' => { tokens.push(Token::Plus(i)); i += 1; }
            '-' => { tokens.push(Token::Minus(i)); i += 1; }
            '*' => { tokens.push(Token::Star(i)); i += 1; }
            '/' => { tokens.push(Token::Slash(i)); i += 1; }
            '(' => { tokens.push(Token::LParen(i)); i += 1; }
            ')' => { tokens.push(Token::RParen(i)); i += 1; }
            '[' => { tokens.push(Token::LBracket(i)); i += 1; }
            ']' => { tokens.push(Token::RBracket(i)); i += 1; }
            '.' => { tokens.push(Token::Dot(i)); i += 1; }
            '=' if i + 1 < chars.len() && chars[i + 1] == '=' => {
                tokens.push(Token::EqEq(i));
                i += 2;
            }
            '!' if i + 1 < chars.len() && chars[i + 1] == '=' => {
                tokens.push(Token::BangEq(i));
                i += 2;
            }
            '!' => { tokens.push(Token::Bang(i)); i += 1; }
            '<' if i + 1 < chars.len() && chars[i + 1] == '=' => {
                tokens.push(Token::Lte(i));
                i += 2;
            }
            '<' => { tokens.push(Token::Lt(i)); i += 1; }
            '>' if i + 1 < chars.len() && chars[i + 1] == '=' => {
                tokens.push(Token::Gte(i));
                i += 2;
            }
            '>' => { tokens.push(Token::Gt(i)); i += 1; }
            '&' if i + 1 < chars.len() && chars[i + 1] == '&' => {
                tokens.push(Token::And(i));
                i += 2;
            }
            '|' if i + 1 < chars.len() && chars[i + 1] == '|' => {
                tokens.push(Token::Or(i));
                i += 2;
            }
            '"' | '\'' => {
                let quote = ch;
                let start_pos = i;
                i += 1;
                let mut s = String::new();
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == quote {
                        closed = true;
                        i += 1;
                        break;
                    }
                    s.push(chars[i]);
                    i += 1;
                }
                if !closed {
                    return Err(ExpressionError::SyntaxError {
                        pos: start_pos,
                        message: "Unclosed string literal".to_string(),
                    });
                }
                tokens.push(Token::String(s, start_pos));
            }
            ch if ch.is_ascii_digit() => {
                let start_pos = i;
                let mut num_str = String::new();
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    num_str.push(chars[i]);
                    i += 1;
                }
                let val: f64 = num_str.parse().map_err(|_| ExpressionError::SyntaxError {
                    pos: start_pos,
                    message: format!("Invalid number: {num_str}"),
                })?;
                tokens.push(Token::Number(val, start_pos));
            }
            ch if ch.is_alphabetic() || ch == '$' || ch == '_' => {
                let start_pos = i;
                let mut ident = String::new();
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '$' || chars[i] == '_') {
                    ident.push(chars[i]);
                    i += 1;
                }
                tokens.push(Token::Ident(ident, start_pos));
            }
            other => {
                return Err(ExpressionError::SyntaxError {
                    pos: i,
                    message: format!("Unexpected character: '{other}'"),
                });
            }
        }
    }

    Ok(tokens)
}

struct TokenParser {
    tokens: Vec<Token>,
    cursor: usize,
}

impl TokenParser {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, cursor: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.cursor)
    }

    fn advance(&mut self) -> Option<Token> {
        if self.cursor < self.tokens.len() {
            let tok = self.tokens[self.cursor].clone();
            self.cursor += 1;
            Some(tok)
        } else {
            None
        }
    }

    fn is_at_end(&self) -> bool {
        self.cursor >= self.tokens.len()
    }

    fn current_pos(&self) -> usize {
        self.peek().map(|t| t.pos()).unwrap_or_else(|| {
            self.tokens.last().map(|t| t.pos() + 1).unwrap_or(0)
        })
    }

    fn parse_expression(&mut self, min_precedence: u8) -> Result<ExprAst, ExpressionError> {
        let mut left = self.parse_primary_or_unary()?;

        while let Some(tok) = self.peek() {
            let (prec, op) = match tok {
                Token::Or(_) => (1, BinaryOperator::Or),
                Token::And(_) => (2, BinaryOperator::And),
                Token::EqEq(_) => (3, BinaryOperator::Eq),
                Token::BangEq(_) => (3, BinaryOperator::NotEq),
                Token::Lt(_) => (4, BinaryOperator::Lt),
                Token::Lte(_) => (4, BinaryOperator::Lte),
                Token::Gt(_) => (4, BinaryOperator::Gt),
                Token::Gte(_) => (4, BinaryOperator::Gte),
                Token::Plus(_) => (5, BinaryOperator::Add),
                Token::Minus(_) => (5, BinaryOperator::Sub),
                Token::Star(_) => (6, BinaryOperator::Mul),
                Token::Slash(_) => (6, BinaryOperator::Div),
                _ => break,
            };

            if prec < min_precedence {
                break;
            }

            self.advance();
            let right = self.parse_expression(prec + 1)?;
            left = ExprAst::BinaryOp {
                left: Box::new(left),
                op,
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn parse_primary_or_unary(&mut self) -> Result<ExprAst, ExpressionError> {
        match self.peek() {
            Some(Token::Bang(_)) => {
                self.advance();
                let expr = self.parse_primary_or_unary()?;
                Ok(ExprAst::UnaryOp {
                    op: UnaryOperator::Not,
                    expr: Box::new(expr),
                })
            }
            Some(Token::Minus(_)) => {
                self.advance();
                let expr = self.parse_primary_or_unary()?;
                Ok(ExprAst::UnaryOp {
                    op: UnaryOperator::Neg,
                    expr: Box::new(expr),
                })
            }
            _ => self.parse_primary_with_postfix(),
        }
    }

    fn parse_primary_with_postfix(&mut self) -> Result<ExprAst, ExpressionError> {
        let mut expr = self.parse_primary()?;

        // Postfix property access: .prop or [index] or ["prop"]
        while let Some(tok) = self.peek() {
            match tok {
                Token::Dot(_) => {
                    self.advance();
                    match self.advance() {
                        Some(Token::Ident(prop, _)) => {
                            expr = match expr {
                                ExprAst::JsonPath(mut path) => {
                                    path.push(PathSegment::Field(prop.clone()));
                                    ExprAst::JsonPath(path)
                                }
                                ExprAst::NodeLookup { node_name, mut path } => {
                                    path.push(PathSegment::Field(prop.clone()));
                                    ExprAst::NodeLookup { node_name, path }
                                }
                                other => {
                                    return Err(ExpressionError::SyntaxError {
                                        pos: self.current_pos(),
                                        message: format!("Cannot access property '{prop}' on non-path expression: {:?}", other),
                                    });
                                }
                            };
                        }
                        other => {
                            return Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Expected property identifier after '.', found: {:?}", other),
                            });
                        }
                    }
                }
                Token::LBracket(_) => {
                    self.advance();
                    let seg = match self.advance() {
                        Some(Token::String(s, _)) => PathSegment::Field(s.clone()),
                        Some(Token::Number(n, _)) => PathSegment::Index(n as usize),
                        other => {
                            return Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Expected string or number in bracket index, found: {:?}", other),
                            });
                        }
                    };
                    match self.advance() {
                        Some(Token::RBracket(_)) => {}
                        other => {
                            return Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Expected ']' closing index bracket, found: {:?}", other),
                            });
                        }
                    }

                    expr = match expr {
                        ExprAst::JsonPath(mut path) => {
                            path.push(seg);
                            ExprAst::JsonPath(path)
                        }
                        ExprAst::NodeLookup { node_name, mut path } => {
                            path.push(seg);
                            ExprAst::NodeLookup { node_name, path }
                        }
                        other => {
                            return Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Cannot index on non-path expression: {:?}", other),
                            });
                        }
                    };
                }
                _ => break,
            }
        }

        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<ExprAst, ExpressionError> {
        let pos_before = self.current_pos();
        let tok = self.advance().ok_or_else(|| ExpressionError::SyntaxError {
            pos: pos_before,
            message: "Unexpected end of expression".to_string(),
        })?;

        match tok {
            Token::Number(n, _) => {
                if n.fract() == 0.0 {
                    Ok(ExprAst::Literal(Value::Number((n as i64).into())))
                } else {
                    Ok(ExprAst::Literal(serde_json::Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null)))
                }
            }
            Token::String(s, _) => Ok(ExprAst::Literal(Value::String(s.clone()))),
            Token::LParen(_) => {
                let inner = self.parse_expression(0)?;
                match self.advance() {
                    Some(Token::RParen(_)) => Ok(inner),
                    other => Err(ExpressionError::SyntaxError {
                        pos: self.current_pos(),
                        message: format!("Expected ')' closing parenthesis, found: {:?}", other),
                    }),
                }
            }
            Token::Ident(ident, pos) => match ident.as_str() {
                "true" => Ok(ExprAst::Literal(Value::Bool(true))),
                "false" => Ok(ExprAst::Literal(Value::Bool(false))),
                "null" => Ok(ExprAst::Literal(Value::Null)),
                "$itemIndex" | "$item" => Ok(ExprAst::ItemIndex),
                "$json" => Ok(ExprAst::JsonPath(Vec::new())),
                "$node" => {
                    // Expect $node["NodeName"]
                    if let Some(Token::LBracket(_)) = self.peek() {
                        self.advance();
                        let node_name = match self.advance() {
                            Some(Token::String(s, _)) => s.clone(),
                            other => return Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Expected string node name in $node[...], found: {:?}", other),
                            }),
                        };
                        match self.advance() {
                            Some(Token::RBracket(_)) => {}
                            other => return Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Expected ']' after node name, found: {:?}", other),
                            }),
                        }
                        Ok(ExprAst::NodeLookup {
                            node_name,
                            path: Vec::new(),
                        })
                    } else {
                        Err(ExpressionError::SyntaxError {
                            pos: pos,
                            message: "Expected bracket syntax $node['NodeName']".to_string(),
                        })
                    }
                }
                "$vars" | "$env" => {
                    if let Some(Token::Dot(_)) = self.peek() {
                        self.advance();
                        match self.advance() {
                            Some(Token::Ident(var_name, _)) => Ok(ExprAst::Variable(var_name.clone())),
                            other => Err(ExpressionError::SyntaxError {
                                pos: self.current_pos(),
                                message: format!("Expected variable name after $vars., found: {:?}", other),
                            }),
                        }
                    } else {
                        Ok(ExprAst::Variable(ident.clone()))
                    }
                }
                other => Err(ExpressionError::SyntaxError {
                    pos: pos,
                    message: format!("Unknown identifier or keyword '{other}'"),
                }),
            },
            other => Err(ExpressionError::SyntaxError {
                pos: other.pos(),
                message: format!("Unexpected token in primary expression: {:?}", other),
            }),
        }
    }
}
