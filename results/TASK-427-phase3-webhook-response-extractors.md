# TASK-427 — Webhook response extractors

Status: **SUBMITTED_FOR_REVIEW**

Added dependency-free `onReceived` and `lastNode` response extraction. Ten tests cover precedence,
first-entry JSON/property selection, output-branch compatibility, exact binary errors, base64 and
persisted binary results, MIME type precedence, all-entry JSON, and no-data responses.

Evidence: webhook suite **59/59 PASS**, webhook gate **5/5 PASS**, reference tree unchanged, and
`npm run verify:all` exit 0.
