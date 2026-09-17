/**
 * Error Recovery Policy — rekonstruksi 1:1 perilaku penanganan error node n8n 2.9.4.
 *
 * Sumber referensi (READ-ONLY, tidak diubah):
 *  - reference/n8n/packages/core/src/execution-engine/workflow-execute.ts
 *      L1600-L1613  : resolusi `maxTries` / `waitBetweenTries`
 *      L1614-L1680  : loop retry (throw-based retry + soft-failure retry)
 *      L1811        : normalisasi executionError -> { ...e, message, stack }
 *      L1836-L1872  : cabang `continueOnFail` / `onError`
 *      L1900-L1918  : normalisasi item error ($error/$json -> error)
 *      L2463-L2561  : `handleNodeErrorOutput` (pemisahan item error ke output terakhir)
 *  - reference/n8n/packages/workflow/src/interfaces.ts
 *      L1296        : `OnError = 'continueErrorOutput' | 'continueRegularOutput' | 'stopWorkflow'`
 *      L1306-L1312  : field `retryOnFail`, `maxTries`, `waitBetweenTries`, `onError`, `continueOnFail`
 *
 * Kontrak formal: contracts/error-recovery.contract.md
 *
 * CATATAN PORT: modul ini hanya memuat SEMANTIK keputusan (pure functions + retry loop).
 * Ia tidak menyentuh UI, tidak memakai DI container, dan tidak butuh network —
 * sehingga bisa dipakai oleh engine rekonstruksi (runner.mjs) maupun oleh port Rust nanti.
 */

export type OnError = 'continueErrorOutput' | 'continueRegularOutput' | 'stopWorkflow';

/** Field node yang dipakai kebijakan error/retry (subset INode, interfaces.ts L1306-L1312). */
export interface ErrorRecoveryNode {
	name?: string;
	retryOnFail?: boolean;
	maxTries?: number;
	waitBetweenTries?: number;
	onError?: OnError;
	continueOnFail?: boolean;
}

/** Bentuk error hasil eksekusi (workflow-execute.ts L1811: `{ ...e, message, stack }`). */
export interface NodeError {
	name?: string;
	message: string;
	description?: string;
	stack?: string;
	[key: string]: unknown;
}

export interface NodeExecutionItem {
	json: Record<string, unknown>;
	error?: NodeError;
	pairedItem?: unknown;
	[key: string]: unknown;
}

/** Output node: array per-output, tiap output berisi array item (INodeExecutionData[][]). */
export type NodeOutputData = NodeExecutionItem[][];

export interface RetryPolicy {
	maxTries: number;
	waitBetweenTries: number;
}

/** Batas hardcoded n8n (workflow-execute.ts L1602-L1612, TODO upstream: pindah ke NodeSettings.vue). */
export const RETRY_LIMITS = {
	MIN_TRIES: 2,
	MAX_TRIES: 5,
	DEFAULT_TRIES: 3,
	MIN_WAIT_MS: 0,
	MAX_WAIT_MS: 5000,
	DEFAULT_WAIT_MS: 1000,
} as const;

export type ErrorOutcome =
	| 'stop-workflow'
	| 'continue-regular-output'
	| 'continue-error-output';

export type RetryOutcome<T> =
	| { status: 'success'; data: T; tries: number; attempts: RetryAttempt[] }
	| { status: 'error'; error: NodeError; tries: number; attempts: RetryAttempt[] };

export interface RetryAttempt {
	/** 0-based, sama dengan `tryIndex` di workflow-execute.ts L1614. */
	tryIndex: number;
	/** Jumlah ms tidur SEBELUM percobaan ini dijalankan (0 pada percobaan pertama). */
	waitedMs: number;
	/** Isi jika percobaan ini melempar error atau menghasilkan item error. */
	error?: string;
}

const sleepDefault = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

function errorMessageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/**
 * workflow-execute.ts L1811: `executionError = { ...e, message: e.message, stack: e.stack }`.
 * Spread dipertahankan agar field khusus n8n (description, httpCode, ...) tidak hilang.
 */
export function toExecutionError(error: unknown): NodeError {
	if (error === null || typeof error !== 'object') {
		return { message: errorMessageOf(error) };
	}
	const e = error as Record<string, unknown> & { message?: unknown; stack?: unknown };
	return {
		...(e as Record<string, unknown>),
		message: typeof e.message === 'string' ? e.message : errorMessageOf(error),
		stack: typeof e.stack === 'string' ? e.stack : undefined,
	} as NodeError;
}

/**
 * workflow-execute.ts L1600-L1613.
 * - `retryOnFail !== true`  -> maxTries 1, waitBetweenTries 0 (tanpa retry, tanpa tidur)
 * - `retryOnFail === true`  -> maxTries = min(5, max(2, maxTries || 3))
 *                              waitBetweenTries = min(5000, max(0, waitBetweenTries || 1000))
 * Operator `||` dipertahankan persis: 0 (falsy) jatuh ke nilai default.
 */
export function resolveRetryPolicy(node: ErrorRecoveryNode | undefined): RetryPolicy {
	if (node?.retryOnFail !== true) {
		return { maxTries: 1, waitBetweenTries: 0 };
	}
	const maxTries = Math.min(
		RETRY_LIMITS.MAX_TRIES,
		Math.max(RETRY_LIMITS.MIN_TRIES, node.maxTries || RETRY_LIMITS.DEFAULT_TRIES),
	);
	const waitBetweenTries = Math.min(
		RETRY_LIMITS.MAX_WAIT_MS,
		Math.max(RETRY_LIMITS.MIN_WAIT_MS, node.waitBetweenTries || RETRY_LIMITS.DEFAULT_WAIT_MS),
	);
	return { maxTries, waitBetweenTries };
}

/**
 * workflow-execute.ts L1839-L1846: workflow lanjut jika
 * `continueOnFail === true` ATAU `onError ∈ { continueRegularOutput, continueErrorOutput }`.
 * `continueOnFail` menang untuk arah output: ia melewatkan data lewat output reguler (L1848-L1855).
 */
export function resolveErrorOutcome(node: ErrorRecoveryNode | undefined): ErrorOutcome {
	const continueOnFail = node?.continueOnFail === true;
	const onError = node?.onError ?? 'stopWorkflow';

	if (!continueOnFail && onError !== 'continueRegularOutput' && onError !== 'continueErrorOutput') {
		return 'stop-workflow';
	}
	return onError === 'continueErrorOutput' ? 'continue-error-output' : 'continue-regular-output';
}

export interface RetryOptions<T> {
	/**
	 * Predicate "gagal tanpa throw" — workflow-execute.ts L1655-L1658:
	 * `runNodeData.data?.[0]?.[0]?.json?.error !== undefined`.
	 */
	isFailedResult?: (data: T) => boolean;
	/** Injectable timer supaya tes tidak perlu menunggu dunia nyata. */
	sleep?: (ms: number) => Promise<void>;
}

const defaultIsFailedResult = (data: unknown): boolean => {
	const first = Array.isArray(data) ? (data as NodeOutputData)[0] : undefined;
	const firstItem = Array.isArray(first) ? first[0] : undefined;
	return firstItem?.json?.error !== undefined;
};

/**
 * Loop retry 1:1 workflow-execute.ts L1614-L1680 (termasuk inner while untuk soft-failure).
 * Tidak pernah melempar: kegagalan dikembalikan sebagai `{ status: 'error' }` supaya
 * pemanggil menerapkan `resolveErrorOutcome()` persis seperti cabang L1836-L1872.
 */
export async function runWithRetry<T>(
	task: (tryIndex: number) => Promise<T>,
	policy: RetryPolicy,
	options: RetryOptions<T> = {},
): Promise<RetryOutcome<T>> {
	const sleep = options.sleep ?? sleepDefault;
	const isFailedResult = options.isFailedResult ?? defaultIsFailedResult;
	const attempts: RetryAttempt[] = [];

	let tryIndex = 0;
	let lastError: NodeError | undefined;

	while (tryIndex < policy.maxTries) {
		const waitedMs = tryIndex === 0 ? 0 : policy.waitBetweenTries;
		if (waitedMs !== 0) {
			// L1619-L1627: hanya tidur di antara percobaan, tidak sebelum percobaan pertama.
			await sleep(waitedMs);
		}

		try {
			let data = await task(tryIndex);
			let failed = isFailedResult(data);
			attempts.push({ tryIndex, waitedMs, error: failed ? 'result flagged as error' : undefined });

			// L1660-L1680: retry tambahan saat node mengembalikan item berisi `json.error`
			// (tidak melempar) — berjalan sampai tryIndex == maxTries - 1.
			while (failed && tryIndex !== policy.maxTries - 1) {
				await sleep(policy.waitBetweenTries);
				tryIndex++;
				data = await task(tryIndex);
				failed = isFailedResult(data);
				attempts.push({
					tryIndex,
					waitedMs: policy.waitBetweenTries,
					error: failed ? 'result flagged as error' : undefined,
				});
			}

			return { status: 'success', data, tries: tryIndex + 1, attempts };
		} catch (error) {
			lastError = toExecutionError(error);
			attempts.push({ tryIndex, waitedMs, error: lastError.message });
			if (tryIndex === policy.maxTries - 1) {
				break;
			}
			tryIndex++;
		}
	}

	return {
		status: 'error',
		error: lastError ?? { message: 'Node execution failed' },
		tries: Math.max(1, attempts.length),
		attempts,
	};
}

/**
 * workflow-execute.ts L1900-L1918 — merge informasi error ke output default.
 * - `$error` + `$json` -> `item.error = $error` dan `json = { error: $error.message }`
 * - `item.error`       -> `json = { error: error.message }`
 */
export function normalizeOutputItems(output: NodeOutputData): NodeOutputData {
	for (const execution of output ?? []) {
		for (const lineResult of execution ?? []) {
			if (!lineResult) continue;
			const json = lineResult.json ?? ({} as Record<string, unknown>);
			const wrapped = json.$error as NodeError | undefined;
			if (json.$error !== undefined && json.$json !== undefined) {
				lineResult.error = wrapped;
				lineResult.json = { error: (wrapped as NodeError)?.message ?? String(json.$error) };
			} else if (lineResult.error !== undefined) {
				lineResult.json = { error: lineResult.error.message };
			}
		}
	}
	return output ?? [];
}

/**
 * Deteksi item error — workflow-execute.ts L2510-L2516 (handleNodeErrorOutput):
 * - `item.error`
 * - `json.error` sebagai SATU-SATUNYA key
 * - `json.error` + `json.message` tepat 2 key
 */
export function isErrorItem(item: NodeExecutionItem): boolean {
	if (item?.error !== undefined) return true;
	const json = item?.json ?? {};
	const keys = Object.keys(json);
	if (json.error === undefined) return false;
	return keys.length === 1 || (keys.length === 2 && json.message !== undefined);
}

export interface ErrorOutputSplit {
	/** Output dengan item error dikeluarkan dari output 0..n-2. */
	data: NodeOutputData;
	/** Item yang dipindah ke output khusus error. */
	errorItems: NodeExecutionItem[];
}

/**
 * workflow-execute.ts L2463-L2561 (handleNodeErrorOutput), tanpa resolusi data-proxy:
 * item error pada output reguler (0..mainOutputCount-2) dipindah ke output TERAKHIR
 * (index `mainOutputCount - 1`). Resolusi `$getPairedItem` tidak diport karena butuh
 * WorkflowDataProxy — lihat bagian "Batas Port" di contracts/error-recovery.contract.md.
 */
export function splitErrorOutput(
	output: NodeOutputData,
	mainOutputCount = 2,
): ErrorOutputSplit {
	const data: NodeOutputData = Array.from({ length: Math.max(1, mainOutputCount) }, () => []);
	const source = output ?? [];
	const errorItems: NodeExecutionItem[] = [];
	const lastIndex = Math.max(1, mainOutputCount) - 1;

	for (let outputIndex = 0; outputIndex < lastIndex; outputIndex++) {
		const successItems: NodeExecutionItem[] = [];
		const items = [...(source[outputIndex] ?? [])];
		while (items.length) {
			const item = items.shift();
			if (item === undefined) continue;
			if (isErrorItem(item)) {
				errorItems.push(item);
			} else {
				successItems.push(item);
			}
		}
		data[outputIndex] = successItems;
	}

	data[lastIndex] = [...(source[lastIndex] ?? []), ...errorItems];
	return { data, errorItems };
}

/**
 * Helper siap pakai untuk eksekusi satu node (dipakai runner.mjs):
 * jalankan task dengan retry, lalu putuskan nasib workflow sesuai `onError`/`continueOnFail`.
 */
export async function executeNodeWithRecovery<T>(
	node: ErrorRecoveryNode | undefined,
	task: (tryIndex: number) => Promise<T>,
	options: RetryOptions<T> = {},
): Promise<RetryOutcome<T>> {
	return runWithRetry(task, resolveRetryPolicy(node), options);
}
