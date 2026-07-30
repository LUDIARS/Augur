# Service Test Strategy

## Purpose

Augur's tests must verify that it creates useful test plans and fix policies without executing tests itself.

## Test Categories

### Build Check

Purpose:

- Verify TypeScript compilation.
- Verify exported schemas and handlers are valid.

Execution:

```text
npm run build
```

### Unit Tests

Purpose:

- Validate objective classification.
- Validate signal normalization.
- Validate evidence extraction.
- Validate priority and confidence scoring.
- Validate fix policy strategy selection.

Execution:

```text
npm run test
```

### API Tests

Purpose:

- Validate `POST /v1/plans`.
- Validate `GET /v1/health`.
- Validate request errors.
- Validate response schema.

Execution:

```text
npm run test
```

### Golden Tests

Purpose:

- Ensure stable output for representative requests.
- Catch accidental changes in planning behavior.

Examples:

- new feature objective
- bug fix objective
- regression objective with failure log
- refactor objective with changed files
- performance objective with runtime signal
- stability objective with intermittent failure log
- security objective with changed files
- unknown objective with minimal input
- responsiveness goal with explicit budget and a violating runtime signal
- responsiveness goal with an exempted scope and a relaxed budget
- game domain: netplay responsiveness goal with an RTT runtime signal
- game domain: sync integrity goal with a desync failure log

Golden tests must run with LLM assistance disabled so that output is fully deterministic. See the [Planning Engine](../feature/planning-engine.md) spec.

### Safety Tests

Purpose:

- Verify Augur never invokes test runner commands while creating a plan.
- Verify Augur does not mutate application code.
- Verify weak evidence leads to investigation-first guidance.

## Minimum Acceptance Tests

### ST-001 Bug Fix Produces Test-First Policy

Given a bug fix objective with a clear failure,
When Augur creates a plan,
Then the response should include a regression test suggestion and a `test_first` fix policy.

### ST-002 Refactor Preserves Behavior

Given a refactor objective,
When Augur creates a plan,
Then the fix policy should prefer `behavior_preserving` and the test plan should focus on existing contracts.

### ST-003 Performance Uses External Signals

Given a performance objective with a runtime signal,
When Augur creates a plan,
Then the test plan may suggest a performance guardrail but must not perform measurement itself.

### ST-004 Evidence Is Required

Given any successful response,
When suggestions or fix steps are returned,
Then they must reference evidence.

### ST-005 Partial Input Degrades Gracefully

Given only an objective and changed files,
When Augur creates a plan,
Then it should return partial guidance instead of failing solely due to missing diff or logs.

### ST-006 Stability Investigates Before Fixing

Given a stability objective without a deterministic reproduction,
When Augur creates a plan,
Then the test plan should include flaky-behavior checks and the fix policy should prefer `investigate_first`.

### ST-007 Identical Input Produces Identical Output

Given the same request submitted twice with LLM assistance disabled,
When Augur creates both plans,
Then the two responses must be byte-identical.

### ST-008 Explicit Budget Produces a Guardrail Carrying the Budget

Given an experience goal with an explicit target such as `api_latency p95 ≤ 20ms`,
When Augur creates a plan,
Then the test plan must include a performance guardrail whose `budget` field equals the explicit target.

### ST-009 Abstract Quality Produces Labeled Proposals

Given an experience goal with a quality but no explicit targets,
When Augur creates a plan,
Then the derived guardrails must set `proposedBudget: true`, carry confidence of at most `0.6`, and state in the rationale that the budget is a proposal.

### ST-010 Budget Violations Raise Priority

Given an explicit budget and a runtime signal exceeding it,
When Augur creates a plan,
Then the response must include `budget_violation` evidence and the matching guardrail must have `critical` or `high` priority with confidence of at least `0.8`.

### ST-011 Exemptions Relax Without Removing Coverage

Given a budget that applies everywhere and a caller exemption with a relaxed target for one scope,
When Augur creates a plan,
Then signals inside the exempted scope must not produce violations against the strict budget, and a guardrail against the relaxed budget must still be suggested for that scope.

### ST-012 LLM Proposals Are Labeled and Subordinate

Given LLM assistance enabled and an LLM-proposed exemption for a scope,
When Augur creates a plan,
Then the exemption must appear as `budget_exemption` evidence labeled as LLM-proposed, must not delete any guardrail, and must not override a caller's explicit target for the same scope.

### ST-013 Domain Filters Default Proposals

Given `project.domain` is `"game"` and an abstract goal with no explicit targets,
When Augur creates a plan,
Then proposed defaults must come only from the common and game sections of the experience goal catalog, and web-only qualities must not be proposed unless the caller referenced them explicitly.

### ST-014 CLI Parity With the HTTP API (Phase 3) — superseded

Superseded by [Daemon-less CLI](../plan/daemonless-cli.md): the CLI is the only
surface, so there is no second surface to prove parity against. The engine
contract is held by the golden tests on `createPlan`. This scenario is no longer
part of the Phase 3 acceptance bar in the [Roadmap](../roadmap.md); it stays
listed so the ST numbering does not shift.

### ST-015 Persistence Round-Trips and Deletes (Phase 5)

Given persistence enabled,
When a plan is created, retrieved by its `planId`, deleted, and retrieved again,
Then the creation response carries `planId`, the retrieval matches the stored plan, and the second retrieval reports "not found"; and with persistence disabled, plans are byte-identical to stateless output. (The `404` wording is HTTP-era; retrieval and deletion are reached by subcommand once [Plan Persistence](../data/persistence.md) is revised for the CLI.)

### ST-016 Focused Testing Preserves Caller Priority

Given Anatomia analysis facts for a caller-prioritized domain and important variables,
When Augur creates a plan,
Then every requested risk produces an evidence-linked suggestion, its priority is at least the
domain/variable priority, its target files come from the analyzer facts, and repeated calls are
byte-identical without LLM assistance.

## CI Handling

CI should execute build, unit, CLI, golden, and safety tests (the API tests run until the server is removed in Phase 6).

CI should not depend on external web response timing to validate Augur's core behavior.

