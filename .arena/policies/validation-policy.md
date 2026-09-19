# Build, Test & Audit Validation Policy

## 1. Execution Machine
All compilation, testing, and auditing is performed on the dedicated Laptop Build Worker.
VPS is DISABLED / NOT INVOLVED.

## 2. Validation Levels
- LEVEL 0: Formatting and Workspace Check (`cargo fmt --check`, `cargo check --workspace`).
- LEVEL 1: Affected Crate Tests (`cargo test -p <crate>`).
- LEVEL 2: Full Workspace & Integration Tests (`cargo test --workspace`, `node --test`).
- LEVEL 3: Release Build, Benchmarks & Memory Budgets (`cargo build --workspace --release`).

## 3. Commit SHA Association
Build, test, and audit results belong strictly to a specific `commit_sha`.
Pushing a new commit automatically invalidates previous validation results.
Merge authorization requires PASS across Build, Test, and Audit for the EXACT current commit SHA.