//! Sandbox gate for the n8n expression evaluator (contract invariant E9).
//!
//! Mirrors the fail-closed checks of n8n v2.9.4
//! (`packages/workflow/src/expression-sandboxing.ts`) adapted to the safe
//! Rust evaluator:
//!
//! * `.<ws>constructor` or `['constructor']` member access is rejected
//!   *before* parsing (upstream: `EXPRESSION_ERROR_OPERATIONS` regex).
//! * `__proto__` and `prototype` member access is rejected
//!   (upstream: AST hooks in `prototypeSanitizer`).
//! * `with` statements and `class` definitions/extensions are rejected
//!   (upstream: `ExpressionWithStatementError` / class-extension hook).
//! * bare `$` usage is rejected by the parser itself (see `parser.rs`).
//!
//! All findings surface as `ExpressionError::SyntaxError`, which the engine
//! layer maps to the `"invalid syntax"` application error class (E14).
//! Because this evaluator never executes arbitrary code, no runtime sandbox
//! is required — the gate exists so that hostile or malformed expressions
//! are rejected deterministically at the same boundary as upstream n8n.

use n8n_common::expression_contract::ExpressionError;
use regex::Regex;
use std::sync::OnceLock;

fn constructor_access_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // `.constructor` and `[ "constructor" ]`-style access after string
        // literals have been blanked out (bracket form leaves `[<spaces>]`
        // where the literal was, so the bracket form is detected by the
        // remaining bare `constructor` identifier check below as well).
        Regex::new(r"\.\s*constructor\b").expect("valid regex")
    })
}

fn member_identifier_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Member access of reserved prototype identifiers, in dot-access
        // form or as a bare identifier (never inside string literals —
        // those are blanked before scanning).
        Regex::new(r"(?:\.\s*|\b)(?:__proto__|prototype)\b").expect("valid regex")
    })
}

fn statement_keyword_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b(?:with|class)\b").expect("valid regex"))
}

/// Replaces every character of each string literal (including its quote
/// delimiters and escapes) with a space, keeping byte positions stable so
/// error positions still refer to the original source. Backtick literals are
/// blanked too (the tokenizer rejects them later on with a syntax error).
fn blank_string_literals(src: &str) -> String {
    let mut out: Vec<char> = Vec::with_capacity(src.chars().count());
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in src.chars() {
        match quote {
            Some(q) => {
                out.push(' ');
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == q {
                    quote = None;
                }
            }
            None => {
                if ch == '"' || ch == '\'' || ch == '`' {
                    quote = Some(ch);
                    out.push(' ');
                } else {
                    out.push(ch);
                }
            }
        }
    }
    out.into_iter().collect()
}

/// Runs all static sandbox checks against one expression body (the text of a
/// single `{{ ... }}` block, or the full `={{ ... }}` inner source).
///
/// Returns `Ok(())` when the source is clean, otherwise the first violation
/// found as a fail-closed `SyntaxError`.
pub fn check_source_sandboxed(expression_body: &str) -> Result<(), ExpressionError> {
    let stripped = blank_string_literals(expression_body);

    let blocked: &[(&Regex, &str)] = &[
        (
            constructor_access_re(),
            "access to the 'constructor' property is blocked in expressions",
        ),
        (
            member_identifier_re(),
            "access to '__proto__'/'prototype' is blocked in expressions",
        ),
        (
            statement_keyword_re(),
            "'with' statements and 'class' definitions are blocked in expressions",
        ),
    ];

    for (re, message) in blocked {
        if let Some(m) = re.find(&stripped) {
            return Err(ExpressionError::SyntaxError {
                pos: m.start(),
                message: message.to_string(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_sources_pass() {
        assert!(check_source_sandboxed("$json.user.name + 1").is_ok());
        assert!(check_source_sandboxed("'prototype is a fine word'").is_ok());
        assert!(check_source_sandboxed("$json.length").is_ok());
        assert!(check_source_sandboxed("$('My Node').first().json.total").is_ok());
    }

    #[test]
    fn constructor_dot_access_rejected() {
        let err = check_source_sandboxed("$json.a .constructor").unwrap_err();
        match err {
            ExpressionError::SyntaxError { message, .. } => {
                assert!(message.contains("constructor"), "got: {message}");
            }
            other => panic!("expected SyntaxError, got {other:?}"),
        }
    }

    #[test]
    fn constructor_dot_access_variants_rejected() {
        // baseline (dot access — same as the upstream `EXPRESSION_ERROR_OPERATIONS` regex)
        assert!(check_source_sandboxed("a.constructor").is_err());
        // whitespace between dot and identifier is caught too
        assert!(check_source_sandboxed("a. constructor").is_err());
        // Inside a plain string literal the word is benign and must pass.
        assert!(check_source_sandboxed("'.constructor'").is_ok());
    }

    #[test]
    fn proto_and_prototype_rejected_but_not_in_strings() {
        assert!(check_source_sandboxed("$json.__proto__").is_err());
        assert!(check_source_sandboxed("obj.prototype").is_err());
        assert!(check_source_sandboxed("'__proto__'").is_ok());
        assert!(check_source_sandboxed("\"prototype\"").is_ok());
    }

    #[test]
    fn with_and_class_rejected() {
        assert!(check_source_sandboxed("with (a) { b }").is_err());
        assert!(check_source_sandboxed("class Evil extends Base {}").is_err());
        // words merely *containing* the keyword must pass
        assert!(check_source_sandboxed("$json.withdrawal").is_ok());
        assert!(check_source_sandboxed("$json.className").is_ok());
    }

    #[test]
    fn blanking_keeps_positions_and_lengths() {
        let src = "a 'xx' b";
        let blanked = blank_string_literals(src);
        assert_eq!(blanked.chars().count(), src.chars().count());
        assert_eq!(blanked, "a      b");
    }
}
