# 06 — rename → stale destination index (D-08)

Pins the recorded reference behaviour (`workflow.contract.md` §7 D-08, `connection.contract.md` §3.9): after `renameNode` the source map is fresh, the destination map still holds the old name until `setConnections` is called again. Covers the gap Agent 1 handed to Agent 5 in MSG-12.
