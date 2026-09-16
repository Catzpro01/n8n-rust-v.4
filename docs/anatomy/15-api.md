# 15 - REST API Subsystem Anatomy

## 1. API Namespaces
- `/rest/workflows`: CRUD operations, activation toggle.
- `/rest/executions`: List history, retry execution, cancel running execution.
- `/rest/credentials`: Schema validation, test connection, save credentials.
- `/rest/nodes`: Metadata of installed node types and parameter schemas.
