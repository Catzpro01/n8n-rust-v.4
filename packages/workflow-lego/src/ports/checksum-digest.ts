/**
 * P-EXTERNAL-JSSHA — third-party SHA-256 implementation used by
 * workflow-checksum when WebCrypto is unavailable. Default export, matching the
 * `import jsSHA from 'jssha'` call site in the reference source.
 */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

const jsSHA: WorkflowLegoPorts['checksumDigest']['jsSHA'] =
	impl<WorkflowLegoPorts>().checksumDigest.jsSHA;

export default jsSHA;
