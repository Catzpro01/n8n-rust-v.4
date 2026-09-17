# Persistence LEGO — Phase 3

Storage-engine-independent JavaScript reconstruction of n8n 2.9.4 persistence semantics.

## Included

- flatted-compatible execution-data serialization, including shared/circular references and corrupt-data errors;
- workflow create/update/history/version/publish/archive lifecycle;
- execution create, status transitions, guarded updates, recovery, soft delete, and hard delete;
- workflow snapshots without pin data;
- static-data save rules and key/value settings;
- injectable repositories suitable as ports for SQLite/PostgreSQL adapters.

```bash
npm --prefix packages/persistence-lego test
node tools/persistence-lego-gate.mjs
```

The included repositories are deterministic in-memory implementations of the formal boundary. SQL drivers, migrations, permission joins, pruning timers, and filesystem execution storage remain infrastructure adapters and are not duplicated here.
