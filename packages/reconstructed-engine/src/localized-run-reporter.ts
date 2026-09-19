// Localized Run Reporter (Phase 4B) — SWARM-PHASE4-11
//
// Mengubah hasil eksekusi mesin DAG menjadi laporan teks yang bisa dibaca
// manusia dalam 6 bahasa (id/en/jv/ar/zh/ru). Tidak menyentuh UI: modul ini
// hanya menghasilkan string untuk log backend / CLI / API response.

import { getTextDirection, translateEngine, type SupportedLocale } from './engine-i18n.ts';

export interface ExecutionLogEntry {
	node: string;
	type: string;
	inputCount: number;
	outputCount: number;
	durationMs: number;
	status: 'success' | 'error';
	error?: string;
	label?: string;
	message?: string;
}

export interface EngineRunResult {
	status: string;
	finished: boolean;
	locale: SupportedLocale;
	executionLog: ExecutionLogEntry[];
	error?: { message: string };
}

export interface RunReport {
	locale: SupportedLocale;
	direction: 'ltr' | 'rtl';
	status: string;
	headline: string;
	lines: string[];
	text: string;
}

/**
 * Render laporan eksekusi yang terlokalisasi.
 * `durationMs` opsional: bila tidak diberikan, baris ringkasan memakai total
 * durasi per node dari executionLog.
 */
export function renderRunReport(result: EngineRunResult, durationMs?: number): RunReport {
	const locale = result.locale;
	const direction = getTextDirection(locale);
	const totalDuration =
		durationMs ??
		result.executionLog.reduce((sum, entry) => sum + (entry.durationMs || 0), 0);

	const stoppedEntry = result.executionLog.find((entry) => entry.status === 'error');
	const headline =
		result.finished && result.status === 'COMPLETED'
			? translateEngine(
					'engine.run.completed',
					{ nodes: result.executionLog.length, durationMs: totalDuration },
					locale,
				)
			: translateEngine('engine.run.stopped', { node: stoppedEntry?.node ?? '-' }, locale);

	const lines = result.executionLog.map((entry) => {
		const marker = entry.status === 'error' ? '[x]' : '[ok]';
		const detail = `${entry.inputCount} -> ${entry.outputCount} item, ${entry.durationMs} ms`;
		const message =
			entry.message ??
			translateEngine(
				entry.status === 'error' ? 'engine.node.error' : 'engine.node.success',
				{ node: entry.node, error: entry.error ?? '' },
				locale,
			);
		return `${marker} ${message} (${detail})`;
	});

	return {
		locale,
		direction,
		status: result.status,
		headline,
		lines,
		text: [headline, ...lines].join('\n'),
	};
}
