/**
 * Phase 4F — Execution-log record: the run data the execution logger persists.
 *
 * Phase 4E built the localized *view* of a run (`buildRunEnvelope`). This module builds the
 * **record** the persistence LEGO writes: identity, workflow, mode, timings, node runs and a
 * localized block — with the field names an execution row is expected to carry
 * (`id`, `workflowId`, `workflowName`, `mode`, `status`, `startedAt`, `stoppedAt`, `durationMs`).
 *
 * BOUNDARY (contracts/localization.contract.md §4.11)
 *   owns         : the persisted-record shape + its localized block, run summaries, trigger labels
 *   does NOT own : the database, the transaction, the execution itself, JSON serialization of large
 *                  payloads (`redacted`/`data` blobs stay with the persistence LEGO), nor the clock —
 *                  every timestamp is passed in, which is what makes the record reproducible
 *
 * IMPORTS: `./localization-vocabulary.ts` and `./localization-envelope.ts` (for the envelope type),
 * both in-package. Plain data in, plain data out.
 *
 * RUST: none. Erasable-syntax TypeScript only.
 */

import {
	buildRunEnvelope,
	localizeNodeStatus,
	type NodeRunResult,
	type RunEnvelope,
} from './localization-envelope.ts';
import {
	RUN_MODES,
	createProductRuntime,
	runSummary,
	triggerLabel,
	type RunMode,
} from './localization-vocabulary.ts';
import type { ExecutionStatus, LocalizationRuntime } from './localization-runtime.ts';

/* ------------------------------------------------------------------------------------------------------------------ *
 * Input / output shapes
 * ------------------------------------------------------------------------------------------------------------------ */

export interface ExecutionLogInput {
	/** Execution row id (`execution_entity.id`, string on the wire, numeric in PostgreSQL). */
	readonly executionId: string;
	readonly workflowId: string;
	readonly workflowName: string;
	/** How the run was started. */
	readonly mode: RunMode | string;
	readonly status: ExecutionStatus;
	/** ISO-8601 timestamps supplied by the caller — never read from the clock in here. */
	readonly startedAt: string;
	readonly stoppedAt?: string;
	/** Per-node results, in execution order. */
	readonly nodes?: readonly NodeRunResult[];
	/** Total items that passed through the run, when known. */
	readonly itemCount?: number;
	/** Wall-clock duration in milliseconds; derived from the timestamps when omitted. */
	readonly durationMs?: number;
	/** Explicit locale override for this record. */
	readonly locale?: string;
	/** Non-localized extras the persistence LEGO stores (already redacted by its owner). */
	readonly redacted?: Readonly<Record<string, unknown>>;
}

export interface ExecutionLogRecord {
	readonly id: string;
	readonly workflowId: string;
	readonly workflowName: string;
	readonly mode: string;
	readonly status: ExecutionStatus;
	readonly startedAt: string;
	readonly stoppedAt: string | null;
	readonly durationMs: number | null;
	readonly totalItems: number | null;
	readonly nodeRuns: readonly {
		readonly nodeName: string;
		readonly status: ExecutionStatus;
		readonly itemCount: number | null;
		readonly durationMs: number | null;
	}[];
	/** Localized block: everything the UI/API wants to show, resolved at write time. */
	readonly localized: {
		readonly locale: string;
		readonly direction: 'ltr' | 'rtl';
		readonly message: string;
		readonly summary: string;
		readonly trigger: string;
		readonly labels: RunEnvelope['labels'];
		readonly nodeLines: readonly string[];
		readonly missingKeys: readonly string[];
	};
	readonly redacted: Readonly<Record<string, unknown>>;
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------------------------------------------------ */

/** Milliseconds between two ISO-8601 timestamps; `null` when either side is unusable. */
export function durationBetween(startedAt: string, stoppedAt?: string): number | null {
	if (typeof stoppedAt !== 'string' || stoppedAt === '') return null;
	const start = Date.parse(startedAt);
	const stop = Date.parse(stoppedAt);
	if (!Number.isFinite(start) || !Number.isFinite(stop)) return null;
	const delta = stop - start;
	return delta >= 0 ? delta : null;
}

/** `true` when the value is one of the modes the vocabulary covers. */
export function isKnownRunMode(mode: string): boolean {
	return (RUN_MODES as readonly string[]).includes(mode);
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * Record builder
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Build the execution-log record.
 *
 * Deterministic: no clock, no randomness, fixed key order, and every localized string is resolved
 * once here (so the persisted record cannot drift when the operator changes language later — the
 * locale of the run travels with the run).
 */
export function buildExecutionLogRecord(
	input: ExecutionLogInput,
	runtime: LocalizationRuntime = createProductRuntime(),
): ExecutionLogRecord {
	const locale = runtime.resolveLocale(input.locale);
	const nodes = input.nodes ?? [];
	const durationMs = input.durationMs ?? durationBetween(input.startedAt, input.stoppedAt);

	// The envelope is the single source of truth for labels and node lines — the record must not
	// re-implement formatting, or the two could disagree.
	const envelope = buildRunEnvelope(
		{
			executionId: input.executionId,
			workflowName: input.workflowName,
			status: input.status,
			nodes,
			...(input.itemCount === undefined ? {} : { itemCount: input.itemCount }),
			...(durationMs === null ? {} : { durationMs }),
			locale,
		},
		runtime,
	);

	const summary = runSummary(
		input.status,
		{
			...(envelope.labels.duration === undefined ? {} : { duration: envelope.labels.duration }),
			...(envelope.labels.nodes === undefined ? {} : { nodes: envelope.labels.nodes }),
			...(envelope.labels.items === undefined ? {} : { items: envelope.labels.items }),
		},
		runtime,
		locale,
	);

	return {
		id: input.executionId,
		workflowId: input.workflowId,
		workflowName: input.workflowName,
		mode: input.mode,
		status: input.status,
		startedAt: input.startedAt,
		stoppedAt: input.stoppedAt ?? null,
		durationMs,
		totalItems: input.itemCount ?? null,
		nodeRuns: nodes.map((node) => ({
			nodeName: node.nodeName,
			status: node.status,
			itemCount: node.itemCount ?? null,
			durationMs: node.durationMs ?? null,
		})),
		localized: {
			locale,
			direction: envelope.direction,
			message: envelope.message,
			summary: summary.text,
			trigger: triggerLabel(input.mode, runtime, locale),
			labels: envelope.labels,
			nodeLines: envelope.nodeLines,
			missingKeys: envelope.diagnostics.missingKeys,
		},
		redacted: input.redacted ?? {},
	};
}

/**
 * Localized one-line rendering of a record for logs and CLI output:
 * `EX-1 SMOKETEST001TEST [manual] Selesai dalam 25 ms — 2 node, 3 item`.
 */
export function formatExecutionLogLine(record: ExecutionLogRecord): string {
	const mode = record.mode === '' ? '' : ` [${record.mode}]`;
	return `${record.id} ${record.workflowName}${mode} ${record.localized.summary}`;
}

/** Node lines of a record, localized at write time. */
export function nodeLinesOf(record: ExecutionLogRecord): readonly string[] {
	return record.localized.nodeLines;
}

/**
 * Re-render one node run for a *different* locale without rebuilding the record — used by the API
 * when a client asks for a language other than the run's. The record itself stays untouched.
 */
export function relocalizeNodeLine(
	node: {
		readonly nodeName: string;
		readonly status: ExecutionStatus;
		readonly itemCount: number | null;
		readonly durationMs: number | null;
	},
	runtime: LocalizationRuntime,
	locale?: string,
): string {
	return localizeNodeStatus(
		{
			nodeName: node.nodeName,
			status: node.status,
			...(node.itemCount === null ? {} : { itemCount: node.itemCount }),
			...(node.durationMs === null ? {} : { durationMs: node.durationMs }),
		},
		runtime,
		locale,
	).line;
}
