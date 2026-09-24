# p21-certification — P21 Certification Tooling (Agent 2, Issue #243)

Standalone, dependency-free (Node stdlib only) tooling for benchmark,
reproducibility and evidence. It measures; it does **not** modify source,
does **not** add runtime behavior, and does **not** add production
dependencies.

Parent: Issue #237 (P21 Operational Resilience, Performance Certification &
Fault Engineering). Scope: this slice only (`tools/certification/**`).

## Guarantees

- **Deterministic** — canonical (sorted-key) JSON, monotonic run ids (no
  random), no inherited environment in measurement runs.
- **Honest** — non-zero exit is failure; timeout is failure; missing metrics
  are explicit (`null` / "Missing"), never zero; failures are never
  rewritten into success.
- **Secret-safe** — fingerprint and output summaries are redacted; secret
  shaped fragments are detected and never persisted.
- **Bounded** — per-run timeout, stdout/stderr byte+line caps, run-count
  caps, file-size cap (4 MiB), sorted+length-capped command metadata.
- **Isolated** — everything lives under `tools/certification/**`; no import
  of the frontend, security, workflow runtime, scheduler, worker or storage.

## Commands

```bash
# environment fingerprint (no secrets, no paths)
node tools/certification/src/cli.mjs fingerprint [--repo-dir .]

# benchmark a command (explicit command, bounded)
node tools/certification/src/cli.mjs run --command "node -e '1+1'" \
    --warmup 1 --measure 5 --timeout 30000 result.json

# schema-validate result bundles
node tools/certification/src/cli.mjs validate result.json

# reproducibility compare (verdict from comparator)
node tools/certification/src/cli.mjs compare baseline.json candidate.json

# deterministic report (text + optional JSON)
node tools/certification/src/cli.mjs report baseline.json candidate.json report.json

# offline self-test suite (no network)
node tools/certification/src/cli.mjs self-test
```

Module surface (ESM):
- `src/version.mjs` — tool/schema identity (single source of truth)
- `src/util.mjs` — canonical JSON, percentile, truncate
- `src/redact.mjs` — secret-shape detection + redaction
- `src/fingerprint.mjs` — Deliverable A (environment fingerprint)
- `src/schema.mjs` — Deliverable B (JSON schema + validator)
- `src/runner.mjs` — Deliverable C (bounded benchmark runner)
- `src/comparator.mjs` — Deliverable D (reproducibility checker)
- `src/report.mjs` — Deliverable E (report generator)
- `src/fileio.mjs` — bounded JSON read/write
- `src/cli.mjs` — CLI entry point
- `src/selftest.mjs` — Deliverable F (offline self tests)

## Result bundle (schema v1)

```json
{
  "schemaVersion": "cert-result@1.0.0",
  "tool": { "name": "p21-certification", "version": "0.1.0" },
  "runId": "run-...",
  "timestamp": 1700000000000,
  "commit": "abc1234",
  "command": "node -e '1+1'",
  "environment": { "..." },
  "measurement": {
    "duration": { "unit": "ms", "values": [...], "samples": 5, "p50": 10, "p95": 10, "p99": 10 }
  },
  "outcome": "SUCCESS"
}
```

Outcomes: `SUCCESS | FAILURE | TIMEOUT | COMMAND_REJECTED | CAPTURE_LIMIT`.

Reproducibility verdicts:
`REPRODUCIBLE | DRIFTED_ENVIRONMENT | DRIFTED_COMMAND | DRIFTED_COMMIT |
DRIFTED_TOOL | INCOMPLETE_EVIDENCE | INCOMPARABLE`.

## Self-test checklist coverage (Issue #243 §6)

valid result, malformed result, missing metric, zero sample, timeout,
non-zero exit, deterministic normalization, environment drift, commit drift,
command drift, incompatible schema, secret-shaped output, reproducible
pair, non-reproducible pair.
