/**
 * Scheduler LEGO — public surface.
 *
 * A 1:1 reconstruction, in plain Node.js ESM, of the pure n8n 2.9.4 cron
 * registry: `toCronExpression` (UI model → cron expression) and
 * `ScheduledTaskManager` (the in-memory timer registry).
 *
 * Contract: contracts/scheduler.contract.md (owner Agent 4, status VERIFIED)
 * Reference: n8n 2.9.4, upstream commit b6dc2787c45677a29a9612cd27eb911302961a83
 * Runtime reference: n8n-workflow@2.9.1 / n8n-core@2.9.1 (n8n 2.9.4 dependency set), cron@4.4.0
 *
 * ZERO RUST — per PROJECT_RULES rule 1.
 * ZERO runtime dependencies — the timer (`CronJob`) is injected at the boundary.
 */

export * from './random.mjs';
export * from './cron-expression.mjs';
export * from './scheduled-task-manager.mjs';
