# 12 - Persistence & Database Schema Anatomy

## 1. Key Database Entities
- `workflow_entity`: Definition, name, active state, nodes JSON, connections JSON, settings.
- `execution_entity`: Status, started_at, stopped_at, retry_of, workflow_id.
- `execution_data`: Persisted node-by-node execution dump (compressed JSON).
- `credentials_entity`: Encrypted credential payloads with AES-256-GCM.
- `user`: User authentication and role management.
