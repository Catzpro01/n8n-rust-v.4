# 11 - Queue & Scaling Subsystem Anatomy

## 1. Scaling Architecture
- Uses Redis and BullMQ.
- **Main Instance**: Receives triggers and enqueues jobs into `n8n:queue`.
- **Worker Instances** (`n8n worker`): Dequeue jobs, load workflow graph, execute nodes, update state.
- **Webhook Instances**: Optional dedicated servers handling high-throughput webhooks.
