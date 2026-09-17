/**
 * @lego/settings — Settings LEGO (Localization, personal settings, 6-language support ID/EN/JV/AR/ZH/RU)
 * Reference: n8n 2.9.4
 */
export * from './settings';

export const LEGO_PROVENANCE = {
  lego: 'settings',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
