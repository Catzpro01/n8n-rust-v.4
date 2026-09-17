# TASK RESULT: TASK-411-connection-types-vocabulary — implementation follow-up

- **STATUS**: `COMPLETED`
- **WORKER**: `arena-worker` (`arena/01a0ace3-n8n-rust-v-4`)
- **ROLE**: connection/validation cross-crate seam implementer
- **ALLOCATION**: local work-steal of the frame's unclaimed owner slot; no remote task ownership or consensus claim
- **FRAME REVIEW**: `results/REVIEW-TASK-411-connection-types-vocabulary.md`

## Ringkasan Inti
Saya mengimplementasikan option A dari frame secara eksplisit: `n8n-connection` sekarang menjadi satu-satunya pemilik Rust dari `NODE_CONNECTION_TYPES`, sedangkan `n8n-validation` mempertahankan API publik melalui `pub use` dan memakai konstanta yang sama. Added validation tests compare the exact ordered 13-value n8n 2.9.4 vocabulary and reject non-reference values; the TS oracle, contracts, and golden reference were not modified. A mutation probe changed `ai_outputParser` to `ai_output_parser` and produced exit 101 with both vocabulary tests failing, then the canonical source was restored and the full offline rig passed. Independent peer follow-up is still required; this result does not approve itself or claim live verification.

## Machine Evidence

```text
$ grep -RIn --include='*.rs' 'pub const NODE_CONNECTION_TYPES' crates
crates/n8n-connection/src/lib.rs:19:pub const NODE_CONNECTION_TYPES: [&str; 13] = [

$ tools/rust-offline-rig/run.sh test
# 59 individual `test ... ok` lines observed
# final exit: 0

$ mutation: ai_outputParser -> ai_output_parser
MUTATION_EXIT=101
canonical_vocabulary_matches_n8n_294_exactly ... FAILED
values_outside_the_canonical_vocabulary_are_rejected ... FAILED
# source restored; final offline rig re-run exit: 0

$ node tests/compatibility/contract_conformance.mjs
RESULT: 31/31 CHECKS PASSED

$ node tools/workflow-reference-manifest.mjs --check
Reference integrity check: PASS (15050 files, root f8da35180669d798…)

$ git diff --name-only -- reference tests/reference/agent-4 contracts apps tools docs/isolation/consensus-votes
# no output — forbidden/oracle paths untouched
```

## Physical changes

- `crates/n8n-connection/src/lib.rs`: canonical 13-value `NODE_CONNECTION_TYPES` definition.
- `crates/n8n-validation/src/lib.rs`: re-export and consumer migration; duplicate definition removed.
- `crates/n8n-validation/tests/connection_types_vocabulary.rs`: exact-list and rejection/mutation guard.

No contract, TS oracle, golden reference, live endpoint, or remote consensus record was changed.
