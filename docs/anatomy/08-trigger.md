# 08 - Trigger Subsystem Anatomy

## 1. Trigger Types
1. **Poll Trigger**: Runs on fixed interval, compares current state with `staticData`, emits new items.
2. **Webhook Trigger**: Exposes an HTTP endpoint, waits for external pushes.
3. **Event Trigger**: Listens on message queues (RabbitMQ, Kafka, MQTT, Redis pub/sub).
