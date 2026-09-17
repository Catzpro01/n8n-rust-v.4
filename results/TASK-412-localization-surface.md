# TASK RESULT: TASK-412-localization-surface

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-5`
- **LEGO COMPONENT**: `localization` (Phase 4D)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 UTC`

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `read_file` (`src/index.ts`) | ✓ SUCCESS | `0` |
| `write_file` (`src/index.ts`, additive export block) | ✓ SUCCESS | `0` |
| `write_file` (`tools/localization-inspect.mjs`) | ✓ SUCCESS | `0` |
| `edit_file` (`tools/localization-gate.mjs` → G8/G9) | ✓ SUCCESS | `0` |
| `edit_file` (test L13) | ✓ SUCCESS | `0` |
| `run_tests` (`node --test …06-localization-runtime.test.ts`) | ✓ SUCCESS | `0` |
| `run_gate` (`node tools/localization-gate.mjs`) | ✓ SUCCESS | `0` |
| `run_cli` (`--lang jv --key node.error`) | ✓ SUCCESS | `0` |
| `run_cli` (`--lang de` → expect exit 2) | ✓ SUCCESS | `2` (expected) |
| `run_gate` (`npm run isolation:check`) | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: `run_tests`

```text
# tests 33
# pass 33
# fail 0
```

#### Operation: `run_gate` — `node tools/localization-gate.mjs`

```text
[PASS] G1 localization test suite passes — 33/33 PASS in 196ms
[PASS] G2 runtime catalog == Phase 4B SUPPORTED_LOCALES — 6 locales identical
[PASS] G3 runtime catalog == dictionary key set — 6 locales, 9 keys each
[PASS] G4 dictionary parity across all six locales — 6 locales consistent, 0 empty values
[PASS] G5 every locale returns a real translation for the probe key
[PASS] G6 direction table matches the catalog (Arabic rtl) — id:ltr, en:ltr, jv:ltr, ar:rtl, zh:ltr, ru:ltr
[PASS] G7 engine status overlay covers every locale and status — 5 statuses x 6 locales
[PASS] G8 Phase 4D: index.ts re-exports every runtime symbol of the localization line — 23 runtime + 12 type symbols promoted
[PASS] G9 the promoted surface is runnable from a checkout (localization-inspect) — 20 symbols loadable, unknown locale rejected with exit 2
RESULT: PASS (9/9 checks)
```

#### Operation: `run_cli`

```text
$ node tools/localization-inspect.mjs --lang jv --key node.error
jv (ltr)  node.error = Gagal dilakokake

$ node tools/localization-inspect.mjs --lang de --key settings.title
error: unsupported locale "de" — supported: id, en, jv, ar, zh, ru      (exit 2)
```

#### Operation: `run_gate` — `npm run isolation:check`

```text
Boundary check: PASS (no drift vs manifest/boundary.expectations.json)
Kernel snapshot check: PASS (snapshots match the pinned reference source)
Port surface check: PASS (manifest ports == consumed ports)
Reference integrity check: PASS (15050 files, root f8da35180669d798…)
```

### Boundary decision recorded

`settings-localization-adapter.ts` (Phase 4A) is **not** promoted: it exists to present editor-facing
language labels, and PROJECT_RULES #2 keeps every UI concern in the untouched upstream bundle. Gate
G8 asserts the exclusion on every run; test L13 asserts it independently.

Because `localization-runtime.ts` has **zero imports** and consumes the 4B service through a port,
promotion adds 23 runtime + 12 type symbols to the package surface while adding **no** dependency
edge — the port-surface manifest is therefore unchanged and `isolation:check` stays 4/4.
