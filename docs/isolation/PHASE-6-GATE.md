# PHASE 6 GATE — QUEUE / EVENTS / REALTIME

**Generated:** 2026-09-17T22:31:37.876Z · **Result:** `PASS` (8/8)
**Reference:** n8n 2.9.4 @ b6dc2787c45677a29a9612cd27eb911302961a83

| gate | title | status | detail |
| :--- | :--- | :--- | :--- |
| G01 | contracts, isolation blueprints and manifests present | PASS | 18 artefacts + 3 manifest(s) |
| G02 | QUEUE — frozen constants byte-exact in reference + reconstruction | PASS | channels, command sets, stalled-job policy and error strings verified |
| G03 | EVENTS — catalogues match the reference event maps key-for-key | PASS | 93 relay + 1 queue-metrics + 14 ai names verified (93 relay entries in the engine) |
| G04 | REALTIME — SSE/WS/push wire contract byte-exact | PASS | SSE handshake/frames, WS liveness, config default and relay guard verified |
| G05 | package tests (queue / events / realtime) | PASS | queue 17/17, events 14/14, realtime 14/14 |
| G08 | integration test — QUEUE × EVENTS × REALTIME on one deployment | PASS | 4/4 integration tests |
| G06 | ZERO RUST — crates/ and apps/ hold no Rust artifacts | PASS | crates/ + apps/ clean; Phase-3 Rust archived read-only (24 files under docs/archive/phase3-rust) |
| G07 | reference integrity — owned subsystem trees unchanged at 2.9.4 | PASS | 2.9.4 · scaling 21/b16360db83d3 · events 12/813313cda09a · eventbus 17/69e349590eb9 · push 11/f5511e10044d |

