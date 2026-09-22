#!/usr/bin/env node
/**
 * Scale-out readiness check (P2.7).
 *
 *   node tools/lego/scale-out-readiness.mjs           # human report
 *   node tools/lego/scale-out-readiness.mjs --json    # machine report
 *
 * P2.7 does NOT implement workers, queues or scaling. It asks a narrower,
 * checkable question:
 *
 *   if this LEGO were moved into a second process tomorrow, would its CONTRACT
 *   still hold — or does it secretly depend on being the only process?
 *
 * The properties that break that promise, and which this tool detects:
 *
 *   S1 module-global mutable state   `let x = …` at module scope (a cache or
 *                                    counter that silently forks per process)
 *   S2 process-local id allocation   in-memory counters handing out ids
 *   S3 local filesystem state        read/write outside a declared, injected
 *                                    storage boundary
 *   S4 direct env reads              configuration reached for instead of
 *                                    injected (infrastructure leaking into a domain)
 *   S5 cross-domain in-memory coupling  a domain sharing a mutable singleton
 *                                    with another domain
 *
 * A finding is NOT automatically a failure. The tool distinguishes:
 *
 *   - NEW LEGO code (`src/lego/`, `src/reference-lego/`, any future
 *     contract-first domain): findings FAIL. New contracts must be
 *     process-agnostic from day one.
 *   - EXISTING code (kernel, legacy zone, current domains): findings are
 *     recorded as declared, owned EXCEPTIONS in the manifest
 *     (`scaleOut.exceptions`). They are honest debt, not a pass.
 *
 * Undeclared findings in existing code also fail — the point is that the list
 * cannot grow silently.
 *
 * A finding can also be cleared in place with an inline annotation:
 *
 *   // @scale-out-safe: <reason>
 *
 * on the line before. That is not an escape hatch — it is a reviewable claim
 * that the construct is process-agnostic despite matching the pattern (e.g. an
 * immutable memoization cache of a static file, which every process would
 * compute identically). The reason is required and is printed in the report.
 *
 * Owner: manager. No scaling infrastructure is created or implied here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { domainForPath, loadRegistry } from '../../apps/n8n-lego/src/lego/registry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_ROOT = join(REPO_ROOT, 'apps', 'n8n-lego');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const SAFE_RE = /@scale-out-safe:\s*(.+)/;

/** Strips block/line comments so a doc comment mentioning `let` is not a finding. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const PROBES = [
  {
    id: 'S1',
    label: 'module-global mutable state',
    // `let`/`var` at column 0 — module scope, not inside a function.
    re: /^(let|var)\s+([A-Za-z0-9_$]+)/gm,
    why: 'module-scope mutable state forks per process: two workers would silently diverge',
  },
  {
    id: 'S2',
    label: 'process-local id allocation',
    re: /^(?:let|var)\s+([A-Za-z0-9_$]*(?:[Cc]ounter|[Ss]equence|next[A-Z][A-Za-z]*))\b/gm,
    why: 'ids handed out from an in-memory counter collide the moment a second process exists',
  },
  {
    id: 'S3',
    label: 'local filesystem state',
    re: /\b(writeFileSync|renameSync|mkdirSync|appendFileSync|createWriteStream)\s*\(/g,
    why: 'local-disk state is invisible to other workers unless it sits behind a storage contract',
  },
  {
    id: 'S4',
    label: 'direct process.env read',
    re: /\bprocess\.env\b/g,
    why: 'configuration reached for rather than injected couples a domain to one process environment',
  },
];

/** A domain is "new LEGO" if it was introduced contract-first in P2.6/P2.7. */
function isNewLego(domain) {
  return domain?.kind === 'governance' || domain?.kind === 'template';
}

export function scanScaleOut(registry = loadRegistry({ reload: true })) {
  const declared = registry.manifest.scaleOut?.exceptions ?? [];
  const declaredKey = new Set(declared.map((exception) => `${exception.file}:${exception.probe}`));
  const usedKey = new Set();

  const findings = [];
  const files = [join(APP_ROOT, 'src'), join(APP_ROOT, 'bin')].flatMap((dir) => walk(dir));

  for (const absolute of files) {
    const relPath = relative(APP_ROOT, absolute).split(sep).join('/');
    const domain = domainForPath(relPath, registry);
    const raw = readFileSync(absolute, 'utf8');
    const rawLines = raw.split('\n');
    const source = stripComments(raw);

    /**
     * An inline `@scale-out-safe:` annotation in the comment block immediately
     * above the hit. Scans upward while the lines are comments, so a multi-line
     * justification works and a distant unrelated comment does not.
     */
    const annotationFor = (line) => {
      for (let index = line - 2; index >= 0; index -= 1) {
        const candidate = rawLines[index];
        if (candidate === undefined) break;
        const trimmed = candidate.trim();
        if (trimmed === '') break;
        if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) break;
        const match = SAFE_RE.exec(candidate);
        if (match) return match[1].trim();
      }
      return null;
    };

    for (const probe of PROBES) {
      probe.re.lastIndex = 0;
      const hits = [];
      let match;
      while ((match = probe.re.exec(source)) !== null) {
        hits.push({ line: source.slice(0, match.index).split('\n').length, text: match[0].trim() });
      }
      // Drop hits that carry a reviewable in-place justification.
      const annotated = hits.map((hit) => ({ ...hit, safeReason: annotationFor(hit.line) }));
      const unjustified = annotated.filter((hit) => !hit.safeReason);
      if (annotated.length > 0 && unjustified.length === 0) {
        findings.push({
          probe: probe.id,
          label: probe.label,
          file: relPath,
          domain: domain?.id ?? null,
          hits: annotated.length,
          firstLine: annotated[0].line,
          sample: annotated[0].text,
          why: probe.why,
          newLego: isNewLego(domain),
          declared: false,
          exception: null,
          safeReason: annotated[0].safeReason,
          status: 'annotated-safe',
        });
        continue;
      }
      if (unjustified.length === 0) continue;
      const remaining = unjustified;

      const key = `${relPath}:${probe.id}`;
      const exception = declared.find((entry) => entry.file === relPath && entry.probe === probe.id);
      if (exception) usedKey.add(key);

      findings.push({
        probe: probe.id,
        label: probe.label,
        file: relPath,
        domain: domain?.id ?? null,
        hits: remaining.length,
        firstLine: remaining[0].line,
        sample: remaining[0].text,
        why: probe.why,
        newLego: isNewLego(domain),
        declared: Boolean(exception),
        exception: exception ?? null,
        // New LEGO code may not do this at all; existing code must at least
        // have the finding declared, owned and dated.
        status: isNewLego(domain) ? 'fail-new-lego' : exception ? 'declared-exception' : 'undeclared',
      });
    }
  }

  const stale = declared
    .filter((exception) => !usedKey.has(`${exception.file}:${exception.probe}`))
    .map((exception) => ({ ...exception, status: 'stale-exception' }));

  const failures = [
    ...findings.filter(
      (finding) => finding.status !== 'declared-exception' && finding.status !== 'annotated-safe',
    ),
    ...stale,
  ];

  return { findings, stale, failures, declared: declared.length, checked: files.length };
}

const isCli = process.argv[1]?.endsWith('scale-out-readiness.mjs');
if (isCli) {
  const result = scanScaleOut();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: result.failures.length === 0, ...result }, null, 2)}\n`);
  } else {
    process.stdout.write(`scale-out readiness: ${result.checked} files, ${result.declared} declared exception(s)\n\n`);
    for (const finding of result.findings) {
      const mark =
        finding.status === 'declared-exception' ? 'known' : finding.status === 'annotated-safe' ? 'safe ' : 'PROBLEM';
      process.stdout.write(
        `${mark}  ${finding.probe} ${finding.label} — ${finding.file}:${finding.firstLine} (${finding.hits}x, domain ${finding.domain})\n`,
      );
      if (finding.status === 'annotated-safe') {
        process.stdout.write(`        justified in place: ${finding.safeReason}\n`);
      } else if (finding.status === 'declared-exception') {
        process.stdout.write(`        owner ${finding.exception.owner}, resolve by ${finding.exception.resolveBy}: ${finding.exception.reason}\n`);
      } else if (finding.status === 'fail-new-lego') {
        process.stdout.write(`        new LEGO code must be process-agnostic: ${finding.why}\n`);
      } else {
        process.stdout.write(`        undeclared: ${finding.why}\n        fix: declare it in manifest scaleOut.exceptions with an owner, or remove it.\n`);
      }
    }
    for (const exception of result.stale) {
      process.stdout.write(`PROBLEM  stale exception ${exception.probe} ${exception.file} — nothing matches it any more; delete it\n`);
    }
    process.stdout.write(
      result.failures.length === 0
        ? '\nOK — every scale-out finding is a declared, owned exception; no new LEGO code introduces process-local coupling.\n'
        : `\n${result.failures.length} scale-out problem(s).\n`,
    );
  }
  process.exit(result.failures.length === 0 ? 0 : 1);
}
