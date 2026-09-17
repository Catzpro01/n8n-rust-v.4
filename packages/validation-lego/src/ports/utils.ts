/** P-KERNEL-UTILS — jsonParse (utils.ts) used by tryToParseObject/Array. */
import { referenceRequire } from './runtime.ts';
export const jsonParse: <T = unknown>(s: string, o?: { acceptJSObject?: boolean; errorMessage?: string; fallbackValue?: T }) => T = referenceRequire()('n8n-workflow').jsonParse;
