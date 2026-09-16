# 13 - Credentials Subsystem Anatomy

## 1. Security Architecture
- Symmetric encryption: AES-256-GCM.
- Key source: `N8N_ENCRYPTION_KEY` environment variable.
- In-memory resolution: Credentials decrypted only at execution time inside node sandbox, never logged in plain text.
