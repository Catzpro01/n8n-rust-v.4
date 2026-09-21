# Reference LEGO — the template every backend domain copies

This is **not a feature**. Nothing here is mounted on a route, nothing is
reachable from the running server, and it intentionally does nothing useful.
It exists so a P3+ agent can answer "what does a correctly-shaped backend LEGO
look like in this repository?" by reading ~100 lines instead of guessing.

## Shape

```
src/reference-lego/
├── contract/
│   └── index.mjs     PUBLIC. The only file other domains may import.
├── internal/
│   └── store.mjs     PRIVATE. Importing this from another domain fails the gate.
├── lego.json         Domain card: id, owner, capability, dependencies, tests.
└── README.md         this file
```

Contract tests live with the foundation tests in
`apps/n8n-lego/test/lego-foundation.test.mjs` (section "reference LEGO").

## The six things a LEGO must have

| requirement | where it is satisfied here |
| :--- | :--- |
| explicit public contract | `contract/index.mjs` — factory + capability id + contract version |
| private implementation boundary | `internal/` — never referenced outside this directory |
| declared dependencies | `lego.json` `dependsOn`, mirrored in `src/lego/manifest/domains.json` |
| declared owner | `lego.json` `owner` + the `agents` map in the registry |
| capability identity | `REFERENCE_CAPABILITY` = `reference.echo`, registered in the manifest |
| test boundary | `lego.json` `tests` — contract tests only touch `contract/` |
| versioning | `REFERENCE_CONTRACT_VERSION` + a row in `src/lego/contracts/contract-lock.json` |

## How to build a real LEGO from this

1. `cp -r src/reference-lego src/<your-domain>` and rewrite `lego.json`.
2. Add / update your domain entry in `src/lego/manifest/domains.json`:
   `paths`, `public`, `dependsOn`, `mustNotDependOn`, `capabilities`, `contract`.
3. Declare your error codes in `src/lego/contracts/errors.contract.json`
   under your own `errorNamespace`. Never invent a code at the call site.
4. Add a row to `src/lego/contracts/contract-lock.json` listing your public
   exports and their consumers, and write the contract tests it points at.
5. Wire the domain in the composition root (`src/server.mjs`) — that is the only
   file allowed to import implementations from several domains.
6. Run `node tools/lego/architecture-gate.mjs`. If it is green, the boundary is
   real; if it is red, it tells you exactly which rule you broke.

## Rules this template demonstrates

* The contract file exports **behaviour factories and data**, never the internal
  data structure itself (`createReferenceLego()` returns a closed-over port;
  `internal/store.mjs` is unreachable from the outside).
* The contract file imports **nothing from another domain's internals** — only
  the shared kernel and the LEGO foundation.
* Errors are raised as **codes from the error contract**, not ad-hoc strings,
  and are HTTP-agnostic: the compatibility layer maps them to a status.
