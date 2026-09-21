# Universal Translation

**Status:** planning + a recorded decision change. **Publication state:** `publicationPending` —
there is **no translation domain and no translation capability** at P2.10; the frontend capability
`translation` is `declared` only. **Owner to publish:** manager (**XA-23**).

---

## 1. The decision this document records

Earlier project prose treated translation as permanently out of scope. That assumption is
**superseded**: Universal Translation is now an **official LEGO target** (A-2 in
`PROJECT_DECISIONS.md`). `.ai/constitution.md` was updated accordingly — this change is documentation
and planning, and it publishes no runtime.

## 2. Locales

`id` (Bahasa Indonesia) · `en` (English) · `ar` (العربية, **RTL**) · `zh` (中文) · `ru` (Русский) ·
`jv` (Basa Jawa). One declared set (`src/i18n.mjs` -> `SUPPORTED_LOCALES`), one direction rule, one
deterministic fallback (`id/ar/zh/ru/jv -> en`), dictionaries outside contracts.

The translation *capability* is a separate question from the interface locale: a user may run the UI
in Bahasa Indonesia and ask for an English answer, and a model answer in the wrong language is
content, not a localization failure.

## 3. Scope of a translation capability (target)

translation · language detection · localization · normalization · format preservation · context-aware
output — with **format preservation** meaning: code, paths, diffs, numbers, placeholders and markup
survive a round trip, and truncation never splits a grapheme (Arabic and Javanese included).

## 4. Ownership rule (the reason this is recorded)

Translation must **not** be forced into `credentials`, `node-registry` or `workflow` just because the
legacy REST aggregate currently owns two i18n route families. `domains.json` records those families
under `legacy-rest.unresolvedOwnership` (`/rest/credential-translation`,
`/rest/node-translation-headers` — constant empty objects, no business logic), and the frontend treats
them as **stubs**, never as a working feature. The ownership decision belongs to the manager (XA-23),
together with the question of whether translation is its own domain or a nested LEGO.

## 5. Frontend behaviour

- Compact control only: `Language · Bahasa Indonesia`, `Response language: Auto`, and an optional
  per-message `Translate response`. **No permanent translation panel.**
- While XA-23 is open: the locale control works (it is the interface's own declaration), the
  translation *action* is **absent**, and no surface claims to have translated anything.
- When a translation is performed (after publication), the message is labelled with the target
  language and how it was produced; the UI does not silently switch the interface language.
- Message keys are never reused for a different meaning, no vendor or model name appears inside a key,
  and every AI string survives being the only untranslated one (`jv`).

## 6. What must not happen

No dictionary inside a contract · no second locale set · no hard-coded sentence in any AI surface ·
no "translated" label without a real translation · no translation logic smuggled into a node or a
credential domain to satisfy a legacy route.
