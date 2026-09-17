/**
 * Reconstructed engine — failure policy ported 1:1 from n8n 2.9.4.
 *
 * Every rule below was read off the reference sources (read-only), including the
 * ones that look surprising — those are reproduced on purpose and flagged in
 * ERROR-POLICY.md, following the project's D-08/D-04 precedent.
 *
 * Reference map (n8n 2.9.4):
 *   R1 retry budget .... workflow-execute.ts:1600-1613 (clamps, defaults)
 *   R2 pre-retry wait .. workflow-execute.ts:1615-1630 (wait before tries 2..N, error reset)
 *   R3 soft-fail re-run  workflow-execute.ts:1670-1690 (`json.error` on first item re-runs)
 *   R4 thrown-error task  workflow-execute.ts:1781-1826 (report, `{...e, message, stack}`, taskData)
 *   R5 continue vs stop . workflow-execute.ts:1843-1900 (passthrough input / break)
 *   R6 merge loop ....... workflow-execute.ts:1902-1917 (`$error`/`error` -> `json={error}`)
 *   R7 error-output split workflow-execute.ts:1720 + :2463-2560 (handleNodeErrorOutput)
 *   R8 error output ..... node-helpers.ts:1170 (extra `Main` output, category `error`, appended last)
 *   R9 OnError type ..... workflow/src/interfaces.ts:1296
 *   R10 per-item convert  nodes-base/nodes/Code/Code.node.ts:246-293 (continueOnFail -> `{error}` items)
 */

export const CONTINUE_MODES = ['continueRegularOutput', 'continueErrorOutput'];

/**
 * R1 — retry budget for one node execution.
 * Literal port, including the `||` default semantics (`0`/`undefined` -> default).
 */
export function retryPlanFor(node) {
  let maxTries = 1;
  if (node.retryOnFail === true) {
    // TODO upstream: hardcoded defaults also live in NodeSettings.vue
    maxTries = Math.min(5, Math.max(2, node.maxTries || 3));
  }
  let waitBetweenTries = 0;
  if (node.retryOnFail === true) {
    waitBetweenTries = Math.min(5000, Math.max(0, node.waitBetweenTries || 1000));
  }
  return { maxTries, waitBetweenTries };
}

/**
 * R5 — may the workflow continue after this node failed?
 * `executionData.node.continueOnFail === true || onError in CONTINUE_MODES`.
 * Also exposed to node implementations as `context.continueOnFail()`
 * (base-execute-context.ts:87-94); the engine's check is the same expression.
 */
export function shouldContinueOnError(node) {
  return node.continueOnFail === true || CONTINUE_MODES.includes(node.onError || '');
}

/**
 * R3 — soft-failure signal: the handler returned instead of throwing, but the
 * first item of the first branch carries `json.error`.
 * Literal: `runNodeData.data?.[0]?.[0]?.json?.error !== undefined`
 * (`null` counts — only `undefined` passes).
 */
export function isSoftFailure(outputs) {
  return outputs?.[0]?.[0]?.json?.error !== undefined;
}

/**
 * R4 — error record stored on the task and returned to the caller.
 * Reference: `{ ...e, message: e.message, stack: e.stack }`.
 */
export function toErrorRecord(error) {
  if (error && typeof error === 'object') {
    return { ...error, name: error.name ?? 'Error', message: error.message ?? String(error), stack: error.stack };
  }
  return { name: 'Error', message: String(error), stack: undefined };
}

/**
 * R6 — merge error information into the default output (mutates a clone).
 * For each item: `{json: {$error, $json}}` -> `error=$error, json={error: message}`;
 * else if `item.error` is set -> `json={error: error.message}`.
 * The reference mutates in place; we clone first — same observable result.
 */
export function mergeErrorInfo(outputs) {
  return (outputs ?? []).map((branch) =>
    (branch ?? []).map((item) => {
      const next = { ...item, json: { ...item.json } };
      if (next.json !== undefined && next.json.$error !== undefined && next.json.$json !== undefined) {
        next.error = next.json.$error;
        next.json = { error: next.json.$error?.message };
      } else if (next.error !== undefined) {
        const message = next.error?.message ?? String(next.error);
        next.json = { error: message };
      }
      return next;
    }),
  );
}

function isErrorItem(item) {
  if (item.error) return item.error;
  const keys = Object.keys(item.json ?? {});
  if (item.json?.error !== undefined && keys.length === 1) return item.json.error;
  if (item.json?.error !== undefined && item.json?.message !== undefined && keys.length === 2) {
    return item.json.error;
  }
  return undefined;
}

/**
 * R7 — success-path error-output split (handleNodeErrorOutput).
 *
 * Items signalling an error (R7 signals: `item.error`, or `json={error}` as the
 * sole key, or `json={error, message}` as the only two keys) move to the LAST
 * main output; every other item stays on its branch. Moved items merge over
 * their paired input item: `{...pairedInput.json, ...item.json}`.
 *
 * Adaptations (documented, behavior-preserving for single-input flows):
 *   * error-branch index: the reference uses the declared output count from
 *     `getNodeOutputs()` (R8 appends the error output last, so the count is
 *     always >= 2 here). We have no node-type registry yet, so we use
 *     `max(wiredMainOutputs, returnedBranches, 2) - 1`. This is exact whenever
 *     the error branch is wired (the editor writes it last) and whenever a
 *     single-output node is used. Known limit: a multi-output node whose error
 *     branch is NOT wired resolves one index too low — flagged in
 *     ERROR-POLICY.md, resolvable once declared outputs exist (Node LEGO).
 *   * the last branch is REPLACED by the collected error items, even if the
 *     handler returned data there — literal R7 (`nodeSuccessData[last] =
 *     errorItems`; handlers must not write to the error output directly).
 *   * paired lookup: the reference resolves via WorkflowDataProxy `$getPairedItem`
 *     across runs/inputs; we resolve `pairedItem.item` against this node's input
 *     (single input, current run). Items without a resolvable pair move unmerged —
 *     same fallback the reference uses when the proxy returns null.
 */
export function splitErrorOutput(successData, inputData, wiredMainOutputs = 1) {
  const branches = (successData ?? []).map((branch) => [...(branch ?? [])]);
  const lastIndex = Math.max(wiredMainOutputs, branches.length, 2) - 1;
  const errorItems = [];
  for (let outputIndex = 0; outputIndex < lastIndex; outputIndex++) {
    const kept = [];
    for (const item of branches[outputIndex] ?? []) {
      if (isErrorItem(item) === undefined) {
        kept.push(item);
        continue;
      }
      const paired = Array.isArray(item.pairedItem) ? item.pairedItem[0] : item.pairedItem;
      const pairedInput = typeof paired?.item === 'number' ? inputData?.[paired.item] : undefined;
      errorItems.push(
        pairedInput ? { ...item, json: { ...pairedInput.json, ...item.json } } : { ...item },
      );
    }
    branches[outputIndex] = kept;
  }
  branches[lastIndex] = errorItems;
  return branches;
}

/**
 * Default sleeper (R2 uses a setTimeout promise; injectable for tests).
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
