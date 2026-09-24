// tools/certification/src/schema.mjs — Deliverable B: benchmark result schema.
//
// Machine-readable JSON schema, versioned, with deterministic serialization.
// Missing metrics stay explicit (`null`), never silently zero.

import { SCHEMA_VERSION, TOOL_NAME, TOOL_VERSION } from './version.mjs';
import { canonicalJSON } from './util.mjs';

export const OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  TIMEOUT: 'TIMEOUT',
  COMMAND_REJECTED: 'COMMAND_REJECTED',
  CAPTURE_LIMIT: 'CAPTURE_LIMIT',
});

const STRING_KEYS = Object.freeze([
  'runId',
  'commit',
  'command',
  'note',
  'startedAt',
  'completedAt',
]);

/**
 * Schema document (self-describing). Kept as data so a future consumer,
 * including the reproducibility checker, can validate `SCHEMA_VERSION`.
 */
export const RESULT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'p21-certification Benchmark Result',
  type: 'object',
  required: [
    'schemaVersion',
    'tool',
    'runId',
    'timestamp',
    'environment',
    'command',
    'measurement',
    'outcome',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: SCHEMA_VERSION },
    tool: {
      type: 'object',
      required: ['name', 'version'],
      properties: {
        name: { type: 'string', const: TOOL_NAME },
        version: { type: 'string', const: TOOL_VERSION },
      },
    },
    runId: { type: 'string', minLength: 1 },
    timestamp: { type: 'integer' },
    startedAt: { type: 'string' },
    completedAt: { type: 'string' },
    commit: { type: ['string', 'null'] },
    command: { type: 'string', minLength: 1 },
    note: { type: ['string', 'null'] },
    commandMeta: { type: 'object' },
    environment: { $ref: '#/definitions/environmentFingerprint' },
    measurement: { $ref: '#/definitions/measurement' },
    diagnostics: { type: 'object' },
    outcome: { type: 'string', enum: Object.values(OUTCOME) },
  },
  definitions: {
    environmentFingerprint: {
      type: 'object',
      required: ['os', 'arch', 'node', 'cpu', 'commit', 'tool'],
      additionalProperties: false,
      properties: {
        os: { type: 'string', minLength: 1 },
        platform: { type: 'string' },
        arch: { type: 'string', minLength: 1 },
        cpu: {
          type: 'object',
          required: ['modules'],
          properties: { modules: { type: 'integer' } },
        },
        node: { type: ['string', 'null'] },
        rust: { type: ['string', 'null'] },
        tool: {
          type: 'object',
          required: ['name', 'version'],
          properties: { name: { type: 'string' }, version: { type: 'string' } },
        },
        commit: { type: ['string', 'null'] },
        commandMeta: { type: 'object' },
        capturedAt: { type: 'integer' },
      },
    },
    metric: {
      type: 'object',
      required: ['unit', 'values', 'samples'],
      additionalProperties: false,
      properties: {
        unit: { type: 'string' },
        values: { type: 'array', items: { type: 'number' } },
        samples: { type: 'integer' },
        p50: { type: ['number', 'null'] },
        p95: { type: ['number', 'null'] },
        p99: { type: ['number', 'null'] },
      },
    },
    measurement: {
      type: 'object',
      required: ['warmupRuns', 'measurementRuns'],
      additionalProperties: false,
      properties: {
        warmupRuns: { type: 'integer' },
        measurementRuns: { type: 'integer' },
        duration: { $ref: '#/definitions/metric' },
        exitCode: { type: 'integer' },
        exitCodeOfLastRun: { type: 'integer' },
        failedRuns: { type: 'integer' },
        successRuns: { type: 'integer' },
        stdoutBytes: { type: 'integer' },
        stderrBytes: { type: 'integer' },
      },
    },
  },
});

/** Validate a parsed result object. Returns { ok, errors }. */
export function validateResult(result) {
  const errors = [];
  const push = (msg) => errors.push(msg);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (!isObj(result)) {
    return { ok: false, errors: ['result is not an object'] };
  }

  // schemaVersion must be exact.
  if (result.schemaVersion !== SCHEMA_VERSION) {
    push(`schemaVersion mismatch: got ${JSON.stringify(result.schemaVersion)}, expected ${SCHEMA_VERSION}`);
  }

  // tool identity must be exact.
  if (!isObj(result.tool) || result.tool.name !== TOOL_NAME || result.tool.version !== TOOL_VERSION) {
    push('tool must be exactly {name: "p21-certification", version: "0.1.0"}');
  }

  const NULLABLE_STRING_KEYS = Object.freeze(['commit', 'note']);
  for (const key of STRING_KEYS) {
    if (result[key] === undefined) continue;
    if (result[key] === null && NULLABLE_STRING_KEYS.includes(key)) continue;
    if (typeof result[key] !== 'string') {
      push(`expected ${key} to be a string, got ${result[key] === null ? 'null' : typeof result[key]}`);
    }
  }

  if (typeof result.runId !== 'string' || result.runId.length === 0) push('runId must be a non-empty string');
  if (typeof result.timestamp !== 'number') push('timestamp must be a number');
  if (typeof result.command !== 'string' || result.command.length === 0) push('command must be a non-empty string');
  if (!Object.values(OUTCOME).includes(result.outcome)) push(`outcome must be one of ${Object.values(OUTCOME).join(', ')}`);

  if (!isObj(result.environment)) {
    push('environment is required');
  } else {
    const env = result.environment;
    if (typeof env.os !== 'string' || env.os.length === 0) push('environment.os must be a non-empty string');
    if (typeof env.arch !== 'string' || env.arch.length === 0) push('environment.arch must be a non-empty string');
    if (!isObj(env.cpu) || typeof env.cpu.modules !== 'number') push('environment.cpu.modules must be a number');
    if (!isObj(env.tool) || typeof env.tool.name !== 'string' || typeof env.tool.version !== 'string') {
      push('environment.tool must be {name, version}');
    }
    if (typeof env.node !== 'string' && env.node !== null) push('environment.node must be a string or null');
  }

  const meas = result.measurement;
  if (!isObj(meas)) {
    push('measurement is required');
  } else {
    for (const key of ['warmupRuns', 'measurementRuns', 'exitCode', 'exitCodeOfLastRun', 'failedRuns', 'successRuns', 'stdoutBytes', 'stderrBytes']) {
      if (typeof meas[key] !== 'number') push(`measurement.${key} must be a number`);
    }
    if (meas.measurementRuns <= 0) push('measurementRuns must be > 0');

    const dur = meas.duration;
    if (!isObj(dur)) {
      push('measurement.duration is required');
    } else {
      const v = dur.values;
      if (!Array.isArray(v) || v.length !== dur.samples) {
        push('duration.values array length must equal duration.samples');
      }
      if (v && v.length > 0) {
        if (v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
          push('duration.values must contain only finite numbers');
        }
        for (const p of ['p50', 'p95', 'p99']) {
          if (typeof dur[p] !== 'number' || !Number.isFinite(dur[p])) {
            push(`duration.${p} must be a finite number when samples exist`);
          }
        }
      } else {
        for (const p of ['p50', 'p95', 'p99']) {
          if (dur[p] !== null && dur[p] !== undefined && typeof dur[p] !== 'number') {
            push(`duration.${p} must be null (or absent) when there are no samples`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Deterministic serialization of a result bundle. */
export function serializeResult(result) {
  return canonicalJSON(result, 2) + '\n';
}
