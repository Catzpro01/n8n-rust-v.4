//! Minimal strict JSON parser and canonical serializer (std only).
//!
//! Why hand-rolled: this crate is dependency-free by design (offline
//! pipeline constraint — see Cargo.toml). The JSON we consume (workflow
//! fixtures, real n8n workflow files) and produce (compatibility results)
//! is small and fully under our control. Full UTF-8 is supported (real
//! n8n node names contain non-ASCII text, e.g. curly quotes); raw control
//! characters in strings are rejected per the JSON spec.
//!
//! Canonical form (must be byte-identical to the Node.js reference harness
//! `JSON.stringify(sortKeys(...))`):
//! - object keys sorted lexicographically at every level (via `BTreeMap`);
//! - compact separators (`:` and `,`, no whitespace);
//! - standard JSON string escaping (short escapes for `"` `\\` `\b` `\f`
//!   `\n` `\r` `\t`, `\u00XX` lowercase for other control chars, `/` and
//!   all other characters — including non-ASCII — left as-is, matching
//!   `JSON.stringify` with `ensure_ascii`-off behavior);
//! - numbers: integral values printed without a decimal point, other floats
//!   via the shortest round-trip representation (matches V8/f64 Display).

use std::collections::BTreeMap;
use std::fmt::Write as _;

/// A JSON value. Objects use `BTreeMap` so key order is always the
/// canonical sorted order (determinism golden invariant).
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}

impl Json {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_arr(&self) -> Option<&Vec<Json>> {
        match self {
            Json::Arr(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_obj(&self) -> Option<&BTreeMap<String, Json>> {
        match self {
            Json::Obj(o) => Some(o),
            _ => None,
        }
    }
}

/// Parse a complete JSON document (no trailing content allowed).
pub fn parse_document(text: &str) -> Result<Json, String> {
    let mut p = Parser {
        bytes: text.as_bytes(),
        i: 0,
    };
    p.skip_ws();
    let value = p.parse_value()?;
    p.skip_ws();
    if p.i != p.bytes.len() {
        return Err(format!("trailing content at byte {}", p.i));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.i).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let c = self.peek();
        if c.is_some() {
            self.i += 1;
        }
        c
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
                self.i += 1;
            } else {
                break;
            }
        }
    }

    fn err(&self, msg: &str) -> String {
        format!("{msg} (at byte {})", self.i)
    }

    fn expect_lit(&mut self, lit: &str) -> Result<(), String> {
        let end = self.i + lit.len();
        if end <= self.bytes.len() && &self.bytes[self.i..end] == lit.as_bytes() {
            self.i = end;
            Ok(())
        } else {
            Err(self.err(&format!("expected literal `{}`", lit)))
        }
    }

    fn parse_value(&mut self) -> Result<Json, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => Ok(Json::Str(self.parse_string()?)),
            Some(b't') => {
                self.expect_lit("true")?;
                Ok(Json::Bool(true))
            }
            Some(b'f') => {
                self.expect_lit("false")?;
                Ok(Json::Bool(false))
            }
            Some(b'n') => {
                self.expect_lit("null")?;
                Ok(Json::Null)
            }
            Some(c) if c == b'-' || c.is_ascii_digit() => self.parse_number(),
            _ => Err(self.err("unexpected character")),
        }
    }

    fn parse_number(&mut self) -> Result<Json, String> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() {
                self.i += 1;
            } else {
                break;
            }
        }
        if self.peek() == Some(b'.') {
            self.i += 1;
            let mut digits = false;
            while let Some(c) = self.peek() {
                if c.is_ascii_digit() {
                    digits = true;
                    self.i += 1;
                } else {
                    break;
                }
            }
            if !digits {
                return Err(self.err("missing fraction digits"));
            }
        }
        if let Some(c) = self.peek() {
            if c == b'e' || c == b'E' {
                self.i += 1;
                if let Some(s) = self.peek() {
                    if s == b'+' || s == b'-' {
                        self.i += 1;
                    }
                }
                let mut digits = false;
                while let Some(c) = self.peek() {
                    if c.is_ascii_digit() {
                        digits = true;
                        self.i += 1;
                    } else {
                        break;
                    }
                }
                if !digits {
                    return Err(self.err("missing exponent digits"));
                }
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.i]).map_err(|e| e.to_string())?;
        text.parse::<f64>()
            .map(Json::Num)
            .map_err(|e| self.err(&e.to_string()))
    }

    fn parse_hex4(&mut self) -> Result<u32, String> {
        let mut v: u32 = 0;
        for _ in 0..4 {
            let c = self.bump().ok_or_else(|| self.err("truncated \\u escape"))?;
            let d = (c as char)
                .to_digit(16)
                .ok_or_else(|| self.err("bad hex digit in \\u escape"))?;
            v = v * 16 + d;
        }
        Ok(v)
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.bump(); // consume opening quote
        let mut out = String::new();
        loop {
            let c = self.bump().ok_or_else(|| self.err("unterminated string"))?;
            match c {
                b'"' => return Ok(out),
                b'\\' => {
                    let e = self.bump().ok_or_else(|| self.err("truncated escape"))?;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000C}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hi = self.parse_hex4()?;
                            let cp = if (0xD800..0xDC00).contains(&hi) {
                                // High surrogate: require a low surrogate pair.
                                if self.bump() != Some(b'\\') {
                                    return Err(self.err("expected \\u low surrogate"));
                                }
                                if self.bump() != Some(b'u') {
                                    return Err(self.err("expected \\u low surrogate"));
                                }
                                let lo = self.parse_hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return Err(self.err("bad low surrogate"));
                                }
                                0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                            } else if (0xDC00..0xE000).contains(&hi) {
                                return Err(self.err("unexpected low surrogate"));
                            } else {
                                hi
                            };
                            out.push(
                                char::from_u32(cp).ok_or_else(|| self.err("bad code point"))?,
                            );
                        }
                        other => return Err(self.err(&format!("bad escape '\\{}'", other as char))),
                    }
                }
                other => {
                    if other < 0x20 {
                        return Err(self.err("raw control character in string"));
                    }
                    if other < 0x7f {
                        out.push(other as char);
                    } else {
                        // UTF-8 multi-byte sequence (real n8n names can be
                        // non-ASCII, e.g. '’'). Validate and copy verbatim.
                        let len = if (0xc0..0xe0).contains(&other) {
                            2
                        } else if (0xe0..0xf0).contains(&other) {
                            3
                        } else if (0xf0..0xf5).contains(&other) {
                            4
                        } else {
                            return Err(self.err("bad UTF-8 leading byte"));
                        };
                        let start = self.i - 1; // leading byte already consumed
                        let end = start + len;
                        if end > self.bytes.len() {
                            return Err(self.err("truncated UTF-8 sequence"));
                        }
                        for &b in &self.bytes[start + 1..end] {
                            if b & 0xc0 != 0x80 {
                                return Err(self.err("bad UTF-8 continuation byte"));
                            }
                        }
                        let s = std::str::from_utf8(&self.bytes[start..end])
                            .map_err(|e| self.err(&e.to_string()))?;
                        out.push_str(s);
                        self.i = end;
                    }
                }
            }
        }
    }

    fn parse_array(&mut self) -> Result<Json, String> {
        self.bump(); // consume '['
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.bump();
            return Ok(Json::Arr(items));
        }
        loop {
            let v = self.parse_value()?;
            items.push(v);
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b']') => return Ok(Json::Arr(items)),
                _ => return Err(self.err("expected ',' or ']' in array")),
            }
        }
    }

    fn parse_object(&mut self) -> Result<Json, String> {
        self.bump(); // consume '{'
        let mut items: BTreeMap<String, Json> = BTreeMap::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.bump();
            return Ok(Json::Obj(items));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.err("expected object key string"));
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.bump() != Some(b':') {
                return Err(self.err("expected ':' after object key"));
            }
            let v = self.parse_value()?;
            items.insert(key, v);
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b'}') => return Ok(Json::Obj(items)),
                _ => return Err(self.err("expected ',' or '}' in object")),
            }
        }
    }
}

/// Serialize a value in canonical form (see module docs).
pub fn canonicalize(value: &Json) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

fn write_json(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 1e15 {
                let _ = write!(out, "{}", *n as i64);
            } else {
                let _ = write!(out, "{}", n);
            }
        }
        Json::Str(s) => write_str(s, out),
        Json::Arr(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Json::Obj(map) => {
            out.push('{');
            for (i, (k, v)) in map.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_str(k, out);
                out.push(':');
                write_json(v, out);
            }
            out.push('}');
        }
    }
}

fn write_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_fixture_shapes() {
        let doc = r#"{
            "a": [1, 1.7, -2, null, true, false],
            "b": {"z": 1, "a": [null, [{"node": "X", "type": "main", "index": 2}]]},
            "s": "he\"llo \n \t \\u0041"
        }"#;
        let v = parse_document(doc).expect("parse");
        // BTreeMap normalizes key order on parse.
        // Note: JSON `\\` parses to one backslash which is re-escaped to `\\`
        // on output; `u0041` is literal text here (not a \u escape).
        assert_eq!(
            canonicalize(&v),
            r#"{"a":[1,1.7,-2,null,true,false],"b":{"a":[null,[{"index":2,"node":"X","type":"main"}]],"z":1},"s":"he\"llo \n \t \\u0041"}"#
        );
    }

    #[test]
    fn rejects_trailing_content_and_bad_input() {
        assert!(parse_document("{}x").is_err());
        assert!(parse_document("{1:2}").is_err());
        assert!(parse_document("[1,]").is_err());
        assert!(parse_document("{\"a\": \"\u{1}\"}").is_err()); // raw control char
        assert!(parse_document("{\"a\": \"\u{e9}\"}").is_err()); // stray continuation byte
        assert!(parse_document("{\"a\": \"\\u00"}).is_err()); // truncated escape
    }

    #[test]
    fn unicode_round_trip_matches_js() {
        // Real-world n8n data: node names with curly quotes (U+2018/U+2019).
        let doc = r#"{"name": "When clicking \u2018Test step\u2019", "x": "h\u00e9llo"}"#;
        let v = parse_document(doc).expect("parse");
        assert_eq!(
            canonicalize(&v),
            // Non-ASCII passes through unescaped (JS JSON.stringify behavior).
            "{\"name\":\"When clicking \u{2018}Test step\u{2019}\",\"x\":\"h\u{e9}llo\"}"
        );
    }

    #[test]
    fn number_canonical_matches_js() {
        assert_eq!(canonicalize(&Json::Num(1.0)), "1");
        assert_eq!(canonicalize(&Json::Num(1.7)), "1.7");
        assert_eq!(canonicalize(&Json::Num(-2.0)), "-2");
        assert_eq!(canonicalize(&Json::Num(0.0)), "0");
    }
}
