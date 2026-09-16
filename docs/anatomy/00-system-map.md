# 00 - System Map: High-Level Architecture of n8n

## 1. Core Subsystems Overview
n8n is an event-driven workflow automation engine composed of several decoupled layers:
1. **Presentation / Editor Layer**: Vue.js SPA communicating via REST API and WebSockets/SSE (`/rest/push`).
2. **Workflow Definition & Validation Layer** (`n8n-workflow`): Graph data structure, topological sorting, acyclic validation, expression parsing.
3. **Execution Runtime Layer** (`n8n-core`): Execution orchestrator, node runner, execution data pipelines (`INodeExecutionData`), variable scoping (`$json`, `$binary`, `$node`).
4. **Trigger & Scheduling Subsystem**: Cron-based scheduler, persistent Webhook listener, polling triggers.
5. **Scale & Queue Subsystem**: BullMQ + Redis for distributed worker scaling (`n8n worker`).
6. **Persistence & State Layer**: TypeORM (PostgreSQL / SQLite) managing Workflows, Executions, Credentials, and Users.

## 2. Global Execution Flow
```text
[ Trigger Event (Webhook / Cron / Manual) ]
                    │
                    ▼
          [ Workflow Activation ]
                    │
                    ▼
     [ DAG Resolution & Topological Sort ]
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
  [ Single Execution ]   [ Queue Worker (Redis) ]
         │                     │
         └──────────┬──────────┘
                    ▼
     [ Node Loop: Data Transformation ]
         ├── Expression Evaluation (JMESPath/JS Sandbox)
         ├── I/O Operations (HTTP/Database)
         └── Node Execution Data Emitted
                    │
                    ▼
     [ Execution History Persisted ]
                    │
                    ▼
   [ Real-time UI Event Emitted (SSE/WS) ]
```
