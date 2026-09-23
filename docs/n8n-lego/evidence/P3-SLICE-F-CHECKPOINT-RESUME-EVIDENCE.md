# P3 Slice F — Checkpoint / Resume — Evidence (Issue #97, planning #75 #5)

- **Milestone:** P3.5 · **Slice:** F — checkpoint/resume over the state-stream seam (§30; #75 required architecture 5; #91 metamorphic mode 4)
- **Branch:** `feat/p3-checkpoint-resume` · **Baseline (frozen):** protected main `4e70e8219f14e416fbfd6559043c4d7f91a4f023` (post-Slice-E #118; open PRs `[]` at fork)
- **Slice boundary:** durable snapshot envelope + fail-closed restore on the EXISTING bounded stream. NOT fs/storage adapter (storage plugs the envelope later), NOT scheduler/frontier serialization (caller context carries that — proven in test), NOT new stream semantics.

## §1 Deliverable (additive on `execution.state-stream@0.1.0`)

- **`snapshot(context?)`** → frozen envelope `{snapshotVersion: 1, bodyJson, digest}` — sha256 seals the canonical body: cursor (`lastSeq`, `firstResidentSeq`), resident backlog (seq-contiguous events), capacity, contract id, and optional **caller context** (JSON-domain, e.g. workflow checksum, frontier cursor, pending work, request context — the #75 recovery fields ride as data).
- **`stateStreamFromSnapshot(snap)`** → `{stream, context, lastSeq, firstResidentSeq}` — **fail-closed at every layer**: shape → snapshot version → digest → JSON parse → body version → contract id → capacity/lastSeq/firstResidentSeq ranges → size↔events count → **seq contiguity** → event JSON-domain. Attacker-resealed digests still fail structural checks (asserted). Restore channel = unexported `Symbol` (not forgeable); restored stream continues the DURABLE seq window (next append = lastSeq+1, asserted).
- **Metamorphic resume (#91 mode 4):** drive-ops split at a mid-checkpoint → `straightFirst ++ resumed ≡ uninterrupted` asserted exactly; end states deep-equal modulo `readCalls` (observation ≠ state); `pendingWork` context roundtrips.
- **Contract delta:** lock exports **5 → 7** (additive, version stays 0.1.0); row count unchanged **35 → zero pin churn**; changelog +1; `.ai` in sync.

## §2 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `lego-state-stream.test.mjs` | **10/10 PASS** (8 E + 2 F) |
| 7 gates | **7/7 PASS** |
| backend full | **947 · 944 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |

## §3 Performance gate — checkpoint/resume cost (single-run; #75 benchmark dimensions)

| metric (100,000 resident events, ~240 B payload) | measurement |
| :--- | :--- |
| checkpoint cost | **241 ms**, envelope **24.1 MB** bodyJson, digest sha256 |
| resume cost | **219 ms** → restored size 100,000, lastSeq intact, context cursor recovered |
| continue-after-resume | explicit `backpressure` at 0.024 ms — **the bound survives the checkpoint** (capacity still enforced on a full restored buffer) |

## §4 Non-scope held

No durable storage adapter, no engine/executor integration, no frontier auto-serialization (context is caller-owned data — asserted roundtrip), no new stream semantics, no capability/REST, no P4+.

**Milestone P3.5 remaining:** none — completion recorded on Issue #97 post-merge.
