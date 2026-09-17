//! Differential golden tests: Rust crate vs ORIGINAL n8n behavior.
//!
//! Each fixture below is byte-identical to `tests/compatibility/fixtures/<name>.json`
//! and each expected output is byte-identical to
//! `tests/compatibility/golden/<name>.expected.txt`, which was produced by the
//! Node.js reference harness (`tests/compatibility/reference/harness.mjs`)
//! running the VERBATIM original n8n graph functions.
//!
//! These tests make `cargo test` a self-contained compatibility gate:
//! if the Rust port ever drifts from the original n8n behavior, this suite
//! fails. Regeneration procedure: see `tests/compatibility/README.md`.
//!
//! DO NOT EDIT BY HAND — regenerate with `tests/compatibility/gen_rust_golden.py`.

fn check(name: &str, fixture: &str, expected: &str) {
    let actual = n8n_workflow_compat::compat_engine::run_fixture(fixture)
        .unwrap_or_else(|e| panic!("fixture `{name}` failed to run: {e}"));
    assert_eq!(
        actual, expected,
        "fixture `{name}`: Rust output diverges from original n8n reference"
    );
}


#[test]
fn golden_01_empty() {
    check(
        "01-empty",
        r#"{
  "name": "01-empty",
  "nodes": [],
  "connections": {},
  "queries": [
    "mapByDestination",
    "getAllNodes",
    "getStartNodes",
    "detectCycles:main",
    "findCycle:main",
    "detectCycles:all",
    "findCycle:all",
    "getChild:Ghost",
    "getParent:Ghost",
    "getNode:Ghost"
  ]
}"#,
        r#"mapByDestination	{}
getAllNodes	[]
getStartNodes	[]
detectCycles:main	false
findCycle:main	null
detectCycles:all	false
findCycle:all	null
getChild:Ghost	[]
getParent:Ghost	[]
getNode:Ghost	null
"#,
    );
}

#[test]
fn golden_02_one_node() {
    check(
        "02-one-node",
        r#"{
  "name": "02-one-node",
  "nodes": [
    {
      "name": "Start",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [250, 300],
      "disabled": false
    }
  ],
  "connections": {},
  "queries": [
    "mapByDestination",
    "getAllNodes",
    "getStartNodes",
    "getChild:Start",
    "getParent:Start",
    "getConnected:Start",
    "getNode:Start",
    "detectCycles:main",
    "findCycle:main"
  ]
}"#,
        r#"mapByDestination	{}
getAllNodes	["Start"]
getStartNodes	["Start"]
getChild:Start	[]
getParent:Start	[]
getConnected:Start	[]
getNode:Start	{"disabled":false,"name":"Start","position":[250,300],"type":"n8n-nodes-base.manualTrigger","typeVersion":1}
detectCycles:main	false
findCycle:main	null
"#,
    );
}

#[test]
fn golden_03_linear() {
    check(
        "03-linear",
        r#"{
  "name": "03-linear",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false },
    { "name": "C", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [[{ "node": "B", "type": "main", "index": 0 }]] },
    "B": { "main": [[{ "node": "C", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getChild:B",
    "getChild:C",
    "getParent:A",
    "getParent:B",
    "getParent:C",
    "getStartNodes",
    "detectCycles:main"
  ]
}"#,
        r#"mapByDestination	{"B":{"main":[[{"index":0,"node":"A","type":"main"}]]},"C":{"main":[[{"index":0,"node":"B","type":"main"}]]}}
getChild:A	["C","B"]
getChild:B	["C"]
getChild:C	[]
getParent:A	[]
getParent:B	["A"]
getParent:C	["A","B"]
getStartNodes	["A"]
detectCycles:main	false
"#,
    );
}

#[test]
fn golden_04_diamond() {
    check(
        "04-diamond",
        r#"{
  "name": "04-diamond",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, -100], "disabled": false },
    { "name": "C", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 100], "disabled": false },
    { "name": "D", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [[{ "node": "B", "type": "main", "index": 0 }], [{ "node": "C", "type": "main", "index": 0 }]] },
    "B": { "main": [[{ "node": "D", "type": "main", "index": 0 }]] },
    "C": { "main": [[{ "node": "D", "type": "main", "index": 1 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getChild:B",
    "getChild:C",
    "getChild:D",
    "getParent:A",
    "getParent:B",
    "getParent:C",
    "getParent:D",
    "getStartNodes",
    "detectCycles:main",
    "findCycle:main"
  ]
}"#,
        r#"mapByDestination	{"B":{"main":[[{"index":0,"node":"A","type":"main"}]]},"C":{"main":[[{"index":1,"node":"A","type":"main"}]]},"D":{"main":[[{"index":0,"node":"B","type":"main"}],[{"index":0,"node":"C","type":"main"}]]}}
getChild:A	["D","C","B"]
getChild:B	["D"]
getChild:C	["D"]
getChild:D	[]
getParent:A	[]
getParent:B	["A"]
getParent:C	["A"]
getParent:D	["A","C","B"]
getStartNodes	["A"]
detectCycles:main	false
findCycle:main	null
"#,
    );
}

#[test]
fn golden_05_chain_depth() {
    check(
        "05-chain-depth",
        r#"{
  "name": "05-chain-depth",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false },
    { "name": "C", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0], "disabled": false },
    { "name": "D", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0], "disabled": false },
    { "name": "E", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [[{ "node": "B", "type": "main", "index": 0 }]] },
    "B": { "main": [[{ "node": "C", "type": "main", "index": 0 }]] },
    "C": { "main": [[{ "node": "D", "type": "main", "index": 0 }]] },
    "D": { "main": [[{ "node": "E", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "getChild:A",
    "getChild:A:main:1",
    "getChild:A:main:2",
    "getChild:A:main:3",
    "getChild:A:main:4",
    "getChild:A:main:5",
    "getChild:A:main:6",
    "getParent:E",
    "getParent:E:main:1",
    "getParent:E:main:2",
    "getParent:E:main:10"
  ]
}"#,
        r#"getChild:A	["E","D","C","B"]
getChild:A:main:1	["B"]
getChild:A:main:2	["C","B"]
getChild:A:main:3	["D","C","B"]
getChild:A:main:4	["E","D","C","B"]
getChild:A:main:5	["E","D","C","B"]
getChild:A:main:6	["E","D","C","B"]
getParent:E	["A","B","C","D"]
getParent:E:main:1	["D"]
getParent:E:main:2	["C","D"]
getParent:E:main:10	["A","B","C","D"]
"#,
    );
}

#[test]
fn golden_06_cycle() {
    check(
        "06-cycle",
        r#"{
  "name": "06-cycle",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false },
    { "name": "C", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [[{ "node": "B", "type": "main", "index": 0 }]] },
    "B": { "main": [[{ "node": "C", "type": "main", "index": 0 }]] },
    "C": { "main": [[{ "node": "A", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getChild:B",
    "getChild:C",
    "getParent:A",
    "getParent:B",
    "getParent:C",
    "detectCycles:main",
    "findCycle:main",
    "getStartNodes"
  ]
}"#,
        r#"mapByDestination	{"A":{"main":[[{"index":0,"node":"C","type":"main"}]]},"B":{"main":[[{"index":0,"node":"A","type":"main"}]]},"C":{"main":[[{"index":0,"node":"B","type":"main"}]]}}
getChild:A	["C","B"]
getChild:B	["A","C"]
getChild:C	["B","A"]
getParent:A	["B","C"]
getParent:B	["C","A"]
getParent:C	["A","B"]
detectCycles:main	true
findCycle:main	["A","B","C"]
getStartNodes	[]
"#,
    );
}

#[test]
fn golden_07_multi_io() {
    check(
        "07-multi-io",
        r#"{
  "name": "07-multi-io",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false },
    { "name": "C", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 200], "disabled": false }
  ],
  "connections": {
    "A": {
      "main": [
        [
          { "node": "B", "type": "main", "index": 0 },
          { "node": "C", "type": "main", "index": 0 }
        ],
        [{ "node": "B", "type": "main", "index": 1 }]
      ]
    }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getChild:B",
    "getChild:C",
    "getParent:A",
    "getParent:B",
    "getParent:C",
    "getStartNodes",
    "detectCycles:main"
  ]
}"#,
        r#"mapByDestination	{"B":{"main":[[{"index":0,"node":"A","type":"main"}],[{"index":1,"node":"A","type":"main"}]]},"C":{"main":[[{"index":0,"node":"A","type":"main"}]]}}
getChild:A	["B","C","B"]
getChild:B	[]
getChild:C	[]
getParent:A	[]
getParent:B	["A","A"]
getParent:C	["A"]
getStartNodes	["A"]
detectCycles:main	false
"#,
    );
}

#[test]
fn golden_08_sparse_indices() {
    check(
        "08-sparse-indices",
        r#"{
  "name": "08-sparse-indices",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [null, [{ "node": "B", "type": "main", "index": 2 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getParent:B",
    "getConnected:A",
    "getStartNodes"
  ]
}"#,
        r#"mapByDestination	{"B":{"main":[[],[],[{"index":1,"node":"A","type":"main"}]]}}
getChild:A	["B"]
getParent:B	["A"]
getConnected:A	["B"]
getStartNodes	["A"]
"#,
    );
}

#[test]
fn golden_09_non_main_types() {
    check(
        "09-non-main-types",
        r#"{
  "name": "09-non-main-types",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false },
    { "name": "C", "type": "@n8n/n8n-nodes-langchain.agent", "typeVersion": 1.7, "position": [440, 0], "disabled": false },
    { "name": "D", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0], "disabled": false },
    { "name": "E", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [880, 0], "disabled": true }
  ],
  "connections": {
    "A": {
      "ai_tool": [[{ "node": "C", "type": "ai_tool", "index": 0 }]],
      "main": [[{ "node": "B", "type": "main", "index": 0 }]]
    },
    "B": { "main": [[{ "node": "D", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getChild:A:ALL",
    "getChild:A:ALL_NON_MAIN",
    "getChild:A:ai_tool",
    "getChild:A:main:1",
    "getParent:C:ALL",
    "getParent:C:main",
    "getParent:D:ALL",
    "getNode:C",
    "getStartNodes",
    "detectCycles:all",
    "findCycle:all"
  ]
}"#,
        r#"mapByDestination	{"B":{"main":[[{"index":0,"node":"A","type":"main"}]]},"C":{"ai_tool":[[{"index":0,"node":"A","type":"ai_tool"}]]},"D":{"main":[[{"index":0,"node":"B","type":"main"}]]}}
getChild:A	["D","B"]
getChild:A:ALL	["D","B","C"]
getChild:A:ALL_NON_MAIN	["C"]
getChild:A:ai_tool	["C"]
getChild:A:main:1	["B"]
getParent:C:ALL	["A"]
getParent:C:main	[]
getParent:D:ALL	["A","B"]
getNode:C	{"disabled":false,"name":"C","position":[440,0],"type":"@n8n/n8n-nodes-langchain.agent","typeVersion":1.7}
getStartNodes	["A","C","E"]
detectCycles:all	false
findCycle:all	null
"#,
    );
}

#[test]
fn golden_10_duplicate_edges() {
    check(
        "10-duplicate-edges",
        r#"{
  "name": "10-duplicate-edges",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "disabled": false },
    { "name": "B", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [[{ "node": "B", "type": "main", "index": 0 }, { "node": "B", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getParent:B",
    "getConnected:A",
    "detectCycles:main",
    "findCycle:main"
  ]
}"#,
        r#"mapByDestination	{"B":{"main":[[{"index":0,"node":"A","type":"main"},{"index":0,"node":"A","type":"main"}]]}}
getChild:A	["B","B"]
getParent:B	["A","A"]
getConnected:A	["B","B"]
detectCycles:main	false
findCycle:main	null
"#,
    );
}

#[test]
fn golden_11_unicode_name() {
    check(
        "11-unicode-name",
        r#"{
  "name": "11-unicode-name",
  "nodes": [
    { "name": "Bézier", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [0, 0], "disabled": false },
    { "name": "When clicking ‘Test step’", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [220, 0], "disabled": false }
  ],
  "connections": {
    "Bézier": { "main": [[{ "node": "When clicking ‘Test step’", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "mapByDestination",
    "getAllNodes",
    "getStartNodes",
    "getChild:Bézier",
    "getParent:When clicking ‘Test step’",
    "getNode:When clicking ‘Test step’",
    "detectCycles:main"
  ]
}"#,
        r#"mapByDestination	{"When clicking ‘Test step’":{"main":[[{"index":0,"node":"Bézier","type":"main"}]]}}
getAllNodes	["Bézier","When clicking ‘Test step’"]
getStartNodes	["Bézier"]
getChild:Bézier	["When clicking ‘Test step’"]
getParent:When clicking ‘Test step’	["Bézier"]
getNode:When clicking ‘Test step’	{"disabled":false,"name":"When clicking ‘Test step’","position":[220,0],"type":"n8n-nodes-base.manualTrigger","typeVersion":1}
detectCycles:main	false
"#,
    );
}
