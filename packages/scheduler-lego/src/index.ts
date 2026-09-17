/**
 * @lego/scheduler — Scheduler LEGO (Cron scheduling, scheduled task manager, execution timing)
 * Reference: n8n 2.9.4
 */
export * from './scheduler';

export const LEGO_PROVENANCE = {
  lego: 'scheduler',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
