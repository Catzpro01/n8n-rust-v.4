# AI UI — accessibility and localization

**Status:** specification. **Owner:** agent-01. Companions: `AI_UI_STATES_AND_FLOWS.md` (states),
`AI_UX_PROGRESSIVE_DISCLOSURE.md` (levels).

The AI layer inherits the project's localization architecture and extends it; it does not start a
second one. Concretely: one locale set, one key space, one direction rule, one fallback rule — and
for every AI surface, keyboard reachability and announced status are part of "done".

---

## 1. Locales

| Code | Language | Direction | Notes |
| :--- | :--- | :--- | :--- |
| `id` | Bahasa Indonesia | LTR | product default in the user's locale; `en` remains the fallback |
| `en` | English | LTR | canonical key language and deterministic fallback |
| `ar` | العربية | **RTL** | the whole shell mirrors, including the Copilot panel and the agent tree |
| `zh` | 中文 | LTR | no word-order assumptions in composed strings |
| `ru` | Русский | LTR | plurals differ; use the plural contract, never string concatenation |
| `jv` | Basa Jawa | LTR | least-resourced locale: every AI string must survive being the only untranslated one |

Rules:

1. **One set.** The locale list is declared once (`src/i18n.mjs` → `SUPPORTED_LOCALES`); no AI
   surface declares its own languages or its own fallback.
2. **Deterministic fallback.** A missing key falls back `id/ar/zh/ru/jv → en`, and a missing key in
   `en` is a defect, not a runtime fallback. Fallback is per key, not per screen.
3. **Directions come from the locale**, not from the string: the UI mirrors layout, icon sides,
   animation direction and drag gestures for `ar`; numbers, code, file paths and diffs stay LTR.
4. **Dictionaries live outside the contracts.** No contract carries a dictionary; a UI string is a
   message key plus parameters (`knowledge.mjs`, `i18n.mjs`).

## 2. Message keys for AI surfaces

Every AI string is a key, and the key space is derived from the surface, not from the sentence:

| Area | Key shape | Example |
| :--- | :--- | :--- |
| surfaces & entry points | `ai.surface.<name>.label` | `ai.surface.copilot.label` = `Copilot` |
| status bar | `ai.status.<state>.label` | `ai.status.approval-required.label` |
| states | `ai.state.<state>.body` | `ai.state.degraded.body` |
| runtime / MCP / skills / memory | `ai.<surface>.<item>.label` | `ai.runtime.locality.remote.label` |
| outcomes | `ai.outcome.<outcome>.body` | `ai.outcome.operation-unpublished.body` |
| approvals | `ai.approval.<element>.label` | `ai.approval.risk.label` |

Rules:

- **Parameters, never concatenation.** `{count} {unit}` is a key with parameters; `"3" + " skills"`
  is a defect in every language.
- **Plural contract.** Counts use the project's plural forms (a `one`/`other` shape minimum); a
  language that needs more forms declares them in its own catalog, not in the key.
- **No sentence in a contract or an event.** Events carry `summary` + `references`; a rendered
  sentence derives from a key.
- **Stable keys.** A key is an API: renaming one is a breaking change with the same discipline as a
  contract change; keys are never reused for a different meaning.
- **No vendor or model name inside a key.** `ai.model.label` + a model id as data.

## 3. Keyboard and focus

| Interaction | Key | Behavior |
| :--- | :--- | :--- |
| open Assistant | `Ctrl/⌘ + K` (shell entry) | focus moves into the input; `Esc` returns focus to where it was |
| open Copilot | `Ctrl/⌘ + J` | panel opens, focus on the tab strip |
| switch tab | `←` / `→` on the tab strip | roving tabindex, `Home`/`End` jump |
| expand L1 → L2 → L3 | `Enter` / `Space` on the chip, then on the row | focus stays on the control that expanded it |
| approve / deny | `A` / `D` when the card is focused | never globally bound: a stray key must not approve work |
| close panel/drawer | `Esc` | returns focus to the canvas element that opened it |
| stop a run | `Esc` twice within 1s (only if `supports.cancellation`) | announced as cancelled |

Requirements: every AI control is reachable and operable by keyboard; focus is always visible and
never trapped (except inside a modal approval, which returns focus on resolve); a streaming answer
announces its completion once (not token by token); the trace and agent tree use proper tree/list
semantics with `aria-expanded`, `aria-level` and `aria-selected`.

## 4. Screen readers and labels

- **Status is text.** `⚠ Approval required` is announced as words; the dot and the colour are
  decoration (`aria-hidden`). A status never depends on colour alone.
- **Icons carry labels.** An icon-only button has an accessible name (`aria-label` from a key); a
  decorative icon has none.
- **Live regions are bounded.** The status bar is a polite live region; the chat announces "answer
  complete" once; the trace does **not** announce every row (that would flood a screen reader) —
  it announces the newest row when the tab is focused.
- **Chips are buttons, not spans.** `Context 61%` announces "Context, 61 percent, button"; its
  expanded panel is a labelled region.
- **Numbers are human.** `12.4k / 32k` announces "12.4 thousand of 32 thousand"; `4,218 tokens`
  announces the number and the unit, formatted with `Intl.NumberFormat` for the active locale.
- **Referenced, not inlined.** Because payloads are never rendered, there is no "unreadable blob"
  accessibility problem to solve; artifacts announce kind, size and owner.

## 5. Visual accessibility

| Concern | Requirement |
| :--- | :--- |
| Contrast | text ≥ 4.5:1, large text ≥ 3:1, controls and focus rings ≥ 3:1 against the background |
| Focus | a visible focus ring on every interactive element, never removed for aesthetics, never only a colour change on a borderless chip |
| Motion | `prefers-reduced-motion` removes streaming animations, tree expansion animation and the status-dot pulse |
| Density | the AI panel respects the user's density setting; it never forces a compact style the rest of the shell does not use |
| Zoom | usable at 200% zoom with the panel open; no horizontal scroll at the panel's minimum width |
| Touch | targets ≥ 40 × 40 px on mobile, including chips and tree toggles |
| Time | no auto-dismiss on an approval card, an error, or an artifact action; dismissal is user-initiated |

## 6. Localized AI behavior (content, not only chrome)

- **Response language.** Default `Auto` (the request's language). The control sets a preferred
  response language from the locale set; it is a preference on the request, not a translation of the
  UI.
- **`Translate response`** is an explicit, per-message action (advanced), and when translation is
  performed the message is labelled with the target language and how it was produced. Until
  **XA-23** is published, the frontend capability `translation` stays `declared` and the action is
  absent rather than faked.
- **A model answer in the wrong language is not a localization failure** — it is content; the UI
  offers `Translate response` rather than silently switching the interface language.
- **Dates, times, numbers and currency** are formatted with `Intl` from the active locale; token
  counts, durations (`2m 14s`) and percentages follow the same rule.
- **Truncation is per locale.** A summary limit is a character count in storage, but truncation in
  the UI happens at a cluster boundary and never inside a grapheme (Arabic and Javanese included).

## 7. What proves it (test intent, no decorative snapshots)

| Claim | Proof |
| :--- | :--- |
| one locale set, `ar` is the only RTL, fallback is deterministic | `test/22-localization.test.mjs` + the pack's localization block |
| every AI string is a key, and every key used exists | key coverage: a used key with no catalog entry fails the gate |
| the boot payload carries no AI vocabulary | evidence check: the descriptor contains no event names, provider kinds or capability metadata |
| status is never colour-only | review rule + an evidence check that every status label has text |
| RTL and keyboard behaviour | manual + CI browser pass on the surfaces listed in `AI_UI_IMPLEMENTATION_PHASES.md` (acceptance, not snapshot) |
