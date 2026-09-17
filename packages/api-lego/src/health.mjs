/**
 * Health endpoints, per `contracts/api.contract.md` §3 and
 * `packages/cli/src/controllers/health.controller.ts` (n8n 2.9.4).
 *
 * H-01  `/healthz` is unconditional — the process is up, so it answers
 *       `200 {status: 'ok'}`; it never depends on the database.
 * H-02  `/healthz/readiness` reflects the database: `200 {status: 'ok'}` only
 *       when the DB is connected **and** migrated, otherwise
 *       `503 {status: 'error'}`.
 * H-03  Neither payload is wrapped in the `{ data }` envelope — the health
 *       handlers write their own response, which is why `send()` checks
 *       `res.headersSent` (A-09).
 */

export function healthz() {
	return { httpStatus: 200, body: { status: 'ok' } }; // H-01
}

export function readiness({ connected = false, migrated = false } = {}) {
	const ok = connected && migrated; // H-02
	return ok
		? { httpStatus: 200, body: { status: 'ok' } }
		: { httpStatus: 503, body: { status: 'error' } };
}
