# Agent 4 — executable parity probe for `crates/n8n-validation`

Runs the **current** crate (unmodified, copied out-of-tree) against the language-neutral oracle
fixtures `../validation/fixtures/D*.json` using Agent 1's offline Rust rig
(`tools/rust-offline-rig`, rustc 1.88.0 via npm, crates vendored from git).
Agent 4 does not write to `crates/**`; the probe crate lives here and is assembled in `/tmp`.

```bash
tools/rust-offline-rig/setup.sh          # once (Agent 1)
tests/reference/agent-4/rust-parity/run.sh
```

| File | Purpose |
|---|---|
| `parity.rs` | adapter over the crate's current API (`validate_node_uniqueness` / `validate_dangling_connections` / `detect_cycles`) → verdict + error-code set per fixture; compares with `expected` (codes/valid only — messages/paths/order can't be compared, the crate has none) |
| `findings.rs` | one test per review finding, reproducing the behaviour on the real crate |
| `run.sh` | vendors `indexmap`/`equivalent`/`hashbrown` (missing from the rig's PLAN, added by 8ed00851), builds the probe workspace, runs `cargo test` |

## Result — main @ `e6c0188a`, 2026-09-17

```
parity 10/14  (fail 4)
FAIL D05-invalid-connection-type   crate valid=true            oracle INVALID_CONNECTION_TYPE        (F4)
FAIL D08-ai-edges-ignored          crate CYCLE_DETECTED        oracle valid=true — ai_tool edges     (F2, blocking)
FAIL D10-malformed-input           crate cannot represent      oracle INVALID_INPUT                  (F1, blocking)
FAIL D14-malformed-output-slot     typed deserialisation fails oracle DANGLING_CONNECTION            (F1)
findings: f3 fail-fast (1 of 3 duplicates reported)  reproduced   (F3, blocking)
          f2 ai_tool cycle                            reproduced   (F2)
          f6 cycle witness across 64 runs / 12 procs  {"A"} only → deterministic since IndexMap switch
```

Even the 10 "ok" rows only match on `valid` + code set: message strings, `path`, and error
ordering required by `contracts/validation.contract.md` §4.4/§11.9 are not produced at all.
This is evidence *about the code* (rig caveat: third-party rustc repack, pinned vendored versions);
the VPS run with the real registry remains the gate of record.
