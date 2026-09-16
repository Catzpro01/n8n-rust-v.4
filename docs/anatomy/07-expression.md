# 07 - Expression Engine Anatomy

## 1. Syntax & Resolution
n8n uses dynamic expressions wrapped in double curly braces:
`{{ $json.myField }}` or `{{ $node["HTTP Request"].json.id }}`

## 2. Data Proxy Variables
- `$json`: Current item's JSON payload.
- `$node["NodeName"].json`: Access historical data from a previously executed node.
- `$env`: Environment variable access (if enabled).
- `$now`, `$today`: Date/time utilities.
- `$executionId`: Current execution run ID.
