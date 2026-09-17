# TASK-421 — Waiting execution webhooks

Status: **SUBMITTED_FOR_REVIEW**

Added a port-driven `WaitingWebhookManager` and n8n-compatible SHA-256 URL signature helpers.
Eight focused cases cover execution state guards, wait-state mutation, run-data/input preservation,
HITL rewiring, webhook matching, signed send-and-wait requests, finished no-action rendering,
concurrent resume suppression, and CORS metadata.

Evidence: webhook suite **24/24 PASS**, webhook gate **5/5 PASS**, reference tree unchanged, and
`npm run verify:all` exit 0.
