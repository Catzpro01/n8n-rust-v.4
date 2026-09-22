# ADR-0003 — The AI knowledge pack is generated, never hand-maintained

- **Date:** 2026-09-22
- **Phase:** P2.8-B
- **Foundation version:** 1.0.0
- **Status:** accepted

## Decision

Everything under `.ai/` is generated from the manifest, the contract lock and the foundation vocabulary by `tools/lego/ai-pack.mjs`. CI runs `--check` and fails the build when the pack is stale.

## Reason

A hand-written architecture guide is a second registry, and a second registry always drifts from the first — usually silently, and usually right when someone trusts it. The requirement was explicitly "no duplicated registries". Generating the pack means the AI-facing documentation is either correct or the build is red; there is no third state where it is quietly wrong.

## Alternatives considered

- **Hand-written Markdown cards.** Rejected: drift is guaranteed, and a confidently wrong domain card is worse than no card.
- **Generate on demand, do not commit.** Rejected: an agent reading the repository should find the pack already there, without running a tool.
- **Commit but do not check freshness.** Rejected: that is just hand-written docs with extra steps.

## Consequences

- Changing the manifest requires running `npm run lego:ai`.
- The pack cannot contain anything that is not derivable from enforced data — which is a feature: if it belongs in the pack, it belongs in the manifest.
- Prose that genuinely is prose (the constitution, recipes, decision cards) lives inside the generator, so it is still version-controlled and reviewed.
