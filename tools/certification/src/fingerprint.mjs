// tools/certification/src/fingerprint.mjs — Deliverable A: deterministic
// environment fingerprint.
//
// Only whitelisted, non-sensitive facts are recorded. Paths are never
// recorded; environment variable values are never recorded; hostname and
// home directory are never recorded. Any free-form captured string passes
// through `redact()` first as defence-in-depth.

import { spawnSync } from 'node:child_process';
import os from 'node:os';

import { redact } from './redact.mjs';
import { TOOL_NAME, TOOL_VERSION } from './version.mjs';
import { truncate } from './util.mjs';

const MAX_TEXT = 200; // safety cap on every free-form string we accept

const DROP_WORDS = Object.freeze([
  'password',
  'secret',
  'token',
  'authorization',
  'bearer',
  'api_key',
  'credential',
  'cookie',
]);

/**
 * Normalized command metadata: array of argv entries, each normalized
 * (strip leading dashes), lower-cased, secret-scanned and length-capped.
 * Entries that still look secret-shaped are dropped rather than redacted.
 */
export function normalizeCommandMeta(argv) {
  const parts = [];
  for (const raw of argv) {
    const cleaned = redact(truncate(String(raw), MAX_TEXT, ''));
    if (!cleaned) continue;
    const norm = cleaned.replace(/^-+/, '').toLowerCase();
    if (wantsDrop(cleaned)) continue;
    parts.push(norm);
  }
  // Deterministic and bounded.
  return parts.slice(0, 32).sort();
}

function wantsDrop(s) {
  const lower = s.toLowerCase();
  return DROP_WORDS.some((k) => lower.includes(k));
}

/**
 * Detect a tool version by executing `[prog, versionFlag]` with a 2s timeout.
 * Returns the first non-empty output line, or null when unavailable.
 * Never throws; never records anything but that output line.
 */
export function probeVersion(prog, versionFlag = '--version') {
  try {
    const res = spawnSync(prog, [versionFlag], {
      timeout: 2000,
      encoding: 'utf8',
      env: {}, // deliberately no inherited environment
      shell: false,
    });
    const out = (res.stdout || res.stderr || '').trim().split('\n')[0];
    if (!out) return null;
    return truncate(out, MAX_TEXT);
  } catch {
    return null;
  }
}

/**
 * Produce a fingerprint for a repository directory using git (spawned with a
 * clean environment). `repoDir` is only used to run `git rev-parse`; the path
 * itself is NOT stored.
 */
export function fingerprintForRepo(repoDir, options = {}) {
  const { argv = process.argv.slice(2), capturedAt = Date.now() } = options;
  let commit = null;
  try {
    const res = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoDir,
      timeout: 3000,
      encoding: 'utf8',
      shell: false,
    });
    const out = (res.stdout || '').trim();
    if (out && !res.status) commit = truncate(out, MAX_TEXT);
  } catch {
    commit = null;
  }
  return capture({ argv, commit, capturedAt });
}

function capture({ repoDir = null, argv, commit, capturedAt, nodeVersion = process.version }) {
  void repoDir;

  const cpuModules = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (os.cpus() ? os.cpus().length : 0);

  const rust = probeVersion('rustc');
  const tool = probeVersion('node');

  return {
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    arch: os.arch(),
    cpu: { modules: cpuModules },
    node: nodeVersion ? redact(truncate(String(nodeVersion), MAX_TEXT)) : null,
    rust: rust !== null ? redact(rust) : null,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    commit: commit,
    commandMeta: normalizeCommandMeta(argv),
    capturedAt,
  };
}
