# TASK-419 — Native scheduler timer adapter

Status: **SUBMITTED_FOR_REVIEW**

Implemented a dependency-free `CronTimerAdapter` and `createCronTimerJob` bridge for the existing
`ScheduledTaskManager` host port. The adapter supports n8n's five/six-field cron forms, wildcard,
steps, lists, ranges, month/weekday aliases, IANA timezone projection, day-of-month/day-of-week OR
semantics, synchronous registration validation, stop/teardown, and duplicate-second suppression.

Evidence: scheduler tests **16/16 PASS** (7 new adapter cases), consumer trigger regression remains
**11/11**, scheduler gate **6/6**, reference integrity unchanged.
