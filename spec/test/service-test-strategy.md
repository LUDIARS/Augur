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

Golden tests must run with LLM enrichment disabled so that output is fully deterministic. See the [Planning Engine](../feature/planning-engine.md) spec.

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

Given the same request submitted twice with LLM enrichment disabled,
When Augur creates both plans,
Then the two responses must be byte-identical.

## CI Handling

CI should execute build, unit, API, golden, and safety tests.

CI should not depend on external web response timing to validate Augur's core behavior.

