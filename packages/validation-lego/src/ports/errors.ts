/** P-KERNEL-ERRORS — ApplicationError as thrown by tryToParse* (bound to the pinned runtime; identity matters for instanceof). */
import { referenceRequire } from './runtime.ts';
export const ApplicationError: new (message: string, opts?: unknown) => Error = referenceRequire()('n8n-workflow').ApplicationError;
