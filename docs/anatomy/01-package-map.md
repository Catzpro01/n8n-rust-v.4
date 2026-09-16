# 01 - Package Map: Monorepo Structure

Based on n8n official source packages:

| Package Name | Primary Role | Runtime Scope | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `n8n-workflow` | Workflow DAG engine, expression resolution, interfaces | Core / Shared | None (zero heavy runtime deps) |
| `n8n-core` | Direct node execution, active executions, credentials | Backend Core | `n8n-workflow`, `axios`, `dotenv` |
| `n8n-nodes-base` | Library of standard community & native integration nodes | Node Modules | `n8n-workflow` |
| `@n8n/task-runner` | Isolated execution sandbox for Python / JS tasks | Process Isolation | `@opentelemetry/api`, `msgpackr` |
| `@n8n/db` | Database entities, migrations, and TypeORM adapters | Persistence | `typeorm`, `pg`, `sqlite3` |
| `@n8n/config` | Environmental variable validation and config schemas | Global | `zod`, `dotenv` |
| `n8n (cli)` | Server entrypoint, Express HTTP server, CLI dispatch | Application | All packages |
