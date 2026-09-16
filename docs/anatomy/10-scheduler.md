# 10 - Scheduler Subsystem Anatomy

## 1. Architecture
- Cron evaluation engine (standard 5-part cron syntax).
- Polling timer tick loop (every 1 second or 10 seconds).
- Trigger dispatcher: awakens sleeping workflows without blocking the main event loop.
