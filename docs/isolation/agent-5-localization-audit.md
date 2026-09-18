# Agent-5 audit — persistence localization & Zero Cross-Language Leak

**Task**: `TASK-LANG-B5` · **LEGO**: `persistence` · **Agent**: `agent-5`
**Branch**: `arena/01a0b206-n8n-rust-v-4` (branched from `agent-5` @ `4e580118`)
**Reference**: n8n `2.9.4` @ `b6dc2787c45677a29a9612cd27eb911302961a83`
**Verdict**: **SUCCESS** — gate 11/11, unit tests 16/16, mutation check 7/7

---

## 1. Mandate

`AGENT_INSTRUCTION.md` (agent-5) assigns three duties:

1. manage persisted workflow-state / execution data / **language preference**
   (localStorage & profile settings);
2. audit the whole bundle for syntax errors and for **foreign-language text
   leaking into the active language** (Zero Cross-Language Leak);
3. run the final validation gate before anything is integrated.

## 2. What was built

| File | Role |
| :--- | :--- |
| `packages/reconstructed-engine/src/persistence-locale-store.ts` | new — 6-locale dictionary for the persistence layer (48 keys × 6 = 288 strings), storage adapters, `PersistenceLocaleStore` |
| `packages/reconstructed-engine/src/universal-locale-enforcer.ts` | hardened — leak log, `isSupported`, `leaks()` / `hasLeaks()` |
| `packages/workflow-lego/src/settings-localization-adapter.ts` | fixed — `id`/`en`-only settings surface raised to the runtime's six locales + storage round-trip |
| `tools/localization-leak-gate.mjs` | new — the 11-check audit gate (writes `docs/isolation/evidence/localization-leak-gate.json`) |
| `tests/agent-5/localization.test.mjs` | new — 16 behavioural tests |
| `tests/agent-5/mutation-check.mjs` | new — injects 7 known defects, asserts the gate goes red |
| `scripts/flush-agent-bus.mjs` | new — flushes the Supabase outbox (dry-run by default) |
| `docs/isolation/agent-5-bus-outbox.json` | new — PRE/POST `agent_messages` + `tasks` envelopes |

English values are copied 1:1 from
`reference/n8n/packages/frontend/@n8n/i18n/src/locales/en.json`
(sha256 `1367f71a…93d5bef4`); the eight execution statuses come from
`reference/n8n/packages/workflow/src/execution-status.ts`. Every key carries a
provenance entry in `PERSISTENCE_KEY_PROVENANCE`; the four engine-only
notices are marked `reconstruction:agent-5/persistence`.

## 3. Audit findings

| # | Finding | Severity | Resolution |
| :-- | :--- | :--- | :--- |
| F1 | `SettingsLocalizationAdapter` offered only `id` + `en` while `NativeLocalizationService` offered six locales. Selecting Javanese/Arabic/Chinese/Russian in the backend left the settings screen in Indonesian — a genuine cross-language inconsistency. | high | fixed — `SUPPORTED_LANGUAGES` now carries all six; gate `G08` fails if the surfaces drift apart |
| F2 | `UniversalLocaleEnforcer.cleanText()` returned the **English source string** when a translation was missing, with no record — the exact leak the rule forbids, undetectable. | high | fixed — every miss is pushed to a leak log exposed via `leaks()` / `hasLeaks()`; the gate renders all 288 strings and fails on any miss (`G07`) |
| F3 | The gate enumerated sources with `git ls-files`, so a **new, untracked file escaped both the syntax check and the Rust scan**. | high | fixed — inventory = filesystem walk ∪ index; found by the mutation harness (M05 flipped the wrong check) |
| F4 | `node --check file.ts` is **not** a syntax gate for TypeScript: it exits `0` on `export const a = ;`. | high | fixed — `.ts` is type-stripped with `module.stripTypeScriptTypes()` and the emitted ESM is checked (35 of 68 files) |
| F5 | A `reference/` substring filter also excluded our own golden corpus `tests/reference/**` (16 files). | medium | fixed — only the read-only upstream tree `reference/**` is excluded |
| F6 | `خطأ` / `错误` are used for both `execution.status.error` and `executionsList.modes.error`. | info | accepted — legitimate homonyms; reported as warning `W01`, not a failure |

## 4. Gate

```
$ node tools/localization-leak-gate.mjs
✓ G00 localization modules load on Node                      4 modules
✓ G01 every reconstructed JS/TS file parses                  68 files (35 type-stripped)
✓ G02 six-locale dictionary parity                           48 keys × 6 locales
✓ G03 interpolation placeholder parity                       {count} identical everywhere
✓ G04 no foreign script inside a locale string               no Latin in ar/zh/ru, no Han/Cyrillic/Arabic in id/jv/en
✓ G05 ar = Arabic, zh = Han, ru = Cyrillic
✓ G06 no untranslated English fallback in ar/zh/ru
✓ G07 full render records zero translation misses            288 strings rendered
✓ G08 all four locale surfaces expose the same codes         ar,en,id,jv,ru,zh
✓ G09 zero Rust inside the JS/TS reconstruction              59 files, 0 .rs, 0 Rust markers
✓ G10 preference round-trips through storage                 persist → hydrate → corrupt → id

LOCALIZATION GATE: 11/11 PASS · 0 FAIL · 8 warning(s) · 288 strings · VERDICT PASS
```

`G09` is the ZERO-RUST check: eight Rust markers (`fn` declarations, `#![`,
`#[derive(`, `let mut`, Rust return arrows, `impl` blocks, `println!`,
`use crate::`) plus a `.rs` file scan over `packages/`, `tools/`, `tests/`,
`apps/`, `scripts/` — including the agent-3/agent-4 expression LEGO merged into this branch.

### The gate is not vacuously green

`node tests/agent-5/mutation-check.mjs` injects seven defects and asserts that
the expected check flips to FAIL, restoring the tree after each one:

```
✓ M01 drop an Arabic key                    → G02, G05, G07 FAIL
✓ M02 Latin letters inside a Chinese value  → G04 FAIL
✓ M03 rename {count} in one locale          → G03, G07 FAIL
✓ M04 syntax error in a tracked .cjs        → G01 FAIL
✓ M05 `pub fn main() {}` inside a .ts       → G00, G01, G09 FAIL
✓ M06 restore the id/en-only settings bug   → G08 FAIL
✓ M07 drop the persistence write            → G10 FAIL
MUTATION CHECK: 7/7 defects caught · restored tree gate exit 0 · VERDICT PASS
```

F3 and F4 above were both discovered *because* of this harness: M05 was
initially reported as “caught” when in fact the gate had crashed on import and
the harness was reading stale evidence.

## 5. Supabase reporting — status: blocked at the worker, envelopes committed

Both reports were written, but **neither could be delivered from this
workspace**. Two independent blockers, both evidenced:

1. **No credentials.** `.env` is absent (git-ignored), so
   `supabase_client.py` runs with `SUPABASE_URL = ''` and `key present = False`
   → `ValueError: unknown url type: '/rest/v1/agent_status'`.
   `docs/supabase_migration.sql` also enables RLS with `service_role`-only
   writes; the `sb_publishable_…` key in `.env.example` can SELECT but not
   INSERT.
2. **Egress is blocked.** `curl https://api.github.com/` → `200`, but
   `curl https://gqctxugkxekdqxsaqrum.supabase.co/…` → `SSL_ERROR_SYSCALL`
   during the TLS handshake. `node scripts/flush-agent-bus.mjs --apply` reports
   `NETWORK ERROR: fetch failed` for all five envelopes; the same host answers
   normally through the platform's own fetcher, so the block is on the worker's
   outbound path.

The obligation is therefore discharged as an **outbox**, matching the
convention already used in `docs/isolation/workflow-bus-outbox.json`:
`docs/isolation/agent-5-bus-outbox.json` holds five schema-matched envelopes in
phase order —

| id | table | phase |
| :-- | :--- | :--- |
| `MSG-PRE-TASK-LANG-B5` | `agent_messages` | pre |
| `TASK-LANG-B5-RUNNING` | `tasks` (status `RUNNING`) | pre |
| `MSG-POST-TASK-LANG-B5` | `agent_messages` (machine evidence) | post |
| `TASK-LANG-B5-COMPLETED` | `tasks` (status `COMPLETED`) | post |
| `MSG-AGENT-1-LOCALE-BOUNDARY` | `agent_messages` → agent-1 | post |

Replay them with:

```bash
SUPABASE_URL=https://gqctxugkxekdqxsaqrum.supabase.co \
SUPABASE_SECRET_KEY=<service-role-key> \
node scripts/flush-agent-bus.mjs --apply
```

## 6. Cross-boundary note

`packages/workflow-lego/src/settings-localization-adapter.ts` lives inside the
Workflow LEGO package but is **not** Workflow-owned: `manifest/ownership.json`
lists `persistence` under `doesNotOwn`, and agent-5 owns language-preference
storage. The file stays self-contained (zero imports) so the Workflow LEGO
boundary does not widen, and agent-1 is notified through
`MSG-AGENT-1-LOCALE-BOUNDARY`.

## 6b. No regression on the existing suite

`bash scripts/run-lego-tests.sh` reports **11 pass / 8 fail** both with and
without this change (the two modified files were stashed to obtain the
baseline). The eight failures are the equivalence/strict-isolation tests that
require the pinned reference runtime — `.runtime/node_modules` is absent in this
workspace and `scripts/setup-reference-runtime.sh` needs network access — so
they are environmental, identical before and after, and unrelated to the
persistence layer.

## 7. Reproduce

```bash
node tools/localization-leak-gate.mjs              # 11 checks + evidence JSON
node --test "tests/agent-5/*.test.mjs"             # 16 tests
node tests/agent-5/mutation-check.mjs              # 7 injected defects
node scripts/flush-agent-bus.mjs                   # dry run of the Supabase envelopes
```
