/**
 * Scheduler LEGO — `randomInt`.
 *
 * 1:1 port of `packages/workflow/src/utils.ts:337-343` (n8n 2.9.4).
 *
 * FROZEN QUIRK (S-01): the value is
 *   `min + (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min))`
 * — a raw modulo of a 32-bit draw, so the distribution carries a **modulo
 * bias** whenever `(max - min)` does not divide 2^32. For the range this LEGO
 * uses (0..60) the bias is ~1e-8 and is not observable, but it is part of the
 * contract: `randomInt` is NOT rejection-sampled and must not be "fixed".
 *
 * FROZEN QUIRK (S-02): single-argument form `randomInt(n)` means `0..n-1`,
 * NOT `1..n` — the argument becomes the EXCLUSIVE upper bound.
 */
export function randomInt(min, max) {
	if (max === undefined) {
		max = min;
		min = 0;
	}
	return min + (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min));
}
