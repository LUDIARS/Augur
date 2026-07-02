# Purpose-Driven Test Plan

## Purpose

Augur creates a test plan that matches the caller's objective.

The service does not execute tests. It decides what should be tested, why it should be tested, and what draft test cases are useful for the next implementation step.

## User Story

As a developer or AI coding agent,
I want Augur to read my objective and project signals,
so that I can create the right tests before or after changing code.

## Inputs

- Objective kind and description
- Experience goals with optional explicit budgets and exemptions
- Changed files
- Git diff
- Existing failure logs
- Coverage data
- Runtime measurements
- Known frameworks and test runners

## Behavior

1. Augur reads the objective.
2. Augur normalizes available signals.
3. Augur identifies testing needs implied by the objective and signals.
4. Augur ranks suggestions by risk, confidence, and implementation usefulness.
5. Augur returns a structured test plan.

## Objective Mapping

- `new_feature`: suggest happy path, edge cases, and contract tests.
- `bug_fix`: suggest regression tests that reproduce the bug.
- `regression`: suggest narrow tests around the failing behavior and nearby boundaries.
- `refactor`: suggest behavior-preserving tests and existing contract checks.
- `performance`: suggest externally measured performance guardrails, derived from experience budgets when goals are supplied (see [Experience-Driven Constraints](./experience-driven-constraints.md)).
- `stability`: suggest flaky and nondeterministic behavior checks.
- `security`: suggest validation, authorization, and abuse-case tests.
- `unknown`: suggest investigation-first tests based on available evidence.

## Output

The feature returns a `TestPlan` with one or more `TestSuggestion` objects.

Each suggestion must include:

- test kind
- priority
- confidence (`0.0` to `1.0`, defined in the [Core Data Schema](../data/core-schema.md))
- target files when known
- rationale
- evidence references
- draft test description

## Constraints

- Augur must not invoke test runner commands.
- Augur must not claim a test passed or failed unless that result was supplied as input.
- Augur should still produce partial suggestions when input is incomplete.

## Related Specs

- [Core Data Schema](../data/core-schema.md)
- [Experience-Driven Constraints](./experience-driven-constraints.md)
- [Planning Engine](./planning-engine.md)
- [HTTP API](../interface/http-api.md)
- [Service Test Strategy](../test/service-test-strategy.md)

