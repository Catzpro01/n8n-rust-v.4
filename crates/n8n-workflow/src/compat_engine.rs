//! Compatibility query engine.
//!
//! Mirrors `tests/compatibility/reference/harness.mjs` 1:1 so that both
//! runtimes can be diffed line-by-line on identical fixtures:
//!
//!   <query>\t<canonical-json-result>
//!
//! Query grammar (shared contract with the harness — do not change without
//! updating BOTH sides):
//! ```text
//! mapByDestination
//! getChild:<node>[:<type>[:<depth>]]
//! getParent:<node>[:<type>[:<depth>]]
//! getConnected:<node>[:<type>[:<depth>]]
//! getNode:<node>
//! getAllNodes
//! detectCycles:<main|all>
//! findCycle:<main|all>
//! getStartNodes
//! ```
//!
//! - `<type>`: a concrete connection type, `ALL`, or `ALL_NON_MAIN`;
//!   defaults to `main`.
//! - `<depth>`: integer, `-1` = unlimited; defaults to `-1`.

use std::collections::BTreeMap;

use crate::cycles::{detect_cycles, find_cycle, CycleScope};
use crate::graph::{get_child_nodes_typed, get_connected_nodes, get_parent_nodes_typed};
use crate::json::{canonicalize, parse_document, Json};
use crate::maps::map_connections_by_destination;
use crate::model::{Connection, Connections, INode, MAIN};
use crate::start::get_start_nodes;

pub struct CompatContext {
    pub nodes: BTreeMap<String, INode>,
    pub by_source: Connections,
    pub by_destination: Connections,
    /// Sorted node names (BTreeMap order).
    pub node_names: Vec<String>,
}

/// Build the query context from a parsed fixture document.
pub fn build_context(fx: &Json) -> Result<CompatContext, String> {
    let root = fx
        .as_obj()
        .ok_or_else(|| "fixture root must be an object".to_string())?;

    let mut nodes: BTreeMap<String, INode> = BTreeMap::new();
    if let Some(Json::Arr(items)) = root.get("nodes") {
        for item in items {
            let obj = item
                .as_obj()
                .ok_or_else(|| "fixture node must be an object".to_string())?;
            let name = str_field(obj, "name")?;
            let node_type = str_field(obj, "type")?;
            let type_version = num_field(obj, "typeVersion")?;
            let position = match obj.get("position") {
                Some(Json::Arr(p)) if p.len() == 2 => {
                    let x = p[0].as_f64().ok_or_else(|| "position[0] must be a number".to_string())?;
                    let y = p[1].as_f64().ok_or_else(|| "position[1] must be a number".to_string())?;
                    [x as i64, y as i64]
                }
                _ => return Err("node.position must be [x, y]".to_string()),
            };
            let disabled = obj
                .get("disabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            nodes.insert(
                name.to_string(),
                INode {
                    name: name.to_string(),
                    r#type: node_type.to_string(),
                    type_version,
                    position,
                    disabled,
                },
            );
        }
    }

    let by_source = parse_connections(root.get("connections"))?;
    let by_destination = map_connections_by_destination(&by_source);
    let node_names: Vec<String> = nodes.keys().cloned().collect();

    Ok(CompatContext {
        nodes,
        by_source,
        by_destination,
        node_names,
    })
}

fn str_field<'a>(obj: &'a BTreeMap<String, Json>, key: &str) -> Result<&'a str, String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing string field `{key}`"))
}

fn num_field(obj: &BTreeMap<String, Json>, key: &str) -> Result<f64, String> {
    obj.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("missing number field `{key}`"))
}

/// Parse an `IConnections` value (`null`/absent → empty).
fn parse_connections(value: Option<&Json>) -> Result<Connections, String> {
    let Some(obj) = value else {
        return Ok(BTreeMap::new());
    };
    let map = obj
        .as_obj()
        .ok_or_else(|| "connections must be an object".to_string())?;
    let mut out: Connections = BTreeMap::new();
    for (source, by_type_json) in map {
        let by_type_map = by_type_json
            .as_obj()
            .ok_or_else(|| format!("connections.{source} must be an object"))?;
        let mut by_type: BTreeMap<String, Vec<Option<Vec<Connection>>>> = BTreeMap::new();
        for (ty, slots_json) in by_type_map {
            let slots_arr = slots_json
                .as_arr()
                .ok_or_else(|| format!("connections.{source}.{ty} must be an array"))?;
            let mut slots: Vec<Option<Vec<Connection>>> = Vec::new();
            for slot in slots_arr {
                match slot {
                    Json::Null => slots.push(None),
                    Json::Arr(list) => {
                        let mut conns = Vec::new();
                        for c in list {
                            let cobj = c
                                .as_obj()
                                .ok_or_else(|| "connection entry must be an object".to_string())?;
                            let node = str_field(cobj, "node")?;
                            let cty = str_field(cobj, "type")?;
                            let index = cobj
                                .get("index")
                                .and_then(|v| v.as_f64())
                                .ok_or_else(|| "connection.index must be a number".to_string())?;
                            if index < 0.0 || (index.fract() != 0.0) {
                                return Err("connection.index must be a non-negative integer".to_string());
                            }
                            conns.push(Connection {
                                node: node.to_string(),
                                type_: cty.to_string(),
                                index: index as usize,
                            });
                        }
                        slots.push(Some(conns));
                    }
                    _ => {
                        return Err(format!(
                            "connections.{source}.{ty} slot must be null or an array"
                        ))
                    }
                }
            }
            by_type.insert(ty.clone(), slots);
        }
        out.insert(source.clone(), by_type);
    }
    Ok(out)
}

/* ── JSON builders (canonical form via crate::json::canonicalize) ── */

fn json_of_connection(c: &Connection) -> Json {
    let mut m = BTreeMap::new();
    m.insert("index".to_string(), Json::Num(c.index as f64));
    m.insert("node".to_string(), Json::Str(c.node.clone()));
    m.insert("type".to_string(), Json::Str(c.type_.clone()));
    Json::Obj(m)
}

fn json_of_connections(conns: &Connections) -> Json {
    let mut map = BTreeMap::new();
    for (source, by_type) in conns {
        let mut type_map = BTreeMap::new();
        for (ty, slots) in by_type {
            let mut slot_arr = Vec::new();
            for slot in slots {
                slot_arr.push(match slot {
                    None => Json::Null,
                    Some(list) => Json::Arr(list.iter().map(json_of_connection).collect()),
                });
            }
            type_map.insert(ty.clone(), Json::Arr(slot_arr));
        }
        map.insert(source.clone(), Json::Obj(type_map));
    }
    Json::Obj(map)
}

fn json_of_node(n: &INode) -> Json {
    let mut m = BTreeMap::new();
    m.insert("disabled".to_string(), Json::Bool(n.disabled));
    m.insert("name".to_string(), Json::Str(n.name.clone()));
    m.insert(
        "position".to_string(),
        Json::Arr(vec![
            Json::Num(n.position[0] as f64),
            Json::Num(n.position[1] as f64),
        ]),
    );
    m.insert("type".to_string(), Json::Str(n.r#type.clone()));
    m.insert("typeVersion".to_string(), Json::Num(n.type_version));
    Json::Obj(m)
}

fn json_of_names(names: &[String]) -> Json {
    Json::Arr(names.iter().map(|n| Json::Str(n.clone())).collect())
}

/* ── Query dispatch ── */

fn arg<'a>(parts: &'a [&'a str], idx: usize) -> Result<&'a str, String> {
    parts
        .get(idx)
        .copied()
        .ok_or_else(|| format!("query missing argument at position {idx}"))
}

fn depth_arg(parts: &[&str], idx: usize) -> Result<i32, String> {
    match parts.get(idx) {
        None => Ok(-1),
        Some(d) => d
            .parse::<i32>()
            .map_err(|_| format!("bad depth argument: {d}")),
    }
}

fn scope_arg(parts: &[&str]) -> Result<CycleScope, String> {
    match parts.get(1).copied().unwrap_or("main") {
        "main" => Ok(CycleScope::Main),
        "all" => Ok(CycleScope::All),
        other => Err(format!("bad cycle scope: {other}")),
    }
}

/// Execute one query; returns the canonical JSON result string.
pub fn run_query(q: &str, ctx: &CompatContext) -> Result<String, String> {
    let parts: Vec<&str> = q.split(':').collect();
    match parts[0] {
        "mapByDestination" => Ok(canonicalize(&json_of_connections(
            &map_connections_by_destination(&ctx.by_source),
        ))),

        "getChild" => {
            let node = arg(&parts, 1)?;
            let ty = parts.get(2).copied().unwrap_or(MAIN);
            let depth = depth_arg(&parts, 3)?;
            Ok(canonicalize(&json_of_names(&get_child_nodes_typed(
                &ctx.by_source, node, ty, depth,
            ))))
        }

        "getParent" => {
            let node = arg(&parts, 1)?;
            let ty = parts.get(2).copied().unwrap_or(MAIN);
            let depth = depth_arg(&parts, 3)?;
            Ok(canonicalize(&json_of_names(&get_parent_nodes_typed(
                &ctx.by_destination, node, ty, depth,
            ))))
        }

        "getConnected" => {
            let node = arg(&parts, 1)?;
            let ty = parts.get(2).copied().unwrap_or(MAIN);
            let depth = depth_arg(&parts, 3)?;
            Ok(canonicalize(&json_of_names(&get_connected_nodes(
                &ctx.by_source, node, ty, depth, None,
            ))))
        }

        "getNode" => {
            let name = arg(&parts, 1)?;
            match ctx.nodes.get(name) {
                Some(n) => Ok(canonicalize(&json_of_node(n))),
                None => Ok("null".to_string()),
            }
        }

        "getAllNodes" => Ok(canonicalize(&json_of_names(&ctx.node_names))),

        "detectCycles" => {
            let scope = scope_arg(&parts)?;
            Ok(canonicalize(&Json::Bool(detect_cycles(
                &ctx.by_source,
                scope,
            ))))
        }

        "findCycle" => {
            let scope = scope_arg(&parts)?;
            match find_cycle(&ctx.by_source, scope) {
                None => Ok("null".to_string()),
                Some(names) => Ok(canonicalize(&json_of_names(&names))),
            }
        }

        "getStartNodes" => Ok(canonicalize(&json_of_names(
            &get_start_nodes(&ctx.nodes, &ctx.by_destination)
                .iter()
                .map(|n| n.name.clone())
                .collect::<Vec<String>>(),
        ))),

        other => Err(format!("unknown query: {other}")),
    }
}

/// Run the full fixture: returns the complete output text (one line per
/// query), exactly as the reference harness prints it.
pub fn run_fixture(text: &str) -> Result<String, String> {
    let fx = parse_document(text).map_err(|e| format!("fixture parse error: {e}"))?;
    let ctx = build_context(&fx)?;

    let queries: Vec<&str> = match fx.as_obj().and_then(|o| o.get("queries")) {
        Some(Json::Arr(items)) => items
            .iter()
            .map(|q| {
                q.as_str()
                    .ok_or_else(|| "fixture query entries must be strings".to_string())
            })
            .collect::<Result<Vec<&str>, String>>()?,
        _ => return Err("fixture.queries (array of strings) is required".to_string()),
    };

    let mut out = String::new();
    for q in queries {
        let result = run_query(q, &ctx)?;
        out.push_str(q);
        out.push('\t');
        out.push_str(&result);
        out.push('\n');
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_fixture_matches_golden() {
        let fixture = r#"{
          "name": "unit-empty",
          "nodes": [],
          "connections": {},
          "queries": ["mapByDestination", "getAllNodes", "getStartNodes", "detectCycles:main", "findCycle:main", "getChild:Ghost", "getParent:Ghost", "getNode:Ghost"]
        }"#;
        assert_eq!(
            run_fixture(fixture).expect("run"),
            "mapByDestination\t{}\n\
             getAllNodes\t[]\n\
             getStartNodes\t[]\n\
             detectCycles:main\tfalse\n\
             findCycle:main\tnull\n\
             getChild:Ghost\t[]\n\
             getParent:Ghost\t[]\n\
             getNode:Ghost\tnull\n"
        );
    }
}
