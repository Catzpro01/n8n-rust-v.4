# 14 - Event Bus Subsystem Anatomy

## 1. Event Telemetry & Logging
- Internal EventEmitter emitting events for:
  - `workflow.activated`, `workflow.deactivated`
  - `execution.started`, `execution.finished`, `execution.failed`
  - `node.started`, `node.finished`
- Audit trail, logging destinations (stdout, file, syslog).
