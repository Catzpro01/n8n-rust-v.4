# TASK SPECIFICATION: data-plane/m3-binary-stream

- **TASK_ID**: ea6f65fd-ada7-4832-b3f0-723a16c70f1d
- **WORKER_ID**: arena-agent-03-dataplane
- **BRANCH**: data-plane/m3-m3-binary-stream
- **BASE_COMMIT**: 7fdc225bce06d58de9d86c2ff1ef393bb4393ad1
- **LEASE_EXPIRES_AT**: 2026-09-20T12:00:00Z

## ALLOWED_FILES
- crates/n8n-execution-data/src/binary.rs

## ACCEPTANCE_CRITERIA
- Streams >50MB files in fixed 64KB chunks
- RAM consumption stays below 5MB during 100MB streaming

## REQUIRED_TESTS
- cargo test -p n8n-workflow
