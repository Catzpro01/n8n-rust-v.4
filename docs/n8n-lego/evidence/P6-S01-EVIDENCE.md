# P6-S01 — Live community / private / custom node installation path (evidence)

Slice `P6-S01` (program P6, ecosystem; issue #95; no debt source — a capability gap, not
a technical debt).

## 1. The gap

P6.1–P6.31 built the node admission pipeline as **thirty-one separate contracts**: the
registry compiler (P6.2), the transactional package install (P6.3), the capability
compiler (P6.8), the locality matrix (P2.27), the policy ceilings (P2.27), the lifecycle
states (P6.10), the health breaker (P6.11), the provenance log (P6.27), the namespace
rules (P6.29). Every one of them is reachable on its own and every one is tested.

What did not exist is the **one path a candidate node actually travels when someone
installs it live**. Issue #95 asks for exactly that, and it says why in its own words:
*"Make n8n LEGO able to retain the broad n8n node ecosystem while applying explicit
compatibility, trust, runtime, and supply-chain rules."* The rules existed. The path that
applies them did not.

`P6-S01` adds `src/lego/node-install.mjs` — `node.install@0.1.0`.

## 2. The rule that shapes everything

Issue #95 states it directly:

> **A node class is a policy input, not an automatic trust grant.**
> Official status, package origin, and programming language must not silently grant
> unrestricted authority.

The failure mode being guarded against is the obvious one — "official", "Rust" and
"signed" all *sound* like trust, and none of them is. The module enforces that in four
places, each with a test that pins the behaviour:

| Claim | What it actually buys | Enforced by |
| --- | --- | --- |
| `official` | the `CORE` **ceiling**, not `CORE` | `NODE_CLASS_TRUST_CEILING` + the "every class has both a ceiling and a floor" test |
| `native` (Rust) | nothing; the capability it requests takes the ceiling away | `strictestPosture` + "a native capability takes the in-process row away" |
| an attestation | **one** promotion step, and never past `verified-community` | `classifyNode` + "an attestation promotes community one step and no further" |
| AI-generated code | `custom`, whatever it declares about itself | `classifyNode` + "AI-generated code is custom whatever it declares about itself" |

The AI-generated rule is the sharpest one and the easiest to get backwards. The obvious
implementation exempts a node that declares itself `official` — which is precisely the
hole. A generated node claiming an official class must not inherit it, so
`classifyNode` applies the downgrade unconditionally, and a test pins it.

## 3. The install path

Seven steps, in the fixed order `NODE_INSTALL_STEPS` names, so two people explaining one
node tell the same story in the same sequence:

```
identify → trust → capability → locality → resource → compatibility → health
```

Each step records **where its evidence came from**. `source: 'self'` means the module
produced it; anything else names the contract that must have produced it. That
distinction is what makes the three-way verdict honest:

- **`refuse`** — something actually failed. A self-test that failed, a node over its
  resource budget, a capability name that is not even a string. There is evidence, and
  the evidence says no.
- **`incomplete`** — nothing failed, but nobody checked. No self-test evidence, no
  registry verdict. This fails closed too, but it says a different thing: *run the check,
  do not fix the node.* Conflating the two is the bug that produces "tests mostly pass".
- **`admit`** — every step passed and every external step was cited.

An earlier draft of this module returned `refuse` for a missing self-test. That was wrong
and a test caught it: a missing check is not a failed check.

## 4. The runtime choice never changes the node contract

Issue #95 is explicit that *"the runtime choice must not change the consumer-facing node
contract."* The install decision carries `consumerContract: { type }` and **nothing else** —
no locality, no trust class, no capabilities. A node re-placed behind a different runtime
is still the same node to a workflow.

The test "re-placing a node does not change its consumer-facing contract" installs the
same type twice — once in-process, once in an isolated process — and asserts the two
`consumerContract` values are identical while the localities differ.

This is the same discipline `capability-compiler.mjs` already applies by excluding
`trustClass` from `planDigest`, for the same reason. P6-S01 does not fork that decision;
it extends it to the install decision.

## 5. The capability/posture pairing

Two things set where a node runs, and **the stricter one wins**:

1. the node class, through its trust ceiling;
2. what the node actually asked for — because a node requesting `native` or `subprocess`
   has no in-process row to live in.

The second rule is the one that stops the exploit. An `official` node that asks for
`subprocess` must not be waved into the process on the strength of its class claim, so
`strictestPosture('CORE', 'ISOLATED')` returns `ISOLATED` and the node lands in
`ISOLATED_PROCESS`. Its class posture is still recorded as `CORE` — the class did not
change, the placement did.

The guard `if (nativeRequested && recommended === 'IN_PROCESS') fail(...)` is defensive:
with the current matrix it never trips, because every posture a native request can land
on has a non-in-process row. A test asserts that property directly rather than asserting
the guard fires, so the invariant is pinned even though the current data cannot violate
it.

## 6. What this slice deliberately does not do

- **It does not grant anything.** `evaluateInstallCapabilities` records which requested
  capabilities were explicitly granted, but granting is `plugin-policy.mjs`'s job. The
  install path decides whether a request is *admissible*, never whether it is *held*. A
  test asserts the decision carries no `grants` key at all.
- **It does not fork the locality matrix or the policy ceilings.** Both are imported from
  `plugin-locality.mjs` unchanged. `contracts/` is untouched.
- **It does not add an error code.** Every failure raises the already-published
  `lego.contract_violation`. An earlier draft cited the trust step as `lego.foundation`,
  which `lego:foundation` correctly rejected under **F16 error-code-unpublished** — the
  citation was being read as a raised code. It now cites `foundation.json`, which is the
  actual source of the trust vocabulary.

## 7. Verification

| Gate | Result |
| --- | --- |
| `lego-node-install.test.mjs` | **36 / 36 pass** |
| `governance-register` + `live-progress` + `lego-node-install` | **135 / 135 pass** |
| `lego:test` (whole suite) | **2698 / 2701 pass** |
| `lego:arch`, `lego:arch:selftest` | OK, 26 / 26 |
| `lego:foundation`, `lego:foundation:selftest` | OK, 15 / 15 |
| `lego:capabilities`, `lego:scaleout` | OK |
| `lego:ai:check` | OK — 101 files in sync |
| `governance-register.mjs check` | exit 0 |

**Pre-existing failures, not from this slice.** `lego:test` fails 3 tests —
`GET /rest/types/nodes.json`, `GET /rest/types/node-versions.json` and
`POST /rest/node-types`. All three fail **identically on a clean clone of `main`**
(baseline: 2662/2665 pass, same 3 failures; this branch: 2698/2701 pass, same 3
failures). They concern the compat node-catalog routes and are unrelated to the install
path. This slice adds **+36 passing tests and zero new failures**.

## 8. Checkpoints

| id | title | weight | status |
| --- | --- | --- | --- |
| CP-01 | Classification: a node class is a policy input, not a trust grant | 20 | completed |
| CP-02 | Trust ceiling/floor resolution for every named class | 15 | completed |
| CP-03 | Locality: the capability can take the in-process row away | 20 | completed |
| CP-04 | Fail-closed three-way verdict (refuse / incomplete / admit) | 20 | completed |
| CP-05 | Consumer-contract stability under re-placement | 10 | completed |
| CP-06 | DEC-0015 required self-hosted runner verification | 15 | completed |

Weights sum to 100 and derive from the scope of each checkpoint's behaviour, not from the
time taken, the number of commits, or the number of lines changed.
