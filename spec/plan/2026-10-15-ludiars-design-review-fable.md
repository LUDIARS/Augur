---
title: LUDIARS 9-tool design review — Augur
type: plan
status: proposed
service: augur
domain: test-management
updated: 2026-10-17
tags: [design-review, cross-service]
---

# Augur: one planning contract, explicit execution and runtime preparation

## Ownership and evidence

Augur owns purpose-driven planning and registered test lifecycle/evidence. The
pure planning engine is not the entire product: tests operations can author and
execute tests through configured buses. Rv retains its safety floor, review,
merge and publication decisions. An provides source/domain analysis; Pf owns
requirements; Actio owns work status; Cc owns coordination; Br derives summaries;
Cf owns game adoption; Genius supplies judgments. Keep these responsibilities.

Reviewed main `dc9fb8c`: bin/augur.mjs, src/cli/main.ts,
src/cli/reviewPlan.ts, src/operations/tests.ts, src/tests/registry.ts,
spec/interface/review-plan-cli.md, spec/plan/test-management.md,
spec/plan/daemonless-cli.md, spec/setup/local-development.md,
spec/implementation-design.md, augur.inject.json and package.json.

## Findings, rebuttals and implemented corrections

| Finding | Verification / counterargument | Decision |
|---|---|---|
| Implementation-design says HTTP was removed. | CLI dispatch still imports server.ts for serve; README/catalog/test-management explicitly retain opt-in HTTP. The daemon-less plan labels its removal step superseded. | Correct the technology table to daemon-optional. Do not remove the server. |
| Package Node range is mistaken for source-mode compatibility. | Shim prefers built JS and otherwise imports TS, retrying type-stripping errors with a flag. Built and source paths have different prerequisites. | Document the distinction; no unverified engines bump or runtime substitution. |
| Test/requirement ledgers look duplicated. | Registry records executable tests, contracts specify predicates, and cc.acceptance maps implementations to evidence. These are different identities. | Define mappings/provenance, not a merged mutable ledger. |
| Generated runtimes drift across services. | Injection config and contract runtime machinery already belong here; some consumers deliberately have no runtime dependencies. | Version/check generated artifacts in Augur; do not force a runtime package into every consumer. |
| Every review may pay planning-process overhead. | review-plan accepts one caller-built change profile, not a raw diff or reanalysis request. CLI works without a resident daemon. | Measure overhead before introducing a daemon requirement or duplicate planner in Rv. |

Implemented: two factual setup/architecture corrections. No engine, bus,
execution permission, review floor or public API changed. This supports the
review-plan safety-floor contract and test-management requirement for explicit
runner/evidence identity. Source consistency and whitespace were checked;
session tests and service startup were not run. No new text-mirroring unit test.
Recovery: revert documents; no data migration or restart required.

## Ordered proposals and acceptance

1. **Augur → Rv:** retain one bounded review-plan request over a fixed submitted
   change profile. Acceptance: invalid planner output cannot lower mandatory
   stages, docs/test/config/code cases retain their safety floor, and unavailable
   planning remains distinguishable from a successful empty plan.
2. **Generated runtime supply:** expose a version/content hash and deterministic
   check before regeneration. Acceptance: consumers can verify drift without
   rewriting files; a deliberate dependency-free consumer can use a generated
   artifact without an implicit package import.
3. **An → Augur:** correlate plan/author/run evidence with repository and source
   revision. Never promote a generic suggestion or an unexecuted test to passing
   acceptance evidence. Prefer one analysis projection per change.
4. **Br/Pf consumers:** consume evidence summaries with coverage denominator,
   skipped reasons and freshness. Missing injection stays uncovered, not green.

Large runtime-distribution and planning transport changes remain proposals.
No measured speedup, complete cross-service rollout or human UX acceptance is claimed.
