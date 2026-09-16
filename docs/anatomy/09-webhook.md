# 09 - Webhook Subsystem Anatomy

## 1. Lifecycle
- Registration: When workflow is active, endpoint `/webhook/:path` or `/webhook-test/:path` is registered in memory.
- Execution: Incoming HTTP request passes through auth header checks, payload parsing, and starts execution.
- Response: Immediate HTTP 200/204 or delayed response containing final workflow node output.
