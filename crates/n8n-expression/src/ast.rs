use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum PathSegment {
    Field(String),
    Index(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOperator {
    Add,
    Sub,
    Mul,
    Div,
    Eq,
    NotEq,
    Lt,
    Lte,
    Gt,
    Gte,
    And,
    Or,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOperator {
    Not,
    Neg,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TemplateSegment {
    Text(String),
    Expression(Box<ExprAst>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExprAst {
    Literal(Value),
    JsonPath(Vec<PathSegment>),
    NodeLookup {
        node_name: String,
        path: Vec<PathSegment>,
    },
    ItemIndex,
    Variable(String),
    BinaryOp {
        left: Box<ExprAst>,
        op: BinaryOperator,
        right: Box<ExprAst>,
    },
    UnaryOp {
        op: UnaryOperator,
        expr: Box<ExprAst>,
    },
    Template(Vec<TemplateSegment>),
}
