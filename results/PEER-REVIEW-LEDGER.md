# Peer Review Ledger (protocol v3, dual-phase)

Appended by `tests/integration/peer_review_rubric.py` when run with
`PHASE=PRE` or `PHASE=POST`. Evidence that the mandatory sweep ran.
Recusals are NOT approvals.

| UTC | phase | reviewer | approved | needs correction | recused |
| :-- | :-- | :-- | --: | --: | --: |
| 2026-09-17T02:16:57Z | PRE | agent-5 | 15 | 0 | 4 |
| 2026-09-17T02:17:30Z | POST | agent-5 | ~~16~~ | 0 | 4 | (count contaminated: this ledger file was itself scanned as a task result; tool fixed, row kept for audit trail)
| 2026-09-17T02:17:47Z | POST | agent-5 | 15 | 0 | 4 |
| 2026-09-17T02:20:10Z | POST | agent-1 | 16 | 0 | 11 |
| 2026-09-17T02:20:23Z | POST | agent-1 | 16 | 0 | 11 |
| 2026-09-17T02:20:32Z | POST | agent-1 | 16 | 0 | 11 |
| 2026-09-17T02:25:49Z | POST | agent-1 | 16 | 0 | 11 |
| 2026-09-17T02:26:25Z | POST | agent-1 | 17 | 0 | 11 |
| 2026-09-17T02:41:27Z | POST | agent-1 | 40 | 1 | 11 |
