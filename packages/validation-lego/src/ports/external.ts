/** P-EXTERNAL-* — third-party libraries the owned sources import directly (versions pinned by the reference lockfile). */
import { referenceRequire } from './runtime.ts';
const req = referenceRequire();
export const luxon: { DateTime: any } = req('luxon');
export const zod: { z: any } = req('zod');
export const isObject: (v: unknown) => boolean = req('lodash/isObject');
export const EXTERNAL_VERSIONS = () => ({ luxon: req('luxon/package.json').version as string, zod: req('zod/package.json').version as string });
